-- =====================================================================
-- Le Closer — 0004 : cerveau IA (Partie 3)
--   * voix de marque de l'utilisateur + connaissances produit (source de vérité de l'IA)
--   * profil relationnel enrichi (langue, tu/vous, style, signaux d'achat)
--   * brouillons IA (variantes proposées, variante choisie)
--   * consommation IA par organisation (facturation SaaS)
-- =====================================================================

-- ---------- Voix de marque & connaissances produit --------------------

-- Ex. {"sender_name": "Awa", "signature": "Awa – Wax & Co", "formality": "vous",
--      "emojis": true, "banned_phrases": ["J'espère que vous allez bien"]}
alter table organizations add column brand_voice jsonb not null default '{}'::jsonb;

-- Ce que l'IA a le droit d'affirmer : arguments, FAQ, délais, conditions, liens.
-- Les prix peuvent y figurer : l'IA les signalera comme sujet sensible (validation, Partie 5).
alter table products add column knowledge text;

-- ---------- Profil relationnel enrichi ---------------------------------

alter table prospect_profiles
  add column language        text,            -- langue de conversation constatée
  add column formality       text check (formality in ('tu', 'vous')),
  add column style           jsonb not null default '{}'::jsonb, -- {"length":"court","emojis":true,"register":"cordial"}
  add column preferences     text[] not null default '{}',
  add column buying_signals  text[] not null default '{}',
  add column messages_seen   int not null default 0,  -- nb de messages entrants pris en compte
  add column version         int not null default 0;

-- ---------- Brouillons IA ----------------------------------------------

create table ai_drafts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  prospect_id      uuid not null references prospects(id) on delete cascade,
  conversation_id  uuid references conversations(id) on delete cascade,
  kind             text not null check (kind in ('invitation', 'opening', 'reply')),
  channel          channel_type not null,
  language         text,
  formality        text,
  variants         jsonb not null,   -- [{"text": "...", "angle": "..."}]
  sensitive        jsonb not null default '{"is": false, "topics": []}'::jsonb,
  rationale        text,
  chosen_index     int,              -- variante utilisée (apprentissage, Partie 7)
  used_at          timestamptz,
  model            text,
  created_at       timestamptz not null default now()
);
create index on ai_drafts (prospect_id, created_at desc);

-- ---------- Consommation IA ------------------------------------------

create table ai_usage (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null references organizations(id) on delete cascade,
  feature          text not null,    -- analyze_product | qualify | draft | profile
  model            text not null,
  input_tokens     int not null default 0,
  output_tokens    int not null default 0,
  cost_usd         numeric(10, 6) not null default 0,
  created_at       timestamptz not null default now()
);
create index on ai_usage (organization_id, created_at);

alter table ai_drafts enable row level security;
alter table ai_usage  enable row level security;

create policy tenant_all on ai_drafts for all
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));
-- ai_usage : lecture seule pour l'utilisateur ; écriture par le serveur uniquement.
create policy tenant_read on ai_usage for select using (is_org_member(organization_id));

-- ---------- Contexte complet d'un prospect pour l'IA -------------------
-- security invoker : appelée avec le jeton de l'utilisateur, RLS s'applique ;
-- appelée avec service_role (n8n), tout est visible.

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

-- Enregistre un profil relationnel mis à jour par l'IA (appelée côté serveur).
create or replace function save_prospect_profile(p_prospect uuid, p_profile jsonb, p_messages_seen int)
returns void
language plpgsql security definer set search_path = public
as $$
declare arr text[];
begin
  insert into prospect_profiles as pp (
    prospect_id, organization_id, tone, language, formality, style, interests, pain_points,
    objections, preferences, buying_signals, summary, messages_seen, version, updated_at)
  select pr.id, pr.organization_id,
         p_profile->>'tone', p_profile->>'language',
         nullif(p_profile->>'formality', ''),
         coalesce(p_profile->'style', '{}'::jsonb),
         coalesce(array(select jsonb_array_elements_text(p_profile->'interests')), '{}'),
         coalesce(array(select jsonb_array_elements_text(p_profile->'pain_points')), '{}'),
         coalesce(array(select jsonb_array_elements_text(p_profile->'objections')), '{}'),
         coalesce(array(select jsonb_array_elements_text(p_profile->'preferences')), '{}'),
         coalesce(array(select jsonb_array_elements_text(p_profile->'buying_signals')), '{}'),
         left(p_profile->>'summary', 600),
         p_messages_seen, 1, now()
  from prospects pr where pr.id = p_prospect
  on conflict (prospect_id) do update set
    tone = excluded.tone, language = excluded.language, formality = excluded.formality,
    style = excluded.style, interests = excluded.interests, pain_points = excluded.pain_points,
    objections = excluded.objections, preferences = excluded.preferences,
    buying_signals = excluded.buying_signals, summary = excluded.summary,
    messages_seen = excluded.messages_seen, version = pp.version + 1, updated_at = now();

  -- La langue constatée en conversation devient la langue du prospect.
  update prospects set language = coalesce(p_profile->>'language', language), updated_at = now()
   where id = p_prospect;
end $$;

revoke execute on function save_prospect_profile(uuid, jsonb, int) from public, anon, authenticated;

-- Trace la consommation IA (appelée côté serveur).
create or replace function record_ai_usage(
  p_org uuid, p_feature text, p_model text, p_in int, p_out int, p_cost numeric
) returns void
language sql security definer set search_path = public
as $$
  insert into ai_usage (organization_id, feature, model, input_tokens, output_tokens, cost_usd)
  values (p_org, p_feature, p_model, coalesce(p_in, 0), coalesce(p_out, 0), coalesce(p_cost, 0))
$$;

revoke execute on function record_ai_usage(uuid, text, text, int, int, numeric) from public, anon, authenticated;
