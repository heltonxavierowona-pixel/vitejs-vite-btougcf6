-- =====================================================================
-- Le Closer — 0008 : tableau de bord & alertes (Partie 7)
--   * alertes immédiates (Telegram et/ou e-mail) : prospect chaud, réponse à valider,
--     l'IA passe la main, vente gagnée
--   * chaque utilisateur relie SON Telegram (lien t.me/<bot>?start=<code>)
--   * statistiques agrégées pour le tableau de bord (soumises à RLS)
--   * CORRECTIF : les membres peuvent modifier les réglages de leur organisation
--     (voix de marque, automatisation, rythme) — il manquait la policy UPDATE.
-- =====================================================================

-- ---------- Correctif : modification des réglages de l'organisation ------

create policy org_update on organizations
  for update using (is_org_member(id)) with check (is_org_member(id));

alter table organizations
  add column alert_settings jsonb not null default
    '{"email": null, "events": {"hot": true, "approval": true, "escalation": true, "won": true}}'::jsonb,
  add column telegram_chat_id   text,       -- écrit uniquement par le serveur (bot)
  add column telegram_username  text,
  add column telegram_link_code text unique;

-- Colonnes réservées au serveur : un utilisateur ne peut ni changer sa formule
-- ni rediriger les alertes vers un autre chat Telegram (il peut seulement se déconnecter).
create or replace function protect_org_columns()
returns trigger language plpgsql
as $$
begin
  -- closer.trusted : posé (pour la transaction seulement) par les fonctions serveur ci-dessous.
  if auth.uid() is not null and coalesce(current_setting('closer.trusted', true), '') <> 'on' then
    new.plan := old.plan;
    new.telegram_link_code := old.telegram_link_code;
    if new.telegram_chat_id is not null then
      new.telegram_chat_id := old.telegram_chat_id;
      new.telegram_username := old.telegram_username;
    end if;
  end if;
  return new;
end $$;

create trigger organizations_protect_columns
  before update on organizations
  for each row execute function protect_org_columns();

-- ---------- Alertes ------------------------------------------------------

create table alerts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  prospect_id      uuid references prospects(id) on delete cascade,
  conversation_id  uuid references conversations(id) on delete set null,
  kind             text not null check (kind in ('hot', 'approval', 'escalation', 'won', 'test')),
  title            text not null,
  body             text not null,
  link_path        text,          -- ex. /conversations?c=<id>
  delivery         jsonb not null default '{}'::jsonb,
  sent_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index on alerts (organization_id, created_at desc);
-- Une seule alerte « chaud » et « gagné » par prospect.
create unique index alerts_once on alerts (prospect_id, kind) where kind in ('hot', 'won');

alter table alerts enable row level security;
create policy tenant_read on alerts for select using (is_org_member(organization_id));

create or replace function channel_label(c channel_type) returns text language sql immutable
as $$ select case c when 'linkedin' then 'LinkedIn' when 'x' then 'X' when 'facebook' then 'Facebook'
                    when 'instagram' then 'Instagram' else 'WhatsApp' end $$;

-- Construit et enregistre une alerte (le Database Webhook sur INSERT la déclenche aussitôt).
create or replace function create_alert(p_kind text, p_prospect uuid, p_extra text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  pr      prospects%rowtype;
  v_prod  text;
  v_conv  uuid;
  v_chan  channel_type;
  v_prof  prospect_profiles%rowtype;
  v_name  text;
  v_title text;
  v_body  text;
  v_link  text;
begin
  select * into pr from prospects where id = p_prospect;
  if not found then return; end if;
  select name into v_prod from products where id = pr.product_id;
  select c.id, a.channel into v_conv, v_chan from conversations c
    join channel_accounts a on a.id = c.channel_account_id
   where c.prospect_id = pr.id order by c.last_message_at desc nulls last limit 1;
  select * into v_prof from prospect_profiles where prospect_id = pr.id;
  v_name := coalesce(pr.full_name, 'Un prospect');
  v_link := case when v_conv is not null then '/conversations?c=' || v_conv else '/prospects' end;

  if p_kind = 'hot' then
    v_title := '🔥 Prospect chaud : ' || v_name;
    v_body := concat_ws(E'\n',
      concat_ws(' · ', v_prod, channel_label(v_chan), pr.company),
      case pr.closing_step when 'presentation_sent' then 'Présentation envoyée'
                           when 'call_proposed' then 'Appel proposé'
                           when 'call_booked' then 'Appel planifié' end,
      case when cardinality(v_prof.buying_signals) > 0
           then 'Signaux : ' || array_to_string(v_prof.buying_signals[1:3], ', ') end,
      v_prof.summary);
  elsif p_kind = 'approval' then
    v_title := '⏸ Réponse à valider : ' || v_name;
    v_body := coalesce(p_extra, 'Sujet sensible') || E'\nL''IA attend votre accord avant d''envoyer.';
    v_link := '/validations';
  elsif p_kind = 'escalation' then
    v_title := '🙋 L''IA vous passe la main : ' || v_name;
    v_body := concat_ws(E'\n', concat_ws(' · ', v_prod, channel_label(v_chan)), 'Raison : ' || coalesce(p_extra, 'non précisée'));
  elsif p_kind = 'won' then
    v_title := '🏆 Vente gagnée : ' || v_name;
    v_body := concat_ws(' · ', v_prod, pr.company);
  else
    return;
  end if;

  insert into alerts (organization_id, prospect_id, conversation_id, kind, title, body, link_path)
  values (pr.organization_id, pr.id, v_conv, p_kind, v_title, coalesce(nullif(v_body, ''), '—'), v_link)
  on conflict (prospect_id, kind) where kind in ('hot', 'won') do nothing;
end $$;

revoke execute on function create_alert(text, uuid, text) from public, anon, authenticated;

-- Déclencheurs : les alertes naissent des changements d'état, quel que soit leur auteur
-- (pilote automatique, n8n, bouton dans la plateforme).
create or replace function alert_on_prospect_stage() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.stage = 'hot' and old.stage is distinct from 'hot' then perform create_alert('hot', new.id); end if;
  if new.stage = 'won' and old.stage is distinct from 'won' then perform create_alert('won', new.id); end if;
  return new;
end $$;
create trigger prospects_alert_stage after update of stage on prospects
  for each row execute function alert_on_prospect_stage();

create or replace function alert_on_approval() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform create_alert('approval', new.prospect_id, 'Sujet : ' || array_to_string(new.topics, ', ')
    || E'\nProposition : ' || left(coalesce(new.proposed_body, ''), 200));
  return new;
end $$;
create trigger approvals_alert after insert on approvals
  for each row execute function alert_on_approval();

create or replace function alert_on_escalation() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.ai_paused_reason like 'escalation:%' and new.ai_paused_reason is distinct from old.ai_paused_reason then
    perform create_alert('escalation', new.prospect_id, substr(new.ai_paused_reason, 12));
  end if;
  return new;
end $$;
create trigger conversations_alert_escalation after update of ai_paused_reason on conversations
  for each row execute function alert_on_escalation();

-- Ce que n8n doit envoyer, et où (null si l'événement est désactivé ou sans destination).
create or replace function alert_delivery(p_alert uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select case
    when al.kind <> 'test' and coalesce((o.alert_settings->'events'->>al.kind)::boolean, true) = false then null
    when o.telegram_chat_id is null and coalesce(o.alert_settings->>'email', '') = '' then null
    else jsonb_build_object(
      'alert_id', al.id, 'kind', al.kind, 'title', al.title, 'body', al.body,
      'link_path', al.link_path, 'telegram_chat_id', o.telegram_chat_id,
      'email', nullif(o.alert_settings->>'email', ''))
  end
  from alerts al join organizations o on o.id = al.organization_id
  where al.id = p_alert and al.sent_at is null
$$;

create or replace function mark_alert_sent(p_alert uuid, p_delivery jsonb)
returns void language sql security definer set search_path = public
as $$ update alerts set sent_at = now(), delivery = p_delivery where id = p_alert $$;

revoke execute on function alert_delivery(uuid) from public, anon, authenticated;
revoke execute on function mark_alert_sent(uuid, jsonb) from public, anon, authenticated;

-- ---------- Liaison Telegram --------------------------------------------

-- Code à mettre dans le lien t.me/<bot>?start=<code> (généré à la demande).
create or replace function telegram_link_code()
returns text
language plpgsql security definer set search_path = public
as $$
declare v_org uuid; v_code text;
begin
  select organization_id into v_org from organization_members where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'Organisation introuvable'; end if;
  perform set_config('closer.trusted', 'on', true);
  update organizations set telegram_link_code = coalesce(telegram_link_code,
      'lc_' || replace(gen_random_uuid()::text, '-', ''))
   where id = v_org returning telegram_link_code into v_code;
  perform set_config('closer.trusted', 'off', true);
  return v_code;
end $$;

-- Appelée par n8n quand le bot reçoit « /start <code> ».
create or replace function link_telegram(p_code text, p_chat_id text, p_username text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_name text;
begin
  perform set_config('closer.trusted', 'on', true);
  update organizations set telegram_chat_id = p_chat_id, telegram_username = p_username,
    telegram_link_code = null            -- code à usage unique
   where telegram_link_code = p_code
  returning name into v_name;
  perform set_config('closer.trusted', 'off', true);
  return jsonb_build_object('organization', v_name);   -- organization = null si code inconnu
end $$;
revoke execute on function link_telegram(text, text, text) from public, anon, authenticated;

create or replace function send_test_alert()
returns void
language plpgsql security definer set search_path = public
as $$
declare v_org uuid;
begin
  select organization_id into v_org from organization_members where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'Organisation introuvable'; end if;
  insert into alerts (organization_id, kind, title, body, link_path)
  values (v_org, 'test', '✅ Alerte de test Le Closer', 'Vos alertes fonctionnent.', '/');
end $$;

-- ---------- Statistiques du tableau de bord ------------------------------
-- security invoker : RLS s'applique, chaque utilisateur ne voit que ses chiffres.

create or replace function dashboard_stats(p_days int default 30, p_product uuid default null)
returns jsonb
language sql stable security invoker set search_path = public
as $$
  with period as (select now() - make_interval(days => p_days) as since),
  pr as (
    select p.*,
      case
        when p.source like 'import_linkedin%' then 'linkedin'
        when p.source like 'import_x%' then 'x'
        when p.source like 'facebook%' then 'facebook'
        when p.source like 'instagram%' then 'instagram'
        else 'whatsapp'
      end as channel,
      exists (select 1 from conversations c join messages m on m.conversation_id = c.id
              where c.prospect_id = p.id and m.direction = 'inbound') as replied,
      (p.contacted_at is not null or p.stage <> 'new'
        or exists (select 1 from conversations c join messages m on m.conversation_id = c.id
                   where c.prospect_id = p.id and m.direction = 'outbound')) as contacted,
      (p.intent = 'interested' or p.handoff_proposed_at is not null
        or p.stage in ('interested', 'whatsapp', 'hot', 'won')) as interested,
      (p.whatsapp_opt_in_at is not null or p.stage = 'whatsapp') as on_whatsapp,
      (p.closing_step is not null or p.stage in ('hot', 'won')) as reached_hot
    from prospects p, period
    where p.deleted_at is null and p.created_at >= period.since
      and (p_product is null or p.product_id = p_product)
  ),
  msgs as (
    select m.* from messages m join conversations c on c.id = m.conversation_id
      join prospects p on p.id = c.prospect_id, period
    where m.sent_at >= period.since and (p_product is null or p.product_id = p_product)
  )
  select jsonb_build_object(
    'days', p_days,
    'kpis', jsonb_build_object(
      'prospects',        (select count(*) from pr),
      'contacted',        (select count(*) from pr where contacted),
      'replied',          (select count(*) from pr where contacted and replied),
      'hot_now',          (select count(*) from prospects where stage = 'hot' and deleted_at is null
                             and (p_product is null or product_id = p_product)),
      'calls_booked',     (select count(*) from pr where call_booked_at is not null),
      'won',              (select count(*) from pr where stage = 'won'),
      'pending_approvals',(select count(*) from approvals where decision is null),
      'ai_cost_usd',      (select coalesce(sum(cost_usd), 0) from ai_usage, period where created_at >= period.since),
      'templates_sent',   (select count(*) from msgs where ai_meta->>'kind' = 'followup'),
      'ai_replies',       (select count(*) from msgs where direction = 'outbound' and ai_generated)),
    'funnel', jsonb_build_array(
      jsonb_build_object('stage', 'Prospects', 'n', (select count(*) from pr)),
      jsonb_build_object('stage', 'Contactés', 'n', (select count(*) from pr where contacted)),
      jsonb_build_object('stage', 'Ont répondu', 'n', (select count(*) from pr where replied)),
      jsonb_build_object('stage', 'Intéressés', 'n', (select count(*) from pr where interested)),
      jsonb_build_object('stage', 'Sur WhatsApp', 'n', (select count(*) from pr where on_whatsapp)),
      jsonb_build_object('stage', 'Chauds', 'n', (select count(*) from pr where reached_hot)),
      jsonb_build_object('stage', 'Appel planifié', 'n', (select count(*) from pr where call_booked_at is not null)),
      jsonb_build_object('stage', 'Gagnés', 'n', (select count(*) from pr where stage = 'won'))),
    'by_channel', (select coalesce(jsonb_agg(jsonb_build_object('channel', ch, 'prospects', n, 'hot', h) order by ch), '[]'::jsonb)
                   from (select channel as ch, count(*) as n, count(*) filter (where reached_hot) as h
                         from pr group by channel) t),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'inbound', coalesce(i, 0),
                                                           'outbound', coalesce(o, 0)) order by d), '[]'::jsonb)
              from generate_series(date_trunc('day', (select since from period)), date_trunc('day', now()), '1 day') d
              left join (select date_trunc('day', sent_at) as day,
                                count(*) filter (where direction = 'inbound') as i,
                                count(*) filter (where direction = 'outbound' and status in ('queued', 'sent', 'delivered', 'read')) as o
                         from msgs group by 1) x on x.day = d),
    'ai_cost_by_feature', (select coalesce(jsonb_agg(jsonb_build_object('feature', feature, 'usd', usd) order by usd desc), '[]'::jsonb)
                           from (select feature, round(sum(cost_usd)::numeric, 4) as usd from ai_usage, period
                                 where created_at >= period.since group by feature) f),
    'hot_list', (select coalesce(jsonb_agg(h), '[]'::jsonb) from (
                   select p.id, p.full_name, p.company, p.closing_step, p.updated_at,
                          (select name from products where id = p.product_id) as product,
                          (select c.id from conversations c where c.prospect_id = p.id
                            order by c.last_message_at desc nulls last limit 1) as conversation_id
                   from prospects p
                   where p.stage = 'hot' and p.deleted_at is null and (p_product is null or p.product_id = p_product)
                   order by p.updated_at desc limit 10) h),
    'recent_alerts', (select coalesce(jsonb_agg(a), '[]'::jsonb) from (
                        select kind, title, created_at, link_path from alerts
                        order by created_at desc limit 8) a)
  )
$$;
