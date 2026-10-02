-- =====================================================================
-- Numera Agentic — l'IA ne se met plus en pause d'elle-même.
-- Pause uniquement : client converti (lien d'achat / contact vendeur envoyé,
-- motif « converted »), reprise en main par l'utilisateur (bouton, réponse
-- manuelle), ou garde-fou anti-boucle (60 réponses IA en 24 h).
-- Une « escalade » de l'IA devient une simple alerte : la réponse part quand même.
-- =====================================================================

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
  elsif v_count >= 60 then
    -- Garde-fou anti-boucle (ex. robot contre robot) : seule pause automatique restante.
    update conversations set ai_paused = true, ai_paused_reason = 'escalation:limite de 60 réponses IA en 24 h',
      ai_paused_at = now() where id = c.id;
    return jsonb_build_object('action', 'escalated', 'reason', 'limit');
  end if;

  -- Escalade = alerte pour l'utilisateur ; l'IA continue la conversation.
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

-- Conversations mises en pause par l'IA elle-même : on les relance.
update conversations set ai_paused = false, ai_paused_reason = null, ai_paused_at = null
 where ai_paused and ai_paused_reason like 'escalation:%';
