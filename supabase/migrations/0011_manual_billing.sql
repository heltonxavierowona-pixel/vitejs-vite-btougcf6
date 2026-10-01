-- =====================================================================
-- Numera Agentic — encaissement manuel par lien de paiement (Neero)
--
-- 1. Le client remplit le formulaire « S'abonner » (nom, e-mail, téléphone, projet,
--    offre) : demande créée, compte « en attente de paiement ».
-- 2. Si un lien Neero valide est préparé pour cette offre (liens par formule, valables
--    10 jours), il est envoyé tout de suite au client par e-mail. Sinon le client est
--    prévenu que son lien arrive sous quelques heures, et le propriétaire le colle.
-- 3. Le propriétaire est prévenu par e-mail. Tous les e-mails partent de son Gmail
--    (Edge Function send-email, SMTP + mot de passe d'application), comme NUMERA-ai.
-- 4. Le client paie et saisit la référence de transaction ; le propriétaire vérifie
--    dans Neero et clique « Valider » : l'accès s'active, le client est prévenu.
-- 5. Chaque matin : renouvellements 5 jours avant l'échéance, relance des clients
--    qui n'ont pas payé, rappel des liens Neero qui expirent, accès échus coupés.
--
-- Les paiements automatiques (Stripe, PayPal, Flutterwave) sont désactivés ici et
-- se réactivent en remettant billing_mode à 'automatic' et providers à true.
-- =====================================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ---------- Réglages ----------------------------------------------------

insert into platform_settings (key, value) values
  ('billing_mode', '"manual"'),
  ('app_url', '"https://numera-agentic.vercel.app"'),
  ('plan_link_validity_days', '10'),
  -- E-mails : adresse qui reçoit vos alertes, et URL de l'Edge Function send-email
  -- (https://<projet>.supabase.co/functions/v1/send-email), renseignées après déploiement.
  ('notifications', '{"owner_email": null, "mail_function_url": null}')
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
  contact_name     text,
  contact_email    text,
  contact_phone    text,                -- numéro WhatsApp donné par le client
  project          text,
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


-- ---------- Liens Neero préparés par formule ----------------------------
-- Un lien par formule et par période, valable 10 jours (plan_link_validity_days).
-- Un lien expiré n'est jamais envoyé : la demande attend alors un lien collé à la main.

create table plan_links (
  plan_id          text not null references plans(id) on delete cascade,
  billing_interval text not null check (billing_interval in ('month', 'year')),
  url              text not null check (url ~ '^https://\S+$'),
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  last_reminder_at timestamptz,
  updated_by       uuid references auth.users(id),
  primary key (plan_id, billing_interval)
);
alter table plan_links enable row level security;   -- lu et écrit uniquement par les fonctions ci-dessous

-- ---------- E-mails depuis Gmail (Edge Function send-email) -------------
-- La base prépare l'e-mail et l'envoie à send-email par pg_net (après validation de la
-- transaction). Le secret partagé est généré ici et reste dans Vault.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'mail_hook_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'mail_hook_secret');
  end if;
end $$;

-- Journal des envois : visible dans l'espace propriétaire (envoyé, échec et raison).
create table email_log (
  id         bigint generated always as identity primary key,
  to_email   text not null,
  subject    text not null,
  status     text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  error      text,
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
create index on email_log (created_at desc);
alter table email_log enable row level security;   -- lu par admin_email_log, écrit par send-email

create or replace function html_escape(t text) returns text language sql immutable
as $$ select replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') $$;

create or replace function app_url() returns text language sql stable security definer set search_path = public
as $$ select coalesce((select value #>> '{}' from platform_settings where key = 'app_url'), '') $$;

-- Montant lisible : 35 000 FCFA, 55 EUR.
create or replace function fmt_amount(p_amount numeric, p_currency text) returns text language sql immutable
as $$ select replace(to_char(p_amount, 'FM999G999G990'), ',', ' ') || ' ' || case p_currency when 'XAF' then 'FCFA' else p_currency end $$;

-- Appelée par send-email (clé service_role) pour vérifier le secret.
create or replace function mail_hook_check(p_secret text) returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from vault.decrypted_secrets where name = 'mail_hook_secret' and decrypted_secret = p_secret) $$;

-- Mise en page commune : titre, paragraphes (texte brut), bouton.
create or replace function mail_html(p_title text, p_body text, p_button text, p_url text)
returns text language sql immutable
as $$
  select '<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1d2733">'
    || '<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">'
    || '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e3e8ee">'
    || '<tr><td style="padding:20px 28px;border-bottom:1px solid #e3e8ee;font-weight:bold;font-size:18px;color:#0b3a5c">Numera Agentic</td></tr>'
    || '<tr><td style="padding:24px 28px"><h1 style="margin:0 0 16px;font-size:20px;color:#0b3a5c">' || html_escape(p_title) || '</h1>'
    || '<p style="margin:0 0 16px;font-size:15px;line-height:1.55">'
    || replace(replace(html_escape(p_body), E'\n\n', '</p><p style="margin:0 0 16px;font-size:15px;line-height:1.55">'), E'\n', '<br>')
    || '</p>'
    || case when coalesce(p_url, '') <> '' then
         '<p style="margin:24px 0"><a href="' || html_escape(p_url) || '" style="display:inline-block;background:#0b3a5c;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">'
         || html_escape(p_button) || '</a></p>'
         || '<p style="margin:0;font-size:12px;color:#6b7785">Si le bouton ne fonctionne pas, copiez ce lien : ' || html_escape(p_url) || '</p>'
       else '' end
    || '</td></tr></table></td></tr></table></body></html>'
$$;

-- Envoie un e-mail (sans effet tant que mail_function_url n'est pas renseignée).
create or replace function mail_send(p_to text, p_subject text, p_body text,
                                     p_button text default null, p_url text default null)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_url text; v_secret text; v_id bigint;
begin
  if coalesce(p_to, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return; end if;
  select value ->> 'mail_function_url' into v_url from platform_settings where key = 'notifications';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'mail_hook_secret';
  insert into email_log (to_email, subject, status, error)
  values (p_to, left(p_subject, 200),
          case when v_url is null or v_secret is null then 'skipped' else 'queued' end,
          case when v_url is null then 'mail_function_url non renseignée' end)
  returning id into v_id;
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(
    url     := v_url,
    body    := jsonb_build_object('log_id', v_id, 'to', p_to, 'subject', p_subject,
                 'html', mail_html(p_subject, p_body, p_button, p_url),
                 'text', p_body || case when coalesce(p_url, '') <> '' then E'\n\n' || p_button || ' : ' || p_url else '' end),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-mail-secret', v_secret),
    timeout_milliseconds := 20000);
end $$;

-- Telegram, facultatif : jetons dans Vault (telegram_bot_token, owner_telegram_chat_id).
create or replace function notify_owner_telegram(p_text text)
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

-- Prévient le propriétaire : e-mail vers son adresse, et Telegram si configuré.
create or replace function notify_owner(p_title text, p_body text, p_action_label text default 'Ouvrir l''espace propriétaire')
returns void
language plpgsql security definer set search_path = public
as $$
declare v_to text;
begin
  select value ->> 'owner_email' into v_to from platform_settings where key = 'notifications';
  perform mail_send(v_to, p_title, p_body, p_action_label, app_url() || '/admin');
  perform notify_owner_telegram(p_title || E'\n' || p_body || E'\n\n' || app_url() || '/admin');
end $$;

-- Destinataire côté client : l'adresse du formulaire, sinon celle du compte.
create or replace function request_recipient(r payment_requests)
returns text language sql stable security definer set search_path = public
as $$
  select coalesce(nullif(r.contact_email, ''),
    (select u.email from organization_members m join auth.users u on u.id = m.user_id
      where m.organization_id = r.organization_id and m.role = 'owner' limit 1))
$$;

-- E-mails au client, selon l'étape de sa demande.
create or replace function client_mail(p_kind text, r payment_requests, p_extra jsonb default '{}')
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_name text; v_project text; v_plan text; v_offer text; v_amount text; v_subject text; v_body text;
  v_button text; v_url text; v_follow text := app_url() || '/abonnement';
begin
  select coalesce(nullif(r.contact_name, ''), o.name), coalesce(nullif(r.project, ''), o.name), p.name
    into v_name, v_project, v_plan
    from organizations o, plans p where o.id = r.organization_id and p.id = r.plan_id;
  v_offer := v_plan || ', ' || case r.billing_interval when 'year' then '1 an' else '1 mois' end;
  v_amount := fmt_amount(r.amount, r.currency);

  if p_kind = 'link' then
    v_subject := 'Votre lien de paiement Numera Agentic : ' || v_plan;
    v_body := 'Bonjour ' || v_name || E',\n\nMerci pour votre demande d''abonnement pour « ' || v_project || E' ».\n'
      || 'Offre : ' || v_offer || E'\nMontant : ' || v_amount
      || E'\n\nPayez avec le lien sécurisé ci-dessous (Mobile Money ou carte). Une fois le paiement effectué, '
      || 'indiquez la référence de transaction dans votre espace « Abonnement » (' || v_follow || E') : '
      || 'votre accès est activé dès sa vérification.';
    v_button := 'Payer ' || v_amount; v_url := r.payment_link;
  elsif p_kind = 'pending' then
    v_subject := 'Demande d''abonnement reçue : ' || v_plan;
    v_body := 'Bonjour ' || v_name || E',\n\nNous avons bien reçu votre demande d''abonnement pour « ' || v_project || E' ».\n'
      || 'Offre : ' || v_offer || E'\nMontant : ' || v_amount
      || E'\n\nVotre lien de paiement vous sera envoyé par e-mail sous quelques heures.';
    v_button := 'Suivre ma demande'; v_url := v_follow;
  elsif p_kind = 'rejected' then
    v_subject := 'Paiement non retrouvé : référence ' || coalesce(p_extra ->> 'ref', '—');
    v_body := 'Bonjour ' || v_name || E',\n\nNous ne retrouvons pas le paiement correspondant à la référence '
      || coalesce(p_extra ->> 'ref', '—') || ' (' || coalesce(p_extra ->> 'reason', 'paiement introuvable') || E').\n\n'
      || 'Vérifiez la référence reçue après le paiement et renvoyez-la depuis votre espace « Abonnement ». '
      || 'Si vous n''avez pas encore payé, utilisez ce lien : ' || coalesce(r.payment_link, v_follow);
    v_button := 'Renvoyer la référence'; v_url := v_follow;
  elsif p_kind = 'activated' then
    v_subject := 'Paiement validé : votre accès Numera Agentic est actif';
    v_body := 'Bonjour ' || v_name || E',\n\nMerci ! Votre paiement de ' || v_amount || ' est validé. '
      || 'Votre formule ' || v_plan || ' est active jusqu''au ' || coalesce(p_extra ->> 'end_date', '—') || E'.\n\n'
      || 'Votre agent peut reprendre la prospection.';
    v_button := 'Ouvrir Numera Agentic'; v_url := app_url();
  elsif p_kind = 'reminder' then
    v_subject := 'Rappel : votre paiement Numera Agentic est en attente';
    v_body := 'Bonjour ' || v_name || E',\n\nVotre lien de paiement (' || v_offer || ', ' || v_amount || ') vous attend toujours.'
      || E'\n\nUne fois le paiement effectué, indiquez la référence de transaction dans votre espace « Abonnement » '
      || 'pour activer votre accès.';
    v_button := 'Payer ' || v_amount; v_url := coalesce(r.payment_link, v_follow);
  else
    return;
  end if;
  perform mail_send(request_recipient(r), v_subject, v_body, v_button, v_url);
end $$;

-- Test depuis l'espace propriétaire : e-mail vers l'adresse des alertes.
create or replace function admin_test_email()
returns text
language plpgsql security definer set search_path = public
as $$
declare v_to text; v_url text;
begin
  if not is_platform_admin() then raise exception 'Accès réservé au propriétaire de la plateforme'; end if;
  select value ->> 'owner_email', value ->> 'mail_function_url' into v_to, v_url from platform_settings where key = 'notifications';
  if v_to is null then raise exception 'Adresse des alertes non renseignée (platform_settings.notifications.owner_email)'; end if;
  if v_url is null then raise exception 'Fonction d''envoi non configurée (platform_settings.notifications.mail_function_url)'; end if;
  perform mail_send(v_to, 'Test : les e-mails Numera Agentic fonctionnent',
    E'Bonjour,\n\nCet e-mail confirme que votre plateforme peut envoyer des e-mails depuis votre Gmail.',
    'Ouvrir l''espace propriétaire', app_url() || '/admin');
  return v_to;
end $$;

create or replace function admin_email_log(p_limit int default 10)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare r jsonb;
begin
  if not is_platform_admin() then raise exception 'Accès réservé au propriétaire de la plateforme'; end if;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc), '[]'::jsonb) into r
  from (select id, to_email, subject, status, error, created_at, sent_at from email_log
        order by created_at desc limit least(greatest(p_limit, 1), 50)) e;
  return r;
end $$;

-- Avant l'enregistrement : lien préparé valide pour cette offre → envoyé tout de suite.
create or replace function payment_request_attach_link() returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_url text;
begin
  if new.status = 'awaiting_link' and new.payment_link is null and new.currency = 'XAF' then
    select url into v_url from plan_links
     where plan_id = new.plan_id and billing_interval = new.billing_interval and expires_at > now();
    if v_url is not null then
      new.payment_link := v_url;
      new.status := 'link_sent';
      new.link_sent_at := now();
    end if;
  end if;
  return new;
end $$;
create trigger payment_requests_attach_link before insert on payment_requests
  for each row execute function payment_request_attach_link();

create or replace function payment_request_notify() returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_to text; v_who text; v_end timestamptz; v_plan text;
begin
  v_to := request_recipient(new);
  select name into v_plan from plans where id = new.plan_id;
  v_who := concat_ws(E'\n',
    'Client : ' || coalesce(new.contact_name, '?') || coalesce(' · ' || v_to, ''),
    'Projet : ' || coalesce(new.project, (select name from organizations where id = new.organization_id)),
    'Téléphone : ' || coalesce(new.contact_phone, '—'),
    'Offre : ' || v_plan || ' · ' || case new.billing_interval when 'year' then '1 an' else '1 mois' end,
    'Montant : ' || fmt_amount(new.amount, new.currency));

  if tg_op = 'INSERT' then
    perform client_mail(case when new.status = 'link_sent' then 'link' else 'pending' end, new);
    perform notify_owner(
      case new.kind when 'renewal' then 'Renouvellement : ' else 'Nouvel abonnement : ' end
        || coalesce(new.project, new.contact_name, 'client'),
      v_who || E'\n\n' || case when new.status = 'link_sent'
        then 'Lien Neero envoyé automatiquement au client. Vérifiez le paiement dans Neero dès qu''il déclare sa référence.'
        else 'Aucun lien Neero valide pour cette offre : collez un lien dans l''espace propriétaire.' end,
      case when new.status = 'link_sent' then 'Voir les paiements' else 'Coller le lien Neero' end);

  elsif new.status = 'link_sent' and old.status = 'awaiting_link' then
    perform client_mail('link', new);

  elsif new.status = 'reference_submitted' and old.status is distinct from 'reference_submitted' then
    perform notify_owner('Paiement déclaré : ' || coalesce(new.project, new.contact_name, 'client'),
      v_who || E'\nRéférence : ' || coalesce(new.transaction_ref, '—')
        || E'\n\nVérifiez ce paiement dans Neero, puis validez-le.', 'Valider le paiement');

  elsif new.status = 'link_sent' and old.status = 'reference_submitted' then
    perform client_mail('rejected', new, jsonb_build_object(
      'ref', coalesce(old.transaction_ref, '—'),
      'reason', coalesce(split_part(new.rejection_reason, ' (réf.', 1), 'paiement introuvable')));

  elsif new.status = 'validated' and old.status is distinct from 'validated' then
    select current_period_end into v_end from subscriptions where organization_id = new.organization_id;
    perform client_mail('activated', new,
      jsonb_build_object('end_date', to_char(v_end at time zone 'Africa/Douala', 'DD/MM/YYYY')));
  end if;
  return new;
end $$;

create trigger payment_requests_notify after insert or update of status on payment_requests
  for each row execute function payment_request_notify();

-- ---------- Côté client -------------------------------------------------

create or replace function request_subscription(
  p_plan text, p_interval text, p_currency text, p_phone text,
  p_name text default null, p_email text default null, p_project text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_org uuid; v_amount numeric; v_id uuid; v_phone text; v_email text;
begin
  select organization_id into v_org from organization_members where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'Organisation introuvable'; end if;
  if p_interval not in ('month', 'year') then raise exception 'Période inconnue'; end if;
  select (prices -> upper(p_currency) ->> p_interval)::numeric into v_amount from plans where id = p_plan and active;
  if v_amount is null then raise exception 'Formule ou devise indisponible'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Indiquez votre nom'; end if;
  v_email := lower(trim(coalesce(p_email, '')));
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Adresse e-mail invalide'; end if;
  v_phone := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  if v_phone is null or length(regexp_replace(v_phone, '\D', '', 'g')) < 8 then
    raise exception 'Indiquez votre numéro de téléphone (WhatsApp)';
  end if;

  update payment_requests set status = 'canceled'
   where organization_id = v_org and status in ('awaiting_link', 'link_sent', 'reference_submitted');

  insert into payment_requests (organization_id, plan_id, billing_interval, currency, amount, kind,
                                contact_name, contact_email, contact_phone, project, created_by)
  values (v_org, p_plan, p_interval, upper(p_currency), v_amount,
          case when exists (select 1 from subscriptions where organization_id = v_org and status = 'active') then 'renewal' else 'new' end,
          left(trim(p_name), 120), v_email, v_phone,
          left(coalesce(nullif(trim(p_project), ''), (select name from organizations where id = v_org)), 120),
          auth.uid())
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
  if exists (select 1 from payment_requests where transaction_ref = trim(p_ref) and status = 'validated') then
    raise exception 'Cette référence a déjà été utilisée';
  end if;
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
      'owner_email', request_recipient(pr), 'contact_name', pr.contact_name, 'project', pr.project,
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

-- Liens préparés : une ligne par formule et par période, avec leur validité.
create or replace function admin_plan_links()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare r jsonb;
begin
  if not is_platform_admin() then raise exception 'Accès réservé au propriétaire de la plateforme'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'plan_id', p.id, 'plan', p.name, 'interval', i.iv,
      'amount', (p.prices -> 'XAF' ->> i.iv)::numeric,
      'url', l.url, 'created_at', l.created_at, 'expires_at', l.expires_at)
    order by p.sort, i.iv), '[]'::jsonb)
  into r
  from plans p
  cross join (values ('month'), ('year')) as i(iv)
  left join plan_links l on l.plan_id = p.id and l.billing_interval = i.iv
  where p.active and coalesce((p.prices -> 'XAF' ->> i.iv)::numeric, 0) > 0;
  return r;
end $$;

-- Enregistre un lien préparé (valable 10 jours) et l'envoie aux demandes qui l'attendaient.
create or replace function admin_set_plan_link(p_plan text, p_interval text, p_url text)
returns int
language plpgsql security definer set search_path = public
as $$
declare v_days int; n int;
begin
  if not is_platform_admin() then raise exception 'Accès réservé au propriétaire de la plateforme'; end if;
  if coalesce(p_url, '') !~ '^https://\S+$' then raise exception 'Le lien doit commencer par https://'; end if;
  if p_interval not in ('month', 'year') then raise exception 'Période inconnue'; end if;
  select coalesce((value #>> '{}')::int, 10) into v_days from platform_settings where key = 'plan_link_validity_days';
  insert into plan_links (plan_id, billing_interval, url, created_at, expires_at, updated_by)
  values (p_plan, p_interval, trim(p_url), now(), now() + make_interval(days => coalesce(v_days, 10)), auth.uid())
  on conflict (plan_id, billing_interval) do update set
    url = excluded.url, created_at = excluded.created_at, expires_at = excluded.expires_at,
    last_reminder_at = null, updated_by = excluded.updated_by;

  with sent as (
    update payment_requests set payment_link = trim(p_url), status = 'link_sent', link_sent_at = now()
    where status = 'awaiting_link' and plan_id = p_plan and billing_interval = p_interval and currency = 'XAF'
    returning 1
  ) select count(*) into n from sent;
  return n;
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
  update payment_requests set payment_link = trim(p_link), status = 'link_sent', link_sent_at = now() where id = p_request;
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
  v_expired int; v_renewals int := 0; v_reminded int := 0; v_trials int; v_links int := 0;
  s record; r payment_requests%rowtype; l record; v_amount numeric; v_last payment_requests%rowtype;
  v_late text := ''; v_list text := '';
begin
  v_expired := expire_subscriptions();

  -- Renouvellements : 5 jours avant l'échéance (le lien préparé part tout seul s'il est valide).
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
    select * into v_last from payment_requests
     where organization_id = s.organization_id order by created_at desc limit 1;
    insert into payment_requests (organization_id, plan_id, billing_interval, currency, amount, kind,
                                  contact_name, contact_email, contact_phone, project)
    values (s.organization_id, s.plan_id, coalesce(s.billing_interval, 'month'), coalesce(s.currency, 'XAF'),
            coalesce(v_amount, s.amount, 0), 'renewal',
            v_last.contact_name, v_last.contact_email, v_last.contact_phone, v_last.project);
    v_renewals := v_renewals + 1;
  end loop;

  -- Relance des clients : lien envoyé depuis 2 jours sans paiement déclaré (puis tous les 2 jours).
  for r in
    select pr.* from payment_requests pr
    where pr.status = 'link_sent' and pr.link_sent_at < now() - interval '2 days'
      and (pr.last_reminder_at is null or pr.last_reminder_at < now() - interval '2 days')
  loop
    perform client_mail('reminder', r);
    insert into alerts (organization_id, kind, title, body, link_path)
    values (r.organization_id, 'billing', '⏳ Votre paiement est en attente',
            'Votre lien de paiement (' || fmt_amount(r.amount, r.currency) || ') vous attend dans « Abonnement ». '
            || 'Une fois payé, indiquez la référence de transaction pour activer votre accès.', '/abonnement');
    update payment_requests set last_reminder_at = now() where id = r.id;
    v_late := v_late || E'\n• ' || coalesce(r.project, r.contact_name, '?') || ' : ' || fmt_amount(r.amount, r.currency)
              || coalesce(' · ' || r.contact_phone, '');
    v_reminded := v_reminded + 1;
  end loop;
  if v_reminded > 0 then
    perform notify_owner('⏳ ' || v_reminded || ' client(s) relancé(s)',
      'Lien envoyé, paiement pas encore déclaré :' || v_late, 'Voir les paiements');
  end if;

  -- Liens Neero : rappel dès le 9e jour (expiration sous 24 h) et pour les liens expirés, une fois par jour.
  for l in
    select pl.*, p.name as plan_name from plan_links pl join plans p on p.id = pl.plan_id
    where pl.expires_at < now() + interval '1 day'
      and (pl.last_reminder_at is null or pl.last_reminder_at < now() - interval '20 hours')
  loop
    v_list := v_list || E'\n• ' || l.plan_name || ' · ' || case l.billing_interval when 'year' then 'annuel' else 'mensuel' end
              || case when l.expires_at < now() then ' : expiré' else ' : expire le ' || to_char(l.expires_at at time zone 'Africa/Douala', 'DD/MM à HH24:MI') end;
    update plan_links set last_reminder_at = now() where plan_id = l.plan_id and billing_interval = l.billing_interval;
    v_links := v_links + 1;
  end loop;
  if v_links > 0 then
    perform notify_owner('🔗 Liens Neero à renouveler',
      'Générez de nouveaux liens dans Neero et collez-les dans l''espace propriétaire :' || v_list
      || E'\n\nUn lien expiré n''est jamais envoyé : les clients attendraient un lien collé à la main.',
      'Renouveler les liens');
  end if;

  v_trials := billing_reminders();
  return jsonb_build_object('expired', v_expired, 'renewals', v_renewals, 'reminded', v_reminded,
                            'links_to_renew', v_links, 'trial_reminders', v_trials);
end $$;

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

-- Tous les jours à 7 h UTC (8 h à Douala).
select cron.schedule('numera-billing-daily', '0 7 * * *', 'select public.billing_daily()');

-- ---------- Droits ------------------------------------------------------

do $$
declare f text;
begin
  -- Fonctions internes : serveur uniquement.
  foreach f in array array[
    'html_escape(text)', 'app_url()', 'fmt_amount(numeric, text)', 'mail_hook_check(text)',
    'mail_html(text, text, text, text)', 'mail_send(text, text, text, text, text)',
    'notify_owner_telegram(text)', 'notify_owner(text, text, text)',
    'request_recipient(payment_requests)', 'client_mail(text, payment_requests, jsonb)',
    'payment_request_attach_link()', 'payment_request_notify()', 'billing_daily()', 'billing_reminders()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  -- Plateforme : utilisateurs connectés (chaque fonction vérifie l'organisation ou l'administrateur).
  foreach f in array array[
    'request_subscription(text, text, text, text, text, text, text)', 'submit_payment_reference(uuid, text)',
    'admin_payment_requests(boolean)', 'admin_plan_links()', 'admin_set_plan_link(text, text, text)',
    'admin_set_payment_link(uuid, text)', 'admin_validate_payment(uuid)', 'admin_reject_payment(uuid, text)',
    'admin_test_email()', 'admin_email_log(integer)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
grant execute on function mail_hook_check(text) to service_role;
grant select, update on email_log to service_role;
