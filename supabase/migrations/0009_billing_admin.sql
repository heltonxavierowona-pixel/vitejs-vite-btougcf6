-- =====================================================================
-- Numera Agentic — 0009 : abonnements, paiements & tableau de bord propriétaire
--   * formules (Découverte / Pro / Équipe), prix en XAF, EUR, USD, mensuel ou annuel
--   * essai gratuit de 14 jours à l'inscription
--   * paiements Stripe, PayPal, Flutterwave (Mobile Money) — webhooks idempotents
--   * limites par formule (produits, numéros WhatsApp, actions IA / mois)
--   * espace propriétaire : revenus mensuels (MRR), abonnés, essais, résiliations
-- =====================================================================

-- ---------- Formules ------------------------------------------------------

create table plans (
  id              text primary key,             -- starter | pro | team
  name            text not null,
  description     text not null,
  prices          jsonb not null,               -- {"XAF": {"month": 15000, "year": 150000}, "EUR": {...}, "USD": {...}}
  limits          jsonb not null,               -- {"products": 1, "whatsapp_numbers": 1, "ai_actions": 300, "members": 1}
  features        text[] not null default '{}',
  sort            int not null default 0,
  active          boolean not null default true
);

insert into plans (id, name, description, prices, limits, features, sort) values
('starter', 'Découverte', 'Pour lancer un produit et tester l''agent.',
  '{"XAF": {"month": 15000, "year": 150000}, "EUR": {"month": 25, "year": 250}, "USD": {"month": 27, "year": 270}}',
  '{"products": 1, "whatsapp_numbers": 1, "ai_actions": 300, "members": 1}',
  '{"1 produit", "1 numéro WhatsApp", "300 actions IA / mois", "Pilote automatique WhatsApp", "Alertes Telegram et e-mail"}', 1),
('pro', 'Pro', 'Pour prospecter plusieurs offres, tous les jours.',
  '{"XAF": {"month": 35000, "year": 350000}, "EUR": {"month": 55, "year": 550}, "USD": {"month": 59, "year": 590}}',
  '{"products": 5, "whatsapp_numbers": 3, "ai_actions": 2000, "members": 2}',
  '{"5 produits", "3 numéros WhatsApp", "2 000 actions IA / mois", "Relances automatiques", "Rapports complets"}', 2),
('team', 'Équipe', 'Pour une équipe commerciale et un gros volume.',
  '{"XAF": {"month": 75000, "year": 750000}, "EUR": {"month": 119, "year": 1190}, "USD": {"month": 129, "year": 1290}}',
  '{"products": 20, "whatsapp_numbers": 10, "ai_actions": 8000, "members": 5}',
  '{"20 produits", "10 numéros WhatsApp", "8 000 actions IA / mois", "5 utilisateurs", "Support prioritaire"}', 3);

alter table plans enable row level security;
create policy plans_public on plans for select using (active);   -- visibles par tous les connectés

-- ---------- Réglages de la plateforme (taux de change, moyens de paiement) ----------

create table platform_settings (
  key   text primary key,
  value jsonb not null
);
insert into platform_settings values
  ('reporting_currency', '"XAF"'),
  ('fx_to_xaf', '{"XAF": 1, "EUR": 655.957, "USD": 600}'),          -- EUR fixe (parité), USD à ajuster
  ('trial_days', '14'),
  ('providers', '{"stripe": true, "paypal": true, "flutterwave": true}');
alter table platform_settings enable row level security;
create policy settings_public_read on platform_settings for select
  using (key in ('providers', 'trial_days'));

-- ---------- Propriétaires de la plateforme ----------------------------------

create table platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table platform_admins enable row level security;
-- Aucune policy : table lue uniquement via is_platform_admin().

create or replace function is_platform_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from platform_admins where user_id = auth.uid()) $$;

-- ---------- Abonnements & paiements -------------------------------------------

create table subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null unique references organizations(id) on delete cascade,
  plan_id                  text not null references plans(id),
  status                   text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  provider                 text check (provider in ('stripe', 'paypal', 'flutterwave', 'manual')),
  billing_interval         text check (billing_interval in ('month', 'year')),
  currency                 text,
  amount                   numeric(12, 2),       -- montant par période, dans la devise
  provider_customer_id     text,
  provider_subscription_id text,
  trial_ends_at            timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean not null default false,
  canceled_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create table payments (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  provider            text not null,
  provider_payment_id text not null,
  plan_id             text references plans(id),
  amount              numeric(12, 2) not null,
  currency            text not null,
  amount_xaf          numeric(14, 2) not null,   -- converti à la date du paiement (pour les rapports)
  status              text not null check (status in ('succeeded', 'failed', 'refunded')),
  paid_at             timestamptz not null default now(),
  unique (provider, provider_payment_id)
);
create index on payments (paid_at);

-- Journal brut des webhooks : un même événement n'est jamais appliqué deux fois.
create table billing_events (
  provider    text not null,
  event_id    text not null,
  payload     jsonb not null,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);

-- Identifiants de formules créés chez PayPal / Flutterwave (créés à la demande, une fois).
create table provider_plans (
  provider         text not null,
  plan_id          text not null references plans(id),
  currency         text not null,
  billing_interval text not null,
  external_id      text not null,
  primary key (provider, plan_id, currency, billing_interval)
);

alter table subscriptions  enable row level security;
alter table payments       enable row level security;
alter table billing_events enable row level security;
alter table provider_plans enable row level security;
create policy tenant_read on subscriptions for select using (is_org_member(organization_id) or is_platform_admin());
create policy tenant_read on payments for select using (is_org_member(organization_id) or is_platform_admin());

create or replace function to_xaf(p_amount numeric, p_currency text)
returns numeric language sql stable security definer set search_path = public
as $$
  select round(p_amount * coalesce((value->>upper(p_currency))::numeric, 1), 2)
  from platform_settings where key = 'fx_to_xaf'
$$;

-- ---------- Essai gratuit à la création de l'organisation ---------------------

create or replace function start_trial()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into subscriptions (organization_id, plan_id, status, trial_ends_at)
  values (new.id, 'pro', 'trialing',
          now() + make_interval(days => coalesce((select value::text::int from platform_settings where key = 'trial_days'), 14)))
  on conflict (organization_id) do nothing;
  return new;
end $$;
create trigger organizations_start_trial after insert on organizations
  for each row execute function start_trial();

-- Organisations existantes (créées avant cette migration) : essai aussi.
insert into subscriptions (organization_id, plan_id, status, trial_ends_at)
select id, 'pro', 'trialing', now() + interval '14 days' from organizations
on conflict (organization_id) do nothing;

-- ---------- Droits d'accès et limites ------------------------------------------

-- Accès : essai en cours, abonnement actif, ou payé jusqu'à la fin de la période
-- (même résilié) ; 3 jours de grâce en cas d'échec de paiement.
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

-- Pour la plateforme (utilisateur connecté).
create or replace function my_entitlements()
returns jsonb language sql stable security definer set search_path = public
as $$ select org_entitlements((select organization_id from organization_members where user_id = auth.uid() limit 1)) $$;

-- Garde-fou des limites : produits et numéros WhatsApp.
create or replace function enforce_plan_limits()
returns trigger language plpgsql security definer set search_path = public
as $$
declare e jsonb; used int; lim int; what text;
begin
  e := org_entitlements(new.organization_id);
  if e is null then return new; end if;
  if not (e->>'has_access')::boolean then
    raise exception 'Abonnement inactif : renouvelez-le dans « Abonnement »' using errcode = 'P0402';
  end if;
  if tg_table_name = 'products' then
    what := 'products';
  elsif new.channel = 'whatsapp' then
    what := 'whatsapp_numbers';
  else
    return new;
  end if;
  used := (e->'usage'->>what)::int;
  lim := (e->'limits'->>what)::int;
  if used >= lim then
    raise exception 'Limite de votre formule atteinte (% / %). Passez à la formule supérieure dans « Abonnement ».', used, lim
      using errcode = 'P0402';
  end if;
  return new;
end $$;
create trigger products_plan_limits before insert on products
  for each row execute function enforce_plan_limits();
create trigger channel_accounts_plan_limits before insert on channel_accounts
  for each row execute function enforce_plan_limits();

-- Quota IA (appelé par les Edge Functions avant chaque appel au modèle).
create or replace function ai_quota_ok(p_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce((e->>'has_access')::boolean and (e->'usage'->>'ai_actions')::int < (e->'limits'->>'ai_actions')::int, true)
  from (select org_entitlements(p_org) as e) x
$$;

-- ---------- Application des événements de paiement (webhooks) -----------------
-- Format commun produit par l'Edge Function billing-webhook :
-- {provider, event_id, kind, organization_id, plan_id, interval, currency, amount,
--  customer_id, subscription_id, payment_id, period_end}
-- kind : subscription_active | payment_succeeded | payment_failed | subscription_canceled

create or replace function billing_apply(p jsonb)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_org      uuid := (p->>'organization_id')::uuid;
  v_kind     text := p->>'kind';
  v_interval text := coalesce(p->>'interval', 'month');
  v_step     interval;
  v_inserted int;
begin
  insert into billing_events (provider, event_id, payload)
  values (p->>'provider', p->>'event_id', p)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return 'duplicate'; end if;
  if v_org is null then return 'ignored'; end if;

  v_step := case v_interval when 'year' then interval '1 year' else interval '1 month' end;

  if v_kind in ('subscription_active', 'payment_succeeded') then
    insert into subscriptions (organization_id, plan_id, status, provider, billing_interval, currency, amount,
                               provider_customer_id, provider_subscription_id, current_period_end)
    values (v_org, coalesce(p->>'plan_id', 'pro'), 'active', p->>'provider', v_interval, p->>'currency',
            (p->>'amount')::numeric, p->>'customer_id', p->>'subscription_id',
            coalesce((p->>'period_end')::timestamptz, now() + v_step))
    on conflict (organization_id) do update set
      plan_id                  = coalesce(p->>'plan_id', subscriptions.plan_id),
      status                   = 'active',
      provider                 = p->>'provider',
      billing_interval         = v_interval,
      currency                 = coalesce(p->>'currency', subscriptions.currency),
      amount                   = coalesce((p->>'amount')::numeric, subscriptions.amount),
      provider_customer_id     = coalesce(p->>'customer_id', subscriptions.provider_customer_id),
      provider_subscription_id = coalesce(p->>'subscription_id', subscriptions.provider_subscription_id),
      trial_ends_at            = null,
      cancel_at_period_end     = false,
      -- Période : date donnée par le prestataire, sinon prolongation (paiement Mobile Money mois par mois).
      current_period_end       = coalesce((p->>'period_end')::timestamptz,
                                   case when v_kind = 'payment_succeeded'
                                        then greatest(coalesce(subscriptions.current_period_end, now()), now()) + v_step
                                        else coalesce(subscriptions.current_period_end, now() + v_step) end),
      updated_at               = now();
  end if;

  if v_kind in ('payment_succeeded', 'payment_failed') and p->>'payment_id' is not null then
    insert into payments (organization_id, provider, provider_payment_id, plan_id, amount, currency, amount_xaf, status)
    values (v_org, p->>'provider', p->>'payment_id', p->>'plan_id', (p->>'amount')::numeric, upper(p->>'currency'),
            to_xaf((p->>'amount')::numeric, p->>'currency'),
            case v_kind when 'payment_succeeded' then 'succeeded' else 'failed' end)
    on conflict (provider, provider_payment_id) do nothing;
  end if;

  if v_kind = 'payment_failed' then
    update subscriptions set status = 'past_due', updated_at = now()
     where organization_id = v_org and status = 'active';
  elsif v_kind = 'subscription_canceled' then
    update subscriptions set status = 'canceled', canceled_at = now(), cancel_at_period_end = true, updated_at = now()
     where organization_id = v_org;
  end if;
  return v_kind;
end $$;
revoke execute on function billing_apply(jsonb) from public, anon, authenticated;

-- Passage en « expiré » des essais et périodes terminées (appelé chaque jour par n8n 00).
create or replace function expire_subscriptions()
returns int language sql security definer set search_path = public
as $$
  with x as (
    update subscriptions set status = 'expired', updated_at = now()
    where (status = 'trialing' and trial_ends_at < now())
       or (status = 'canceled' and current_period_end < now())
       or (status = 'past_due' and current_period_end + interval '3 days' < now())
       or (status = 'active' and provider = 'flutterwave' and current_period_end + interval '3 days' < now())
    returning 1
  ) select count(*)::int from x
$$;
revoke execute on function expire_subscriptions() from public, anon, authenticated;

-- ---------- Espace propriétaire ------------------------------------------------

create or replace function admin_stats(p_months int default 12)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare r jsonb;
begin
  if not is_platform_admin() then raise exception 'Accès réservé au propriétaire de la plateforme'; end if;
  with subs as (
    select s.*, o.name as org_name, p.name as plan_name,
      (select u.email from organization_members m join auth.users u on u.id = m.user_id
        where m.organization_id = s.organization_id and m.role = 'owner' limit 1) as owner_email,
      case when s.status in ('active', 'past_due') or (s.status = 'canceled' and s.current_period_end > now())
           then to_xaf(coalesce(s.amount, 0), coalesce(s.currency, 'XAF'))
                / case s.billing_interval when 'year' then 12 else 1 end
           else 0 end as mrr_xaf
    from subscriptions s join organizations o on o.id = s.organization_id join plans p on p.id = s.plan_id
  ),
  months as (
    select generate_series(date_trunc('month', now()) - make_interval(months => p_months - 1),
                           date_trunc('month', now()), interval '1 month') as m
  )
  select jsonb_build_object(
    'currency', 'XAF',
    'kpis', jsonb_build_object(
      'mrr', (select coalesce(round(sum(mrr_xaf)), 0) from subs),
      'arr', (select coalesce(round(sum(mrr_xaf) * 12), 0) from subs),
      'collected_this_month', (select coalesce(sum(amount_xaf), 0) from payments
                                where status = 'succeeded' and paid_at >= date_trunc('month', now())),
      'active', (select count(*) from subs where status = 'active'),
      'trialing', (select count(*) from subs where status = 'trialing' and trial_ends_at > now()),
      'past_due', (select count(*) from subs where status = 'past_due'),
      'canceled_this_month', (select count(*) from subs where canceled_at >= date_trunc('month', now())),
      'organizations', (select count(*) from organizations),
      'trial_conversion', (select case when count(*) = 0 then null
                                  else round(100.0 * count(*) filter (where status in ('active', 'past_due', 'canceled'))
                                             / count(*)) end
                           from subs where created_at < now() - interval '14 days'),
      'ai_cost_this_month_xaf', (select coalesce(round(sum(cost_usd) * to_xaf(1, 'USD')), 0) from ai_usage
                                  where created_at >= date_trunc('month', now()))),
    'monthly', (select jsonb_agg(jsonb_build_object(
        'month', to_char(m, 'YYYY-MM'),
        'revenue', (select coalesce(sum(amount_xaf), 0) from payments
                     where status = 'succeeded' and date_trunc('month', paid_at) = m),
        'ai_cost', (select coalesce(round(sum(cost_usd) * to_xaf(1, 'USD')), 0) from ai_usage
                     where date_trunc('month', created_at) = m),
        'signups', (select count(*) from organizations where date_trunc('month', created_at) = m)
      ) order by m) from months),
    'by_plan', (select coalesce(jsonb_agg(jsonb_build_object('plan', plan_name, 'subscribers', n, 'mrr', mrr) order by mrr desc), '[]'::jsonb)
                from (select plan_name, count(*) filter (where mrr_xaf > 0) as n, round(sum(mrr_xaf)) as mrr from subs group by plan_name) t),
    'by_provider', (select coalesce(jsonb_agg(jsonb_build_object('provider', provider, 'revenue', total) order by total desc), '[]'::jsonb)
                    from (select provider, sum(amount_xaf) as total from payments
                          where status = 'succeeded' and paid_at >= date_trunc('month', now()) - make_interval(months => p_months - 1)
                          group by provider) t),
    'subscriptions', (select coalesce(jsonb_agg(jsonb_build_object(
        'organization_id', organization_id, 'organization', org_name, 'owner_email', owner_email,
        'plan', plan_name, 'plan_id', plan_id, 'status', status, 'provider', provider, 'currency', currency,
        'amount', amount, 'interval', billing_interval, 'mrr_xaf', round(mrr_xaf),
        'trial_ends_at', trial_ends_at, 'current_period_end', current_period_end, 'created_at', created_at
      ) order by mrr_xaf desc, created_at desc), '[]'::jsonb) from subs),
    'recent_payments', (select coalesce(jsonb_agg(x order by x->>'paid_at' desc), '[]'::jsonb) from (
        select jsonb_build_object('organization', o.name, 'provider', pa.provider, 'amount', pa.amount,
                                  'currency', pa.currency, 'amount_xaf', pa.amount_xaf, 'status', pa.status,
                                  'paid_at', pa.paid_at) as x
        from payments pa join organizations o on o.id = pa.organization_id
        order by pa.paid_at desc limit 15) t)
  ) into r;
  return r;
end $$;

-- Action manuelle du propriétaire : offrir des jours ou activer un abonnement payé hors plateforme
-- (virement, espèces). Tracé comme un paiement « manual » si un montant est donné.
create or replace function admin_grant(p_org uuid, p_plan text, p_days int, p_amount numeric default null,
                                       p_currency text default 'XAF')
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_platform_admin() then raise exception 'Accès réservé au propriétaire de la plateforme'; end if;
  if not exists (select 1 from subscriptions where organization_id = p_org) then
    raise exception 'Organisation introuvable';
  end if;
  update subscriptions set
    plan_id = p_plan,
    status = case when p_amount is null and status = 'trialing' then 'trialing' else 'active' end,
    provider = case when p_amount is null then provider else 'manual' end,
    trial_ends_at = case when p_amount is null and status = 'trialing'
                         then greatest(trial_ends_at, now()) + make_interval(days => p_days) else trial_ends_at end,
    current_period_end = case when p_amount is null and status = 'trialing' then current_period_end
                              else greatest(coalesce(current_period_end, now()), now()) + make_interval(days => p_days) end,
    -- Un montant saisi à la main remplace le tarif en cours, dans SA devise (et sur un mois).
    currency = case when p_amount is null then currency else upper(p_currency) end,
    amount = coalesce(p_amount, amount),
    billing_interval = case when p_amount is null then coalesce(billing_interval, 'month') else 'month' end,
    updated_at = now()
  where organization_id = p_org;
  if p_amount is not null then
    insert into payments (organization_id, provider, provider_payment_id, plan_id, amount, currency, amount_xaf, status)
    values (p_org, 'manual', 'manual_' || gen_random_uuid(), p_plan, p_amount, upper(p_currency),
            to_xaf(p_amount, p_currency), 'succeeded');
  end if;
end $$;

-- ---------- Rappels de renouvellement (paiements Mobile Money, sans prélèvement automatique) ----------

alter table alerts drop constraint alerts_kind_check;
alter table alerts add constraint alerts_kind_check
  check (kind in ('hot', 'approval', 'escalation', 'won', 'test', 'billing'));

-- 3 jours avant la fin de la période (ou de l'essai) : alerte « Renouvelez votre abonnement », une fois par échéance.
create or replace function billing_reminders()
returns int
language plpgsql security definer set search_path = public
as $$
declare n int := 0; s record; v_end timestamptz; v_title text;
begin
  for s in
    select sb.*, o.name from subscriptions sb join organizations o on o.id = sb.organization_id
    where (sb.status = 'trialing' and sb.trial_ends_at between now() and now() + interval '3 days')
       or (sb.status = 'active' and sb.provider in ('flutterwave', 'manual')
           and sb.current_period_end between now() and now() + interval '3 days')
  loop
    v_end := coalesce(case when s.status = 'trialing' then s.trial_ends_at end, s.current_period_end);
    v_title := case when s.status = 'trialing' then '⏳ Votre essai Numera Agentic se termine le '
                    else '⏳ Votre abonnement Numera Agentic arrive à échéance le ' end
               || to_char(v_end, 'DD/MM/YYYY');
    if not exists (select 1 from alerts where organization_id = s.organization_id and kind = 'billing' and title = v_title) then
      insert into alerts (organization_id, kind, title, body, link_path)
      values (s.organization_id, 'billing', v_title,
              'Renouvelez en 1 minute (Mobile Money, carte ou PayPal) pour que votre agent continue de prospecter.',
              '/abonnement');
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function billing_reminders() from public, anon, authenticated;
