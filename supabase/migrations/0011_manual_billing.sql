-- =====================================================================
-- Numera Agentic — encaissement manuel par lien de paiement (Neero)
--
-- 1. Le client clique « S'abonner » : demande créée, compte « en attente de paiement ».
-- 2. Le propriétaire est prévenu sur Telegram, génère un lien dans Neero et le colle
--    dans l'espace propriétaire : le client le reçoit.
-- 3. Le client paie et saisit la référence de transaction : nouvelle notification.
-- 4. Le propriétaire vérifie dans Neero et clique « Valider » : l'accès s'active.
-- 5. Chaque matin : demandes de renouvellement 5 jours avant l'échéance,
--    relance des clients qui n'ont pas payé, expiration des accès échus.
--
-- Les paiements automatiques (Stripe, PayPal, Flutterwave) sont désactivés ici et
-- se réactivent en remettant billing_mode à 'automatic' et providers à true.
-- =====================================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ---------- Réglages ----------------------------------------------------

insert into platform_settings (key, value) values
  ('billing_mode', '"manual"'),
  ('app_url', '"https://numera-agentic.vercel.app"')
on conflict (key) do update set value = excluded.value;

update platform_settings set value = '{"stripe": false, "paypal": false, "flutterwave": false}'
 where key = 'providers';

drop policy settings_public_read on platform_settings;
create policy settings_public_read on platform_settings for select
  using (key in ('providers', 'trial_days', 'billing_mode'));

-- ---------- Statut « en attente de paiement » et fournisseur Neero ------

alter table subscriptions drop constraint subscriptions_status_check;
alter table subscriptions add constraint subscriptions_status_check
  check (status in ('trialing', 'pending_payment', 'active', 'past_due', 'canceled', 'expired'));
alter table subscriptions drop constraint subscriptions_provider_check;
alter table subscriptions add constraint subscriptions_provider_check
  check (provider in ('stripe', 'paypal', 'flutterwave', 'manual', 'neero'));

-- En attente de paiement : l'accès déjà acquis (essai ou période payée) est conservé.
create or replace function org_entitlements(p_org uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'plan_id', s.plan_id,
    'plan_name', p.name,
    'status', s.status,
    'provider', s.provider,
    'trial_ends_at', s.trial_ends_at,
    'current_period_end', s.current_period_end,
    'cancel_at_period_end', s.cancel_at_period_end,
    'has_access', case
      when s.status = 'trialing' then s.trial_ends_at > now()
      when s.status = 'pending_payment' then greatest(s.trial_ends_at, s.current_period_end) > now()
      when s.status = 'active' then coalesce(s.current_period_end, now() + interval '1 day') > now()
      when s.status = 'past_due' then coalesce(s.current_period_end, now()) + interval '3 days' > now()
      when s.status = 'canceled' then coalesce(s.current_period_end, now()) > now()
      else false end,
    'limits', p.limits,
    'usage', jsonb_build_object(
      'products', (select count(*) from products where organization_id = p_org),
      'whatsapp_numbers', (select count(*) from channel_accounts where organization_id = p_org and channel = 'whatsapp'),
      'ai_actions', (select count(*) from ai_usage where organization_id = p_org
                       and created_at >= date_trunc('month', now())),
      'members', (select count(*) from organization_members where organization_id = p_org))
  )
  from subscriptions s join plans p on p.id = s.plan_id
  where s.organization_id = p_org
$$;

-- Pas de prélèvement automatique : comme Flutterwave, Neero et le manuel expirent 3 jours après l'échéance.
create or replace function expire_subscriptions()
returns int language sql security definer set search_path = public
as $$
  with x as (
    update subscriptions set status = 'expired', updated_at = now()
    where (status = 'trialing' and trial_ends_at < now())
       or (status = 'canceled' and current_period_end < now())
       or (status = 'past_due' and current_period_end + interval '3 days' < now())
       or (status = 'active' and provider in ('flutterwave', 'manual', 'neero')
           and current_period_end + interval '3 days' < now())
    returning 1
  ) select count(*)::int from x
$$;

-- ---------- Demandes de paiement ----------------------------------------

create table payment_requests (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  plan_id          text not null references plans(id),
  billing_interval text not null check (billing_interval in ('month', 'year')),
  currency         text not null,
  amount           numeric(12, 2) not null,
  kind             text not null default 'new' check (kind in ('new', 'renewal')),
  status           text not null default 'awaiting_link'
                   check (status in ('awaiting_link', 'link_sent', 'reference_submitted', 'validated', 'canceled')),
  contact_phone    text,                -- numéro WhatsApp donné par le client
  payment_link     text,                -- lien Neero collé par le propriétaire
  link_sent_at     timestamptz,
  transaction_ref  text,                -- référence saisie par le client
  ref_submitted_at timestamptz,
  rejection_reason text,                -- dernière référence refusée, et pourquoi
  last_reminder_at timestamptz,
  validated_at     timestamptz,
  validated_by     uuid references auth.users(id),
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now()
);
create index on payment_requests (organization_id, created_at desc);
create index on payment_requests (status, created_at);
-- Une seule demande ouverte à la fois par organisation.
create unique index payment_requests_one_open on payment_requests (organization_id)
  where status in ('awaiting_link', 'link_sent', 'reference_submitted');

alter table payment_requests enable row level security;
create policy tenant_read on payment_requests for select
  using (is_org_member(organization_id) or is_platform_admin());

alter table alerts drop constraint alerts_kind_check;
alter table alerts add constraint alerts_kind_check
  check (kind in ('hot', 'approval', 'escalation', 'won', 'test', 'billing'));

-- ---------- Notification du propriétaire (Telegram, sans n8n) -----------
-- Jeton du bot et identifiant du chat dans Supabase Vault :
--   telegram_bot_token, owner_telegram_chat_id. Sans eux, rien n'est envoyé.

create or replace function notify_owner(p_text text)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_token text; v_chat text;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'telegram_bot_token';
  select decrypted_secret into v_chat  from vault.decrypted_secrets where name = 'owner_telegram_chat_id';
  if v_token is null or v_chat is null then return; end if;
  perform net.http_post(
    url     := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    body    := jsonb_build_object('chat_id', v_chat, 'text', p_text, 'disable_web_page_preview', true),
    headers := '{"Content-Type": "application/json"}'::jsonb);
end $$;
revoke execute on function notify_owner(text) from public, anon, authenticated;

create or replace function app_url() returns text language sql stable security definer set search_path = public
as $$ select coalesce((select value #>> '{}' from platform_settings where key = 'app_url'), '') $$;

-- Montant lisible : 35 000 XAF, 55 EUR.
create or replace function fmt_amount(p_amount numeric, p_currency text) returns text language sql immutable
as $$ select replace(to_char(p_amount, 'FM999G999G990'), ',', ' ') || ' ' || p_currency $$;

create or replace function payment_request_notify() returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_org text; v_email text; v_plan text; v_head text;
begin
  select o.name into v_org from organizations o where o.id = new.organization_id;
  select u.email into v_email from organization_members m join auth.users u on u.id = m.user_id
   where m.organization_id = new.organization_id and m.role = 'owner' limit 1;
  select name into v_plan from plans where id = new.plan_id;
  v_head := concat_ws(E'\n',
    'Client : ' || coalesce(v_org, '?') || coalesce(' (' || v_email || ')', ''),
    'Offre : ' || v_plan || ' · ' || case new.billing_interval when 'year' then 'annuel' else 'mensuel' end,
    'Montant : ' || fmt_amount(new.amount, new.currency),
    case when new.contact_phone is not null then 'WhatsApp : ' || new.contact_phone end);

  if tg_op = 'INSERT' then
    perform notify_owner(
      case new.kind when 'renewal' then '🔁 Renouvellement à préparer' else '🧾 Nouvel abonnement demandé' end
      || E'\n' || v_head || E'\n\nGénérez le lien dans Neero puis collez-le ici : ' || app_url() || '/admin');
  elsif new.status = 'reference_submitted' and old.status is distinct from 'reference_submitted' then
    perform notify_owner('💰 Paiement déclaré : à vérifier dans Neero' || E'\n' || v_head
      || E'\nRéférence : ' || coalesce(new.transaction_ref, '—')
      || E'\n\nValidez ici : ' || app_url() || '/admin');
  end if;
  return new;
end $$;
revoke execute on function payment_request_notify() from public, anon, authenticated;

create trigger payment_requests_notify after insert or update of status on payment_requests
  for each row execute function payment_request_notify();

-- ---------- Côté client -------------------------------------------------

create or replace function request_subscription(p_plan text, p_interval text, p_currency text, p_phone text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_org uuid; v_amount numeric; v_id uuid; v_phone text;
begin
  select organization_id into v_org from organization_members where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'Organisation introuvable'; end if;
  if p_interval not in ('month', 'year') then raise exception 'Période inconnue'; end if;
  select (prices -> upper(p_currency) ->> p_interval)::numeric into v_amount from plans where id = p_plan and active;
  if v_amount is null then raise exception 'Formule ou devise indisponible'; end if;
  v_phone := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  if v_phone is null or length(regexp_replace(v_phone, '\D', '', 'g')) < 8 then
    raise exception 'Indiquez votre numéro WhatsApp pour recevoir le lien de paiement';
  end if;

  update payment_requests set status = 'canceled'
   where organization_id = v_org and status in ('awaiting_link', 'link_sent', 'reference_submitted');

  insert into payment_requests (organization_id, plan_id, billing_interval, currency, amount, kind, contact_phone, created_by)
  values (v_org, p_plan, p_interval, upper(p_currency), v_amount,
          case when exists (select 1 from subscriptions where organization_id = v_org and status = 'active') then 'renewal' else 'new' end,
          v_phone, auth.uid())
  returning id into v_id;

  update subscriptions set status = 'pending_payment', updated_at = now()
   where organization_id = v_org and status in ('trialing', 'expired', 'canceled', 'past_due');
  return v_id;
end $$;

create or replace function submit_payment_reference(p_request uuid, p_ref text)
returns void
language plpgsql security definer set search_path = public
as $$
declare r payment_requests%rowtype;
begin
  select * into r from payment_requests where id = p_request for update;
  if not found or not is_org_member(r.organization_id) then raise exception 'Demande introuvable'; end if;
  if r.status not in ('link_sent', 'reference_submitted') then
    raise exception 'Le lien de paiement n''a pas encore été envoyé';
  end if;
  if length(trim(coalesce(p_ref, ''))) < 4 then raise exception 'Référence de transaction invalide'; end if;
  update payment_requests set transaction_ref = left(trim(p_ref), 80), status = 'reference_submitted',
    ref_submitted_at = now()
  where id = p_request;
end $$;

-- ---------- Côté propriétaire -------------------------------------------

create or replace function admin_payment_requests(p_open_only boolean default true)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare r jsonb;
begin
  if not is_platform_admin() then raise exception 'Accès réservé au propriétaire de la plateforme'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', pr.id, 'organization_id', pr.organization_id, 'organization', o.name,
      'owner_email', (select u.email from organization_members m join auth.users u on u.id = m.user_id
                       where m.organization_id = pr.organization_id and m.role = 'owner' limit 1),
      'plan_id', pr.plan_id, 'plan', p.name, 'interval', pr.billing_interval, 'currency', pr.currency,
      'amount', pr.amount, 'kind', pr.kind, 'status', pr.status, 'contact_phone', pr.contact_phone,
      'payment_link', pr.payment_link, 'transaction_ref', pr.transaction_ref,
      'rejection_reason', pr.rejection_reason, 'created_at', pr.created_at, 'link_sent_at', pr.link_sent_at,
      'ref_submitted_at', pr.ref_submitted_at, 'validated_at', pr.validated_at,
      'current_period_end', s.current_period_end)
    order by (pr.status = 'reference_submitted') desc, (pr.status = 'awaiting_link') desc, pr.created_at desc), '[]'::jsonb)
  into r
  from payment_requests pr
  join organizations o on o.id = pr.organization_id
  join plans p on p.id = pr.plan_id
  left join subscriptions s on s.organization_id = pr.organization_id
  where not p_open_only or pr.status in ('awaiting_link', 'link_sent', 'reference_submitted')
     or pr.created_at > now() - interval '30 days';
  return r;
end $$;

create or replace function admin_set_payment_link(p_request uuid, p_link text)
returns void
language plpgsql security definer set search_path = public
as $$
declare r payment_requests%rowtype;
begin
  if not is_platform_admin() then raise exception 'Accès réservé au propriétaire de la plateforme'; end if;
  if coalesce(p_link, '') !~ '^https://\S+$' then raise exception 'Le lien doit commencer par https://'; end if;
  select * into r from payment_requests where id = p_request for update;
  if not found or r.status not in ('awaiting_link', 'link_sent') then raise exception 'Demande introuvable ou déjà traitée'; end if;
  update payment_requests set payment_link = p_link, status = 'link_sent', link_sent_at = now() where id = p_request;
  insert into alerts (organization_id, kind, title, body, link_path)
  values (r.organization_id, 'billing', '💳 Votre lien de paiement est prêt',
          'Montant : ' || fmt_amount(r.amount, r.currency) || '. Payez puis indiquez la référence de transaction dans « Abonnement ».',
          '/abonnement');
end $$;

create or replace function admin_validate_payment(p_request uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare r payment_requests%rowtype; v_step interval; v_end timestamptz;
begin
  if not is_platform_admin() then raise exception 'Accès réservé au propriétaire de la plateforme'; end if;
  select * into r from payment_requests where id = p_request for update;
  if not found or r.status not in ('link_sent', 'reference_submitted') then
    raise exception 'Demande introuvable ou déjà traitée';
  end if;
  v_step := case r.billing_interval when 'year' then interval '1 year' else interval '1 month' end;

  update subscriptions set
    plan_id = r.plan_id, status = 'active', provider = 'neero', billing_interval = r.billing_interval,
    currency = r.currency, amount = r.amount, trial_ends_at = null, cancel_at_period_end = false,
    canceled_at = null,
    current_period_end = greatest(coalesce(current_period_end, now()), now()) + v_step,
    updated_at = now()
  where organization_id = r.organization_id
  returning current_period_end into v_end;

  insert into payments (organization_id, provider, provider_payment_id, plan_id, amount, currency, amount_xaf, status)
  values (r.organization_id, 'neero', coalesce(nullif(r.transaction_ref, ''), 'req_' || r.id), r.plan_id,
          r.amount, r.currency, to_xaf(r.amount, r.currency), 'succeeded')
  on conflict (provider, provider_payment_id) do nothing;

  update payment_requests set status = 'validated', validated_at = now(), validated_by = auth.uid()
   where id = p_request;
  insert into alerts (organization_id, kind, title, body, link_path)
  values (r.organization_id, 'billing', '✅ Paiement validé : votre accès est actif',
          'Merci ! Votre abonnement court jusqu''au ' || to_char(v_end, 'DD/MM/YYYY') || '.', '/abonnement');
end $$;

create or replace function admin_reject_payment(p_request uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare r payment_requests%rowtype;
begin
  if not is_platform_admin() then raise exception 'Accès réservé au propriétaire de la plateforme'; end if;
  select * into r from payment_requests where id = p_request for update;
  if not found or r.status <> 'reference_submitted' then raise exception 'Aucune référence à refuser'; end if;
  update payment_requests set status = 'link_sent',
    rejection_reason = coalesce(nullif(trim(p_reason), ''), 'Paiement introuvable') || ' (réf. ' || coalesce(r.transaction_ref, '—') || ')',
    transaction_ref = null, ref_submitted_at = null
  where id = p_request;
  insert into alerts (organization_id, kind, title, body, link_path)
  values (r.organization_id, 'billing', '⚠️ Paiement non retrouvé',
          coalesce(nullif(trim(p_reason), ''), 'Nous ne retrouvons pas ce paiement.') || ' Vérifiez la référence ou contactez-nous.',
          '/abonnement');
end $$;

-- ---------- Tâches quotidiennes -----------------------------------------

create or replace function billing_daily()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_expired int; v_renewals int := 0; v_reminded int := 0; v_trials int;
  s record; r record; v_amount numeric; v_phone text; v_late text := '';
begin
  v_expired := expire_subscriptions();

  -- Renouvellements : 5 jours avant l'échéance, une demande est préparée pour le propriétaire.
  for s in
    select sb.* from subscriptions sb
    where sb.status = 'active' and sb.provider in ('neero', 'manual')
      and sb.current_period_end between now() and now() + interval '5 days'
      and not exists (select 1 from payment_requests pr where pr.organization_id = sb.organization_id
                        and pr.status in ('awaiting_link', 'link_sent', 'reference_submitted'))
      and not exists (select 1 from payment_requests pr where pr.organization_id = sb.organization_id
                        and pr.kind = 'renewal' and pr.created_at > sb.current_period_end - interval '10 days')
  loop
    select (prices -> coalesce(s.currency, 'XAF') ->> coalesce(s.billing_interval, 'month'))::numeric
      into v_amount from plans where id = s.plan_id;
    select contact_phone into v_phone from payment_requests
     where organization_id = s.organization_id and contact_phone is not null order by created_at desc limit 1;
    insert into payment_requests (organization_id, plan_id, billing_interval, currency, amount, kind, contact_phone)
    values (s.organization_id, s.plan_id, coalesce(s.billing_interval, 'month'), coalesce(s.currency, 'XAF'),
            coalesce(v_amount, s.amount, 0), 'renewal', v_phone);
    v_renewals := v_renewals + 1;
  end loop;

  -- Relance des clients : lien envoyé depuis 2 jours sans paiement déclaré (puis tous les 2 jours).
  for r in
    select pr.*, o.name as org_name from payment_requests pr join organizations o on o.id = pr.organization_id
    where pr.status = 'link_sent' and pr.link_sent_at < now() - interval '2 days'
      and (pr.last_reminder_at is null or pr.last_reminder_at < now() - interval '2 days')
  loop
    insert into alerts (organization_id, kind, title, body, link_path)
    values (r.organization_id, 'billing', '⏳ Votre paiement est en attente',
            'Votre lien de paiement (' || fmt_amount(r.amount, r.currency) || ') vous attend dans « Abonnement ». '
            || 'Une fois payé, indiquez la référence de transaction pour activer votre accès.', '/abonnement');
    update payment_requests set last_reminder_at = now() where id = r.id;
    v_late := v_late || E'\n• ' || r.org_name || ' : ' || fmt_amount(r.amount, r.currency)
              || coalesce(' · WhatsApp ' || r.contact_phone, '');
    v_reminded := v_reminded + 1;
  end loop;
  if v_reminded > 0 then
    perform notify_owner('⏳ Clients relancés (lien envoyé, pas encore payé) :' || v_late);
  end if;

  v_trials := billing_reminders();
  return jsonb_build_object('expired', v_expired, 'renewals', v_renewals, 'reminded', v_reminded, 'trial_reminders', v_trials);
end $$;
revoke execute on function billing_daily() from public, anon, authenticated;

-- Rappel de fin d'essai et d'échéance : formulation sans prestataire de paiement.
create or replace function billing_reminders()
returns int
language plpgsql security definer set search_path = public
as $$
declare n int := 0; s record; v_end timestamptz; v_title text;
begin
  for s in
    select sb.* from subscriptions sb
    where (sb.status in ('trialing', 'pending_payment') and sb.trial_ends_at between now() and now() + interval '3 days')
       or (sb.status = 'active' and sb.provider in ('flutterwave', 'manual', 'neero')
           and sb.current_period_end between now() and now() + interval '3 days')
  loop
    v_end := coalesce(case when s.status <> 'active' then s.trial_ends_at end, s.current_period_end);
    v_title := case when s.status <> 'active' then '⏳ Votre essai Numera Agentic se termine le '
                    else '⏳ Votre abonnement Numera Agentic arrive à échéance le ' end
               || to_char(v_end, 'DD/MM/YYYY');
    if not exists (select 1 from alerts where organization_id = s.organization_id and kind = 'billing' and title = v_title) then
      insert into alerts (organization_id, kind, title, body, link_path)
      values (s.organization_id, 'billing', v_title,
              case when s.status = 'active'
                   then 'Votre lien de renouvellement vous sera envoyé avant l''échéance.'
                   else 'Choisissez votre formule dans « Abonnement » pour que votre agent continue de prospecter.' end,
              '/abonnement');
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function billing_reminders() from public, anon, authenticated;

-- Tous les jours à 7 h UTC (8 h à Douala).
select cron.schedule('numera-billing-daily', '0 7 * * *', 'select public.billing_daily()');

-- ---------- Droits ------------------------------------------------------

revoke execute on function request_subscription(text, text, text, text) from public, anon;
grant  execute on function request_subscription(text, text, text, text) to authenticated;
revoke execute on function submit_payment_reference(uuid, text) from public, anon;
grant  execute on function submit_payment_reference(uuid, text) to authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'admin_payment_requests(boolean)', 'admin_set_payment_link(uuid, text)',
    'admin_validate_payment(uuid)', 'admin_reject_payment(uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke execute on function app_url() from public, anon, authenticated;
revoke execute on function fmt_amount(numeric, text) from public, anon, authenticated;
