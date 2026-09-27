-- =====================================================================
-- Numera Agentic — 0006 : conversation WhatsApp autonome & validations (Partie 5)
--   * pilote automatique : l'IA répond seule sur WhatsApp (texte uniquement)
--   * sujets sensibles (prix, remise, devis, contrat, paiement) → validation humaine
--   * passage de relais : demande d'un humain, mécontentement, info inconnue, vocal
--   * reprise en main : interrupteur par conversation, pause dès que l'humain écrit
--   * fusion de prospects en double
-- =====================================================================

alter type message_status add value if not exists 'rejected';

-- Pilote automatique activé par défaut sur WhatsApp, désactivé sur Messenger/Instagram.
update organizations set automation = automation
  || jsonb_build_object('autopilot_whatsapp', coalesce((automation->>'autopilot_whatsapp')::boolean, true),
                        'autopilot_social',   coalesce((automation->>'autopilot_social')::boolean, false));
alter table organizations alter column automation
  set default '{"handoff_auto": true, "min_confidence": 0.7, "autopilot_whatsapp": true, "autopilot_social": false}'::jsonb;

alter table conversations
  add column ai_paused_reason text,           -- manual | human_reply | escalation:<raison>
  add column ai_paused_at     timestamptz;

alter table approvals
  add column conversation_id uuid references conversations(id) on delete cascade,
  add column prospect_id     uuid references prospects(id) on delete cascade,
  add column topics          text[] not null default '{}',
  add column proposed_body   text,            -- texte proposé par l'IA
  add column final_body      text,            -- texte réellement envoyé
  add column expires_at      timestamptz;     -- fin de la fenêtre de 24 h
create index on approvals (organization_id, decision, created_at);

-- ---------- Réponse du pilote automatique (appelée par le serveur) ------
-- Revérifie tous les garde-fous au moment d'écrire, puis :
--   escalate  → pause de l'IA + journal (l'utilisateur est prévenu)
--   sensitive → message « pending_approval » + ligne dans approvals
--   sinon     → message « queued » (envoyé par le workflow 02)

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
  elsif v_count >= 20 then
    p_escalate := true; p_reason := 'limite de 20 réponses IA en 24 h';
  end if;

  if p_escalate then
    update conversations set ai_paused = true, ai_paused_reason = 'escalation:' || coalesce(p_reason, ''),
      ai_paused_at = now() where id = c.id;
    insert into activity_log (organization_id, prospect_id, kind, data)
    values (c.organization_id, c.prospect_id, 'escalation', jsonb_build_object('reason', p_reason));
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

-- ---------- Décision de l'utilisateur sur une validation -----------------
-- approve : envoyer tel quel ; edit : envoyer le texte modifié ; reject : ne rien envoyer.
-- Le passage à « queued » (UPDATE) déclenche le workflow 02 (webhook INSERT + UPDATE).

create or replace function decide_approval(p_approval uuid, p_decision text, p_body text default null)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  ap approvals%rowtype;
  c  conversations%rowtype;
begin
  select * into ap from approvals where id = p_approval for update;
  if not found or not is_org_member(ap.organization_id) then raise exception 'Validation introuvable'; end if;
  if ap.decision is not null then raise exception 'Déjà traitée'; end if;
  if p_decision not in ('approve', 'edit', 'reject') then raise exception 'Décision inconnue'; end if;

  if p_decision = 'reject' then
    update messages set status = 'rejected' where id = ap.message_id;
  else
    select * into c from conversations where id = ap.conversation_id;
    if not conversation_window_open(c) then
      raise exception 'Fenêtre de 24 h fermée : le client doit réécrire, ou utilisez un modèle (Partie 6)';
    end if;
    update messages set status = 'queued',
      body = case when p_decision = 'edit' and coalesce(trim(p_body), '') <> '' then p_body else body end
     where id = ap.message_id and status = 'pending_approval';
  end if;

  update approvals set
    decision   = case p_decision when 'approve' then 'approved' when 'edit' then 'edited' else 'rejected' end,
    final_body = case when p_decision = 'reject' then null
                      when p_decision = 'edit' and coalesce(trim(p_body), '') <> '' then p_body
                      else ap.proposed_body end,
    decided_by = auth.uid(), decided_at = now()
  where id = ap.id;
  return p_decision;
end $$;

-- ---------- L'humain reprend la main -------------------------------------
-- Réponse manuelle depuis la plateforme : même fonction qu'en 0002, plus la pause de l'IA.

create or replace function send_from_inbox(p_conversation uuid, p_body text)
returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_conv conversations%rowtype;
  v_msg  uuid;
begin
  select * into v_conv from conversations where id = p_conversation; -- soumis à RLS
  if not found then raise exception 'Conversation introuvable'; end if;
  if not conversation_window_open(v_conv) then
    raise exception 'Fenêtre de 24 h fermée : utilisez un modèle approuvé' using errcode = 'P0001';
  end if;

  insert into messages (organization_id, conversation_id, channel_account_id,
                        direction, status, body, ai_generated)
  values (v_conv.organization_id, v_conv.id, v_conv.channel_account_id,
          'outbound', 'queued', p_body, false)
  returning id into v_msg;

  update conversations set unread_count = 0, ai_paused = true, ai_paused_reason = 'human_reply',
    ai_paused_at = now()
  where id = v_conv.id;
  return v_msg;
end $$;

-- Message envoyé par l'utilisateur depuis son téléphone (WhatsApp en coexistence) :
-- enregistré dans l'historique, et l'IA se met en pause sur cette conversation.
create or replace function ingest_outbound_echo(
  p_account_external_id text, p_to text, p_external_message_id text, p_body text,
  p_sent_at timestamptz default now()
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_account channel_accounts%rowtype;
  v_conv    uuid;
  v_msg     uuid;
begin
  select * into v_account from channel_accounts where channel = 'whatsapp' and external_id = p_account_external_id;
  if not found then return null; end if;

  select c.id into v_conv from conversations c
    join prospect_identities i on i.prospect_id = c.prospect_id and i.channel_account_id = c.channel_account_id
   where c.channel_account_id = v_account.id and i.external_user_id = p_to;
  if v_conv is null then return null; end if;   -- contact inconnu de la plateforme

  insert into messages (organization_id, conversation_id, channel_account_id, direction, status, body,
                        external_message_id, sent_at, ai_meta)
  values (v_account.organization_id, v_conv, v_account.id, 'outbound', 'sent', p_body,
          p_external_message_id, p_sent_at, '{"source": "phone"}'::jsonb)
  on conflict (channel_account_id, external_message_id) do nothing
  returning id into v_msg;

  if v_msg is not null then
    update conversations set ai_paused = true, ai_paused_reason = 'human_reply', ai_paused_at = now()
     where id = v_conv;
  end if;
  return v_msg;
end $$;

revoke execute on function ingest_outbound_echo(text, text, text, text, timestamptz) from public, anon, authenticated;

-- ---------- Fusion de deux fiches du même prospect ----------------------
-- Ex. commentaire Facebook + message Messenger, ou code WhatsApp effacé.
-- p_keep garde son identité ; tout ce qui appartient à p_merge lui est rattaché.

create or replace function merge_prospects(p_keep uuid, p_merge uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  k  prospects%rowtype;
  m  prospects%rowtype;
  cm conversations%rowtype;
  v_target uuid;
begin
  select * into k from prospects where id = p_keep;
  select * into m from prospects where id = p_merge;
  if k.id is null or m.id is null or k.id = m.id or k.organization_id <> m.organization_id
     or not is_org_member(k.organization_id) then
    raise exception 'Fusion impossible';
  end if;

  for cm in select * from conversations where prospect_id = m.id loop
    select id into v_target from conversations
     where prospect_id = k.id and channel_account_id = cm.channel_account_id;
    if v_target is null then
      update conversations set prospect_id = k.id where id = cm.id;
    else
      update messages set conversation_id = v_target where conversation_id = cm.id;
      update approvals set conversation_id = v_target where conversation_id = cm.id;
      update conversations set
        last_inbound_at  = greatest(last_inbound_at, cm.last_inbound_at),
        last_outbound_at = greatest(last_outbound_at, cm.last_outbound_at),
        last_message_at  = greatest(last_message_at, cm.last_message_at),
        unread_count     = unread_count + cm.unread_count
      where id = v_target;
      delete from conversations where id = cm.id;
    end if;
  end loop;

  update prospect_identities set prospect_id = k.id where prospect_id = m.id;
  update approvals set prospect_id = k.id where prospect_id = m.id;
  update ai_drafts set prospect_id = k.id where prospect_id = m.id;
  update message_classifications set prospect_id = k.id where prospect_id = m.id;
  update activity_log set prospect_id = k.id where prospect_id = m.id;

  update prospects set
    full_name      = coalesce(k.full_name, m.full_name),
    whatsapp_phone = coalesce(k.whatsapp_phone, m.whatsapp_phone),
    whatsapp_opt_in_at = coalesce(k.whatsapp_opt_in_at, m.whatsapp_opt_in_at),
    product_id     = coalesce(k.product_id, m.product_id),
    do_not_contact = k.do_not_contact or m.do_not_contact,
    updated_at     = now()
  where id = k.id;

  -- Le profil relationnel le plus riche est conservé.
  if not exists (select 1 from prospect_profiles where prospect_id = k.id) then
    update prospect_profiles set prospect_id = k.id where prospect_id = m.id;
  end if;

  delete from prospects where id = m.id;
  insert into activity_log (organization_id, prospect_id, kind, data)
  values (k.organization_id, k.id, 'merge', jsonb_build_object('merged', m.id, 'name', m.full_name));
end $$;
