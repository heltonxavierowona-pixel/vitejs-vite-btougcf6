-- =====================================================================
-- Numera Agentic — durcissement des droits (conseils de sécurité Supabase)
-- Par défaut, Supabase donne EXECUTE aux rôles anon et authenticated sur
-- toutes les fonctions du schéma public. On retire ce droit partout,
-- puis on le rend uniquement aux utilisateurs connectés, pour les
-- fonctions que la plateforme appelle.
-- =====================================================================

-- 1. Fonctions de déclencheur : jamais appelées directement.
revoke execute on function handle_new_user()          from public, anon, authenticated;
revoke execute on function start_trial()              from public, anon, authenticated;
revoke execute on function touch_conversation()       from public, anon, authenticated;
revoke execute on function schedule_followups()       from public, anon, authenticated;
revoke execute on function enforce_plan_limits()      from public, anon, authenticated;
revoke execute on function alert_on_prospect_stage()  from public, anon, authenticated;
revoke execute on function alert_on_approval()        from public, anon, authenticated;
revoke execute on function alert_on_escalation()      from public, anon, authenticated;
revoke execute on function protect_org_columns()      from public, anon, authenticated;

-- 2. Réservées au serveur (Edge Functions et n8n, clé service_role).
--    org_entitlements et ai_quota_ok liraient sinon la formule d'une autre organisation.
revoke execute on function org_entitlements(uuid)     from public, anon, authenticated;
revoke execute on function ai_quota_ok(uuid)          from public, anon, authenticated;

-- 3. Réservées aux utilisateurs connectés (chacune vérifie l'organisation ou l'administrateur).
do $$
declare f text;
begin
  foreach f in array array[
    'is_org_member(uuid)',
    'is_platform_admin()',
    'my_entitlements()',
    'to_xaf(numeric, text)',
    'closing_next_action(uuid)',
    'record_closing_step(uuid, text)',
    'resolve_review(uuid, text)',
    'decide_approval(uuid, text, text)',
    'merge_prospects(uuid, uuid)',
    'telegram_link_code()',
    'send_test_alert()',
    'admin_stats(integer)',
    'admin_grant(uuid, text, integer, numeric, text)',
    'send_from_inbox(uuid, text)',
    'mark_conversation_read(uuid)',
    'log_assisted_message(uuid, message_direction, text)',
    'outreach_queue(uuid, channel_type)',
    'prospect_ai_context(uuid, uuid)',
    'dashboard_stats(integer, uuid)',
    'daily_outreach_limit(channel_type, text)',
    'followup_delay(uuid, integer)',
    'channel_label(channel_type)',
    'conversation_window_open(conversations)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- 4. record_closing_step : un appel sans session n'est plus accepté que depuis le serveur.
create or replace function record_closing_step(p_prospect uuid, p_step text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_org uuid;
begin
  select organization_id into v_org from prospects where id = p_prospect;
  if v_org is null
     or (auth.uid() is not null and not is_org_member(v_org))
     or (auth.uid() is null and coalesce(auth.role(), '') <> 'service_role') then
    raise exception 'Prospect introuvable';
  end if;
  if p_step not in ('presentation_sent', 'call_proposed', 'call_booked') then
    raise exception 'Étape inconnue';
  end if;
  update prospects set
    closing_step = p_step,
    stage = case when stage in ('interested', 'whatsapp', 'replied', 'contacted') then 'hot' else stage end,
    presentation_sent_at = case when p_step = 'presentation_sent' then now() else presentation_sent_at end,
    call_proposed_at     = case when p_step = 'call_proposed' then now() else call_proposed_at end,
    call_booked_at       = case when p_step = 'call_booked' then now() else call_booked_at end,
    next_followup_at     = case when p_step = 'call_booked' then null else next_followup_at end,
    updated_at = now()
  where id = p_prospect;
  insert into activity_log (organization_id, prospect_id, kind, data)
  values (v_org, p_prospect, 'closing', jsonb_build_object('step', p_step));
end $$;
revoke execute on function record_closing_step(uuid, text) from public, anon;
grant execute on function record_closing_step(uuid, text) to authenticated;

-- 5. Chemin de recherche fixé sur les fonctions qui n'en avaient pas.
alter function conversation_window_open(conversations)   set search_path = public;
alter function mark_conversation_read(uuid)               set search_path = public;
alter function daily_outreach_limit(channel_type, text)   set search_path = public;
alter function followup_delay(uuid, integer)              set search_path = public;
alter function protect_org_columns()                      set search_path = public;
alter function channel_label(channel_type)                set search_path = public;
