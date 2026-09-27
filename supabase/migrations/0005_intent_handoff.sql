-- =====================================================================
-- Numera Agentic — 0005 : détection d'intérêt & bascule WhatsApp (Partie 4)
--   * classification de chaque réponse de prospect (intention + confiance)
--   * machine à états : intérêt explicite → proposition WhatsApp ;
--     neutre / négatif / pas maintenant → archivé sans relance ; stop → ne plus contacter
--   * bascule par lien wa.me avec code personnel : le prospect écrit en premier
--     (consentement + fenêtre 24 h gratuite) et retrouve son historique
--   * réponses LinkedIn / X collées par l'utilisateur (canaux assistés)
-- =====================================================================

alter table prospects
  add column intent             text,
  add column intent_confidence  numeric(3, 2),
  add column needs_review       boolean not null default false,
  add column archived_reason    text,          -- neutral | negative | not_now | stop | manual
  add column archived_at        timestamptz,
  add column do_not_contact     boolean not null default false,
  add column handoff_code       text unique,   -- code personnel dans le lien WhatsApp
  add column handoff_proposed_at timestamptz;

-- Réglages d'automatisation par organisation.
-- handoff_auto : envoyer seul la proposition WhatsApp sur Facebook/Instagram
-- min_confidence : en dessous, l'utilisateur confirme lui-même
alter table organizations add column automation jsonb not null
  default '{"handoff_auto": true, "min_confidence": 0.7}'::jsonb;

alter table ai_drafts drop constraint ai_drafts_kind_check;
alter table ai_drafts add constraint ai_drafts_kind_check
  check (kind in ('invitation', 'opening', 'reply', 'handoff'));

create table message_classifications (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null references organizations(id) on delete cascade,
  message_id       uuid not null references messages(id) on delete cascade,
  prospect_id      uuid not null references prospects(id) on delete cascade,
  intent           text not null check (intent in
                     ('interested', 'curious', 'neutral', 'not_now', 'negative', 'stop', 'other')),
  confidence       numeric(3, 2) not null,
  evidence         text,
  phone            text,
  action           text not null,
  source           text not null default 'ai',   -- ai | rules | human
  created_at       timestamptz not null default now()
);
create index on message_classifications (prospect_id, created_at desc);

alter table message_classifications enable row level security;
create policy tenant_read on message_classifications for select using (is_org_member(organization_id));

-- ---------- Cœur de la machine à états --------------------------------
-- Appliquée par l'IA (apply_intent) ou par l'utilisateur (resolve_review).
-- Renvoie l'action à exécuter : propose_handoff | phone_received | continue |
-- reply | archive | stop | none

create or replace function set_prospect_intent(
  p_prospect uuid, p_channel channel_type, p_intent text, p_phone text default null
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  pr     prospects%rowtype;
  early  boolean;
  action text := 'none';
begin
  select * into pr from prospects where id = p_prospect for update;
  early := pr.stage in ('new', 'contacted', 'replied');

  if p_intent = 'stop' then
    update prospects set stage = 'lost', archived_reason = 'stop', archived_at = now(),
      do_not_contact = true, next_followup_at = null where id = p_prospect;
    action := 'stop';

  elsif pr.do_not_contact then
    action := 'none';

  elsif p_intent = 'interested' then
    update prospects set stage = 'interested'
      where id = p_prospect and stage in ('new', 'contacted', 'replied');
    if p_channel = 'whatsapp' then
      action := 'continue';                         -- déjà sur WhatsApp : place au closing
    elsif p_phone is not null then
      -- Numéro donné volontairement pour être recontacté : consentement explicite.
      update prospects set whatsapp_phone = p_phone, whatsapp_opt_in_at = now() where id = p_prospect;
      action := 'phone_received';
    elsif pr.handoff_proposed_at is null then
      update prospects set
        handoff_code = coalesce(handoff_code, upper(substr(md5(gen_random_uuid()::text), 1, 6))),
        handoff_proposed_at = now()
      where id = p_prospect;
      action := 'propose_handoff';
    end if;

  elsif p_intent = 'curious' then
    update prospects set stage = 'replied' where id = p_prospect and stage in ('new', 'contacted');
    action := 'reply';

  elsif p_intent in ('neutral', 'negative', 'not_now') and early then
    -- Règle du brief : réponse neutre ou négative → arrêt et archivage, sans relance.
    update prospects set stage = 'lost', archived_reason = p_intent, archived_at = now(),
      next_followup_at = null where id = p_prospect;
    action := 'archive';
  end if;

  update prospects set intent = p_intent, needs_review = false, updated_at = now() where id = p_prospect;
  insert into activity_log (organization_id, prospect_id, kind, data)
  values (pr.organization_id, p_prospect, 'intent', jsonb_build_object('intent', p_intent, 'action', action));
  return action;
end $$;

revoke execute on function set_prospect_intent(uuid, channel_type, text, text) from public, anon, authenticated;

-- Appelée côté serveur après classification IA d'un message entrant.
create or replace function apply_intent(
  p_message uuid, p_intent text, p_confidence numeric, p_evidence text, p_phone text,
  p_source text default 'ai'
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  m        messages%rowtype;
  c        conversations%rowtype;
  a        channel_accounts%rowtype;
  pr       prospects%rowtype;
  v_min    numeric;
  v_action text;
begin
  select * into m from messages where id = p_message and direction = 'inbound';
  if not found then raise exception 'Message entrant introuvable'; end if;
  select * into c from conversations where id = m.conversation_id;
  select * into a from channel_accounts where id = m.channel_account_id;
  select * into pr from prospects where id = c.prospect_id;
  select coalesce((automation->>'min_confidence')::numeric, 0.7) into v_min
    from organizations where id = pr.organization_id;

  if exists (select 1 from messages where conversation_id = c.id and direction = 'inbound'
             and sent_at > m.sent_at) then
    v_action := 'superseded';                       -- un message plus récent sera classé
  elsif p_intent = 'stop' and p_confidence >= 0.5 then
    v_action := set_prospect_intent(pr.id, a.channel, 'stop', null);  -- prudence : on respecte le stop
  elsif p_intent in ('interested', 'neutral', 'not_now', 'negative', 'stop') and p_confidence < v_min then
    update prospects set needs_review = true, intent = p_intent, intent_confidence = p_confidence
      where id = pr.id;
    v_action := 'review';
  else
    v_action := set_prospect_intent(pr.id, a.channel, p_intent, p_phone);
  end if;

  update prospects set intent_confidence = p_confidence where id = pr.id;
  insert into message_classifications (organization_id, message_id, prospect_id, intent, confidence,
                                       evidence, phone, action, source)
  values (pr.organization_id, m.id, pr.id, p_intent, p_confidence, left(p_evidence, 300), p_phone,
          v_action, p_source);

  return jsonb_build_object(
    'action', v_action, 'prospect_id', pr.id, 'conversation_id', c.id,
    'channel', a.channel, 'mode', a.mode, 'organization_id', pr.organization_id,
    'handoff_code', (select handoff_code from prospects where id = pr.id),
    'window_open', conversation_window_open(c));
end $$;

revoke execute on function apply_intent(uuid, text, numeric, text, text, text) from public, anon, authenticated;

-- L'utilisateur tranche un cas « à vérifier » (ou corrige l'IA).
create or replace function resolve_review(p_prospect uuid, p_intent text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_org     uuid;
  v_channel channel_type;
begin
  if p_intent not in ('interested', 'curious', 'neutral', 'not_now', 'negative', 'stop', 'other') then
    raise exception 'Intention inconnue: %', p_intent;
  end if;
  select organization_id into v_org from prospects where id = p_prospect;
  -- Vérification explicite : le prospect doit appartenir à l'utilisateur connecté.
  if v_org is null or not is_org_member(v_org) then raise exception 'Prospect introuvable'; end if;

  select a.channel into v_channel
    from conversations c
    join channel_accounts a on a.id = c.channel_account_id
   where c.prospect_id = p_prospect
   order by c.last_inbound_at desc nulls last
   limit 1;

  return set_prospect_intent(p_prospect, coalesce(v_channel, 'linkedin'), p_intent, null);
end $$;

-- ---------- Canaux assistés : journal des messages LinkedIn / X --------
-- Un compte « assisté » par organisation et par canal regroupe ces conversations.

create or replace function log_assisted_message(
  p_prospect uuid, p_direction message_direction, p_body text
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  pr        prospects%rowtype;
  v_channel channel_type;
  v_account uuid;
  v_conv    uuid;
  v_msg     uuid;
begin
  select * into pr from prospects where id = p_prospect;  -- RLS
  if not found then raise exception 'Prospect introuvable'; end if;
  v_channel := coalesce(pr.best_channel, 'linkedin');
  if v_channel not in ('linkedin', 'x') then raise exception 'Canal non assisté'; end if;

  select id into v_account from channel_accounts
   where organization_id = pr.organization_id and channel = v_channel and mode = 'assisted'
   limit 1;
  if v_account is null then
    insert into channel_accounts (organization_id, channel, mode, label, status)
    values (pr.organization_id, v_channel, 'assisted',
            case v_channel when 'linkedin' then 'LinkedIn (assisté)' else 'X (assisté)' end, 'active')
    returning id into v_account;
  end if;

  if not exists (select 1 from prospect_identities where prospect_id = pr.id and channel_account_id = v_account) then
    insert into prospect_identities (organization_id, prospect_id, channel_account_id, external_user_id, display_name)
    values (pr.organization_id, pr.id, v_account, coalesce(pr.profile_url, pr.id::text), pr.full_name);
  end if;

  insert into conversations (organization_id, prospect_id, channel_account_id)
  values (pr.organization_id, pr.id, v_account)
  on conflict (prospect_id, channel_account_id) do update set prospect_id = excluded.prospect_id
  returning id into v_conv;

  if p_direction = 'inbound' then
    update conversations set last_inbound_at = now() where id = v_conv;
    update prospects set stage = 'replied' where id = pr.id and stage in ('new', 'contacted');
  end if;

  -- Statut « sent » pour le sortant : le workflow 02 (envoi API) ne le traite pas.
  insert into messages (organization_id, conversation_id, channel_account_id, direction, status, body)
  values (pr.organization_id, v_conv, v_account, p_direction,
          (case p_direction when 'inbound' then 'received' else 'sent' end)::message_status, p_body)
  returning id into v_msg;
  return v_msg;
end $$;

-- ---------- Ingestion : reconnaître le code de bascule -----------------
-- Même fonction qu'en 0003, plus : un message WhatsApp contenant le code personnel
-- d'un prospect est rattaché à CE prospect (historique conservé), qui passe « sur WhatsApp ».

create or replace function ingest_inbound_message(
  p_channel             channel_type,
  p_account_external_id text,
  p_external_user_id    text,
  p_display_name        text,
  p_external_message_id text,
  p_body                text,
  p_sent_at             timestamptz default now()
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_account  channel_accounts%rowtype;
  v_prospect uuid;
  v_conv     uuid;
  v_msg      uuid;
  v_link     entry_links%rowtype;
begin
  select * into v_account from channel_accounts
   where channel = p_channel and external_id = p_account_external_id;
  if not found then
    raise exception 'Compte de canal inconnu: % / %', p_channel, p_account_external_id;
  end if;

  select prospect_id into v_prospect from prospect_identities
   where channel_account_id = v_account.id and external_user_id = p_external_user_id;

  if v_prospect is null and p_channel = 'whatsapp' then
    select id into v_prospect from prospects
     where organization_id = v_account.organization_id
       and handoff_code is not null
       and p_body ilike '%' || handoff_code || '%'
     limit 1;
    if v_prospect is not null then
      update prospects set stage = 'whatsapp', whatsapp_phone = p_external_user_id,
        whatsapp_opt_in_at = now(), updated_at = now()
      where id = v_prospect and stage not in ('hot', 'won');
      insert into prospect_identities (organization_id, prospect_id, channel_account_id,
                                       external_user_id, display_name)
      values (v_account.organization_id, v_prospect, v_account.id, p_external_user_id, p_display_name);
    end if;
  end if;

  if v_prospect is null then
    select * into v_link from entry_links
     where organization_id = v_account.organization_id
       and p_body ilike '%' || code || '%'
     limit 1;

    insert into prospects (organization_id, full_name, source, stage, product_id,
                           whatsapp_phone, whatsapp_opt_in_at)
    values (v_account.organization_id, p_display_name,
            case when v_link.id is not null then 'lien:' || v_link.label
                 else p_channel::text || '_inbound' end,
            'replied',
            coalesce(v_link.product_id, v_account.default_product_id),
            case when p_channel = 'whatsapp' then p_external_user_id end,
            case when p_channel = 'whatsapp' then now() end)
    returning id into v_prospect;

    if v_link.id is not null then
      update entry_links set conversations = conversations + 1 where id = v_link.id;
    end if;

    insert into prospect_identities (organization_id, prospect_id, channel_account_id,
                                     external_user_id, display_name)
    values (v_account.organization_id, v_prospect, v_account.id,
            p_external_user_id, p_display_name);
  end if;

  insert into conversations (organization_id, prospect_id, channel_account_id, last_inbound_at)
  values (v_account.organization_id, v_prospect, v_account.id, p_sent_at)
  on conflict (prospect_id, channel_account_id)
    do update set last_inbound_at = greatest(conversations.last_inbound_at, excluded.last_inbound_at)
  returning id into v_conv;

  insert into messages (organization_id, conversation_id, channel_account_id, direction,
                        status, body, external_message_id, sent_at)
  values (v_account.organization_id, v_conv, v_account.id, 'inbound',
          'received', p_body, p_external_message_id, p_sent_at)
  on conflict (channel_account_id, external_message_id) do nothing
  returning id into v_msg;

  return v_msg;
end $$;

revoke execute on function ingest_inbound_message from public, anon, authenticated;
