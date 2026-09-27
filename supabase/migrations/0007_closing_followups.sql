-- =====================================================================
-- Le Closer — 0007 : closing & relances (Partie 6)
--   Closing : prospect prêt → présentation / lien, PUIS demande d'appel.
--   Relances : intéressé mais silencieux → 2 relances espacées, puis abandon.
--   WhatsApp hors fenêtre 24 h → modèles approuvés par Meta.
-- =====================================================================

-- ---------- Supports de closing par produit ---------------------------
-- {"presentation_url": "...", "presentation_label": "Présentation Core HR (PDF)",
--  "booking_url": "https://cal.com/...", "call_minutes": 20}
alter table products add column closing jsonb not null default '{}'::jsonb;

alter table prospects
  add column closing_step          text check (closing_step in ('presentation_sent', 'call_proposed', 'call_booked')),
  add column presentation_sent_at  timestamptz,
  add column call_proposed_at      timestamptz,
  add column call_booked_at        timestamptz,
  add column followup_due          boolean not null default false, -- relance à faire par l'utilisateur
  add column last_followup_at      timestamptz;

-- Relances : activées, délais en jours (relance 1, puis relance 2 / abandon).
update organizations set automation = automation
  || jsonb_build_object('followups_enabled', coalesce((automation->>'followups_enabled')::boolean, true),
                        'followup_delays', coalesce(automation->'followup_delays', '[2, 5]'::jsonb));
alter table organizations alter column automation set default
  '{"handoff_auto": true, "min_confidence": 0.7, "autopilot_whatsapp": true, "autopilot_social": false,
    "followups_enabled": true, "followup_delays": [2, 5]}'::jsonb;

alter table ai_drafts drop constraint ai_drafts_kind_check;
alter table ai_drafts add constraint ai_drafts_kind_check
  check (kind in ('invitation', 'opening', 'reply', 'handoff', 'followup'));

-- ---------- Modèles WhatsApp (message templates) -----------------------

create table whatsapp_templates (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations(id) on delete cascade,
  channel_account_id uuid not null references channel_accounts(id) on delete cascade,
  purpose            text not null check (purpose in ('followup_1', 'followup_2')),
  name               text not null,          -- ex. closer_relance_1_fr
  language           text not null,          -- fr, en
  category           text not null default 'MARKETING',
  body               text not null,          -- avec {{1}} = prénom, {{2}} = produit
  status             text not null default 'draft', -- draft | PENDING | APPROVED | REJECTED | PAUSED
  meta_template_id   text,
  rejected_reason    text,
  updated_at         timestamptz not null default now(),
  unique (channel_account_id, name, language)
);
alter table whatsapp_templates enable row level security;
create policy tenant_all on whatsapp_templates for all
  using (is_org_member(organization_id)) with check (is_org_member(organization_id));

-- ---------- Délais de relance -----------------------------------------

create or replace function followup_delay(p_org uuid, p_index int)
returns interval language sql stable
as $$
  select make_interval(days => coalesce(
    ((select automation->'followup_delays' from organizations where id = p_org) ->> p_index)::int,
    case p_index when 0 then 2 else 5 end))
$$;

-- ---------- Planification automatique ---------------------------------
-- Message du prospect → compteur remis à zéro, plus rien de prévu.
-- Notre message à un prospect intéressé → première relance planifiée.

create or replace function schedule_followups()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare pr prospects%rowtype;
begin
  select p.* into pr from prospects p join conversations c on c.prospect_id = p.id
   where c.id = new.conversation_id;

  if new.direction = 'inbound' then
    update prospects set followups_sent = 0, next_followup_at = null, followup_due = false
     where id = pr.id and (followups_sent > 0 or next_followup_at is not null or followup_due);
  elsif new.status in ('queued', 'sent')
        and coalesce(new.ai_meta->>'kind', '') <> 'followup'
        and pr.stage in ('interested', 'whatsapp', 'hot')
        and not pr.do_not_contact then
    update prospects set next_followup_at = new.sent_at + followup_delay(pr.organization_id, 0)
     where id = pr.id and followups_sent = 0;
  end if;
  return new;
end $$;

create trigger messages_schedule_followups
  after insert on messages
  for each row execute function schedule_followups();

-- ---------- Exécution des relances (n8n, toutes les heures, 8 h – 19 h) --

create or replace function run_followups()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  pr        prospects%rowtype;
  c         conversations%rowtype;
  a         channel_accounts%rowtype;
  t         whatsapp_templates%rowtype;
  v_n       int;
  v_first   text;
  v_product text;
  v_body    text;
  sent      int := 0;
  tasks     int := 0;
  abandoned int := 0;
begin
  -- 1. Abandon : deux relances sans réponse, délai final écoulé.
  with gone as (
    update prospects set stage = 'ghosted', archived_reason = 'ghosted', archived_at = now(),
      next_followup_at = null, followup_due = false
    where followups_sent >= 2 and next_followup_at <= now()
      and stage in ('interested', 'whatsapp', 'hot')
    returning id
  ) select count(*) into abandoned from gone;

  -- 2. Relances dues.
  for pr in
    select p.* from prospects p join organizations o on o.id = p.organization_id
     where p.next_followup_at <= now() and p.followups_sent < 2 and not p.do_not_contact
       and p.stage in ('interested', 'whatsapp', 'hot') and p.deleted_at is null
       and coalesce((o.automation->>'followups_enabled')::boolean, true)
     for update of p skip locked
  loop
    v_n := pr.followups_sent + 1;
    select * into c from conversations where prospect_id = pr.id
      order by last_message_at desc nulls last limit 1;
    select * into a from channel_accounts where id = c.channel_account_id;

    t := null;
    if a.channel = 'whatsapp' and not c.ai_paused then
      select * into t from whatsapp_templates
       where channel_account_id = a.id and purpose = 'followup_' || v_n and status = 'APPROVED'
       order by (language = coalesce(pr.language, 'fr')) desc, (language = 'fr') desc
       limit 1;
    end if;

    if t.id is not null then
      v_first   := coalesce(nullif(split_part(pr.full_name, ' ', 1), ''), case t.language when 'en' then 'there' else 'cher client' end);
      v_product := coalesce((select name from products where id = pr.product_id), 'notre offre');
      v_body    := replace(replace(t.body, '{{1}}', v_first), '{{2}}', v_product);
      insert into messages (organization_id, conversation_id, channel_account_id, direction, status, body,
                            ai_generated, ai_meta)
      values (pr.organization_id, c.id, a.id, 'outbound', 'queued', v_body, false,
              jsonb_build_object('kind', 'followup', 'n', v_n,
                'template', jsonb_build_object('name', t.name, 'language', t.language,
                                               'params', jsonb_build_array(v_first, v_product))));
      sent := sent + 1;
    else
      -- LinkedIn / X, Messenger / Instagram (relance automatique interdite hors 24 h),
      -- IA en pause ou modèle WhatsApp pas encore approuvé : c'est l'utilisateur qui relance.
      update prospects set followup_due = true where id = pr.id;
      tasks := tasks + 1;
    end if;

    update prospects set followups_sent = v_n, last_followup_at = now(),
      next_followup_at = now() + followup_delay(pr.organization_id, 1)
    where id = pr.id;
    insert into activity_log (organization_id, prospect_id, kind, data)
    values (pr.organization_id, pr.id, 'followup',
            jsonb_build_object('n', v_n, 'mode', case when t.id is not null then 'template' else 'task' end));
  end loop;

  return jsonb_build_object('sent', sent, 'tasks', tasks, 'abandoned', abandoned);
end $$;

revoke execute on function run_followups() from public, anon, authenticated;

-- ---------- Closing : étape suivante ------------------------------------
-- send_presentation : prospect prêt (intéressé sur WhatsApp, ou arrivé par le lien de bascule)
-- propose_call      : présentation envoyée ET le prospect a répondu depuis

create or replace function closing_next_action(p_prospect uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select case
    when pr.closing_step is null
         and pr.stage in ('interested', 'whatsapp', 'hot')
         and exists (select 1 from conversations c join channel_accounts a on a.id = c.channel_account_id
                     where c.prospect_id = pr.id and a.channel = 'whatsapp')
      then case when coalesce(p.closing->>'presentation_url', '') <> '' then 'send_presentation' else 'propose_call' end
    when pr.closing_step = 'presentation_sent'
         and exists (select 1 from messages m join conversations c on c.id = m.conversation_id
                     where c.prospect_id = pr.id and m.direction = 'inbound' and m.sent_at > pr.presentation_sent_at)
      then 'propose_call'
    else null
  end
  from prospects pr left join products p on p.id = pr.product_id
  where pr.id = p_prospect
$$;

create or replace function record_closing_step(p_prospect uuid, p_step text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_org uuid;
begin
  select organization_id into v_org from prospects where id = p_prospect;
  -- Serveur (service_role : auth.uid() nul) ou membre de l'organisation.
  if v_org is null or (auth.uid() is not null and not is_org_member(v_org)) then
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
    -- Appel planifié : plus de relance automatique.
    next_followup_at     = case when p_step = 'call_booked' then null else next_followup_at end,
    updated_at = now()
  where id = p_prospect;
  insert into activity_log (organization_id, prospect_id, kind, data)
  values (v_org, p_prospect, 'closing', jsonb_build_object('step', p_step));
end $$;

-- ---------- Contexte IA : ajoute l'état du closing -----------------------

create or replace function prospect_ai_context(p_prospect uuid, p_conversation uuid default null)
returns jsonb
language sql stable security invoker set search_path = public
as $$
  select jsonb_build_object(
    'organization_id', pr.organization_id,
    'brand_voice',     o.brand_voice,
    'product', jsonb_build_object(
      'name', p.name, 'description', p.description, 'target', p.target,
      'knowledge', p.knowledge,
      'tone', p.analysis->>'tone', 'hooks', p.analysis->'hooks', 'segments', p.analysis->'segments'),
    'prospect', jsonb_build_object(
      'full_name', pr.full_name, 'job_title', pr.job_title, 'company', pr.company,
      'country', pr.country, 'language', pr.language, 'segment', pr.segment_label,
      'fit_reasons', pr.fit_reasons, 'profile_text', left(pr.profile_text, 2000),
      'stage', pr.stage),
    'profile', to_jsonb(pp) - 'organization_id' - 'prospect_id',
    'closing', jsonb_build_object(
      'step', pr.closing_step,
      'next_action', closing_next_action(pr.id),
      'presentation_label', p.closing->>'presentation_label',
      'has_presentation', coalesce(p.closing->>'presentation_url', '') <> '',
      'has_booking', coalesce(p.closing->>'booking_url', '') <> '',
      'call_minutes', p.closing->'call_minutes',
      'presentation_url', p.closing->>'presentation_url',
      'booking_url', p.closing->>'booking_url'),
    'conversation', (
      select jsonb_build_object(
        'channel', a.channel,
        'messages', coalesce((
          select jsonb_agg(jsonb_build_object('from', case m.direction when 'inbound' then 'prospect' else 'nous' end,
                                              'text', m.body, 'at', m.sent_at) order by m.sent_at)
          from (select * from messages where conversation_id = c.id
                order by sent_at desc limit 20) m), '[]'::jsonb))
      from conversations c join channel_accounts a on a.id = c.channel_account_id
      where c.id = p_conversation)
  )
  from prospects pr
  join organizations o on o.id = pr.organization_id
  left join products p on p.id = pr.product_id
  left join prospect_profiles pp on pp.prospect_id = pr.id
  where pr.id = p_prospect
$$;

-- ---------- Envoi : ajoute les modèles WhatsApp au workflow 02 ----------

create or replace function outbound_payload(p_message uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'message_id',   m.id,
    'status',       m.status,
    'body',         m.body,
    'channel',      a.channel,
    'account_external_id', a.external_id,
    'recipient',    i.external_user_id,
    'window_open',  conversation_window_open(c),
    'template',     m.ai_meta->'template',
    'access_token', cr.access_token
  )
  from messages m
  join conversations c        on c.id = m.conversation_id
  join channel_accounts a     on a.id = m.channel_account_id
  join prospect_identities i  on i.prospect_id = c.prospect_id and i.channel_account_id = a.id
  left join channel_credentials cr on cr.channel_account_id = a.id
  where m.id = p_message
$$;

revoke execute on function outbound_payload(uuid) from public, anon, authenticated;
