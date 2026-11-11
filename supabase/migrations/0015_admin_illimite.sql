-- =====================================================================
-- Numera Agentic — compte administrateur sans limites.
-- Une organisation dont un membre figure dans platform_admins :
--   * accès toujours actif, même sans abonnement ;
--   * produits, numéros WhatsApp, actions IA, utilisateurs illimités ;
--   * pas de pause anti-boucle (60 réponses IA / 24 h) ;
--   * pas de quota quotidien LinkedIn / X.
-- Restent en place (règles des plateformes, pas de l'application) :
-- fenêtre de 24 h Meta, « ne plus contacter », validation des sujets sensibles.
-- =====================================================================

-- Utilisable depuis les Edge Functions (clé service, sans auth.uid()).
create or replace function org_is_platform_admin(p_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from organization_members m
    join platform_admins a on a.user_id = m.user_id
    where m.organization_id = p_org
  )
$$;
revoke execute on function org_is_platform_admin(uuid) from public, anon, authenticated;
grant execute on function org_is_platform_admin(uuid) to service_role;

create or replace function org_entitlements(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  e     jsonb;
  usage jsonb;
begin
  usage := jsonb_build_object(
    'products', (select count(*) from products where organization_id = p_org),
    'whatsapp_numbers', (select count(*) from channel_accounts where organization_id = p_org and channel = 'whatsapp'),
    'ai_actions', (select count(*) from ai_usage where organization_id = p_org
                     and created_at >= date_trunc('month', now())),
    'members', (select count(*) from organization_members where organization_id = p_org));

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
    'usage', usage)
  into e
  from subscriptions s join plans p on p.id = s.plan_id
  where s.organization_id = p_org;

  if org_is_platform_admin(p_org) then
    e := coalesce(e, jsonb_build_object(
           'plan_id', 'admin', 'provider', null, 'trial_ends_at', null,
           'current_period_end', null, 'cancel_at_period_end', false, 'usage', usage))
      || jsonb_build_object(
           'plan_name', 'Administrateur (illimité)',
           'status', 'active',
           'has_access', true,
           'admin_unlimited', true,
           'limits', jsonb_build_object('products', 999999, 'whatsapp_numbers', 999999,
                                        'ai_actions', 999999999, 'members', 999999));
  end if;
  return e;
end $$;
revoke execute on function org_entitlements(uuid) from public, anon, authenticated;

create or replace function ai_quota_ok(p_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select org_is_platform_admin(p_org) or coalesce(
    (e->>'has_access')::boolean and (e->'usage'->>'ai_actions')::int < (e->'limits'->>'ai_actions')::int, true)
  from (select org_entitlements(p_org) as e) x
$$;

create or replace function enforce_plan_limits()
returns trigger language plpgsql security definer set search_path = public
as $$
declare e jsonb; used int; lim int; what text;
begin
  if org_is_platform_admin(new.organization_id) then return new; end if;
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

-- File de prospection LinkedIn / X : pas de quota du jour pour l'administrateur.
create or replace function outreach_queue(p_product uuid, p_channel channel_type)
returns setof prospects
language sql stable security invoker set search_path = public
as $$
  select pr.* from prospects pr
  where pr.product_id = p_product
    and pr.best_channel = p_channel
    and pr.stage = 'new'
    and pr.deleted_at is null
  order by pr.fit_score desc nulls last, pr.created_at
  limit (
    select case when is_platform_admin() then 500 else greatest(0,
      daily_outreach_limit(p_channel, o.outreach_profile)
      - (select count(*) from prospects d
          where d.organization_id = o.id
            and d.best_channel = p_channel
            and d.contacted_at >= date_trunc('day', now()))) end
    from organizations o
    join products p on p.organization_id = o.id
    where p.id = p_product
  )
$$;

-- Pilote automatique : plus de pause anti-boucle pour l'administrateur.
create or replace function queue_autopilot_reply(
  p_conversation uuid, p_body text, p_sensitive boolean, p_topics text[],
  p_escalate boolean, p_reason text, p_model text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c        conversations%rowtype;
  pr       prospects%rowtype;
  v_last   message_direction;
  v_count  int;
  v_msg    uuid;
  v_action text;
begin
  select * into c from conversations where id = p_conversation for update;
  select * into pr from prospects where id = c.prospect_id;
  select direction into v_last from messages where conversation_id = c.id order by sent_at desc limit 1;
  select count(*) into v_count from messages
   where conversation_id = c.id and direction = 'outbound' and ai_generated and sent_at > now() - interval '24 hours';

  if c.ai_paused or pr.do_not_contact then
    return jsonb_build_object('action', 'skipped', 'reason', 'paused');
  elsif v_last is distinct from 'inbound' then
    return jsonb_build_object('action', 'skipped', 'reason', 'already_answered'); -- jamais deux messages d'affilée
  elsif not conversation_window_open(c) then
    return jsonb_build_object('action', 'skipped', 'reason', 'window_closed');
  elsif v_count >= 60 and not org_is_platform_admin(c.organization_id) then
    update conversations set ai_paused = true, ai_paused_reason = 'escalation:limite de 60 réponses IA en 24 h',
      ai_paused_at = now() where id = c.id;
    return jsonb_build_object('action', 'escalated', 'reason', 'limit');
  end if;

  if p_escalate then
    insert into activity_log (organization_id, prospect_id, kind, data)
    values (c.organization_id, c.prospect_id, 'escalation', jsonb_build_object('reason', p_reason));
    perform create_alert('escalation', c.prospect_id, coalesce(p_reason, ''));
  end if;
  if coalesce(trim(p_body), '') = '' then
    return jsonb_build_object('action', 'escalated', 'reason', p_reason);
  end if;

  insert into messages (organization_id, conversation_id, channel_account_id, direction, status, body,
                        ai_generated, ai_meta)
  values (c.organization_id, c.id, c.channel_account_id, 'outbound',
          case when p_sensitive then 'pending_approval' else 'queued' end::message_status,
          p_body, true, jsonb_build_object('kind', 'autopilot', 'model', p_model, 'topics', p_topics))
  returning id into v_msg;

  if p_sensitive then
    insert into approvals (organization_id, message_id, conversation_id, prospect_id, reason, topics,
                           proposed_body, expires_at)
    values (c.organization_id, v_msg, c.id, c.prospect_id,
            coalesce(p_topics[1], 'other'), p_topics, p_body, c.last_inbound_at + interval '24 hours');
    v_action := 'pending_approval';
  else
    v_action := 'queued';
  end if;
  return jsonb_build_object('action', v_action, 'message_id', v_msg);
end $$;
revoke execute on function queue_autopilot_reply(uuid, text, boolean, text[], boolean, text, text)
  from public, anon, authenticated;

-- Conversations de l'administrateur bloquées par l'ancien garde-fou : on les relance.
update conversations c set ai_paused = false, ai_paused_reason = null, ai_paused_at = null
 where c.ai_paused and c.ai_paused_reason like 'escalation:limite%' and org_is_platform_admin(c.organization_id);
