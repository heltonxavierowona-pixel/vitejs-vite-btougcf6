-- =====================================================================
-- Numera Agentic — schéma initial multi-tenant (Partie 1)
-- À exécuter dans l'éditeur SQL Supabase.
-- Règle : toute table métier porte organization_id + RLS.
-- n8n utilise la clé service_role (contourne RLS) ; le front utilise
-- la clé anon + session utilisateur (soumis à RLS).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Types ----------------------------------------------------

create type channel_type as enum ('linkedin', 'x', 'facebook', 'instagram', 'whatsapp');

-- auto    : API officielle, l'IA envoie elle-même (FB, IG, WhatsApp)
-- assisted: l'IA rédige, l'humain envoie (LinkedIn, X)
create type channel_mode as enum ('auto', 'assisted');

create type target_segment as enum ('core_hr', 'social_seller', 'other');

create type prospect_stage as enum (
  'new',          -- sourcé, pas encore contacté
  'contacted',    -- premier message envoyé
  'replied',      -- a répondu
  'interested',   -- intérêt clair et explicite
  'whatsapp',     -- conversation basculée sur WhatsApp
  'hot',          -- prêt à acheter / appel demandé
  'won',
  'lost',         -- réponse négative / neutre → archivé, pas de relance
  'ghosted'       -- intéressé puis silencieux après 2 relances
);

create type message_direction as enum ('inbound', 'outbound');

create type message_status as enum (
  'draft',              -- rédigé par l'IA, pas envoyé
  'pending_approval',   -- sujet sensible, attend validation humaine
  'queued',             -- validé, en attente d'envoi par n8n
  'sent',
  'delivered',
  'read',
  'failed',
  'received'            -- message entrant
);

create type member_role as enum ('owner', 'admin', 'member');

-- ---------- Organisations (tenants) ----------------------------------

create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  plan        text not null default 'internal',
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create table organization_members (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            member_role not null default 'member',
  created_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);

-- Fonction utilisée par toutes les policies RLS.
create or replace function is_org_member(org uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from organization_members
    where organization_id = org and user_id = auth.uid()
  );
$$;

-- ---------- Comptes de canaux ----------------------------------------
-- Un par Page FB / compte IG / numéro WhatsApp / compte LinkedIn / X.
-- Aucun token ici : les secrets restent dans n8n.

create table channel_accounts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  channel          channel_type not null,
  mode             channel_mode not null,
  label            text not null,
  external_id      text,          -- page_id, ig_user_id, phone_number_id…
  status           text not null default 'setup', -- setup | active | paused | error
  setup_checklist  jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  unique (channel, external_id)
);

-- ---------- Prospects -------------------------------------------------

create table prospects (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  full_name        text,
  company          text,
  job_title        text,
  country          text,
  language         text,           -- code ISO détecté (fr, en, …)
  segment          target_segment not null default 'other',
  stage            prospect_stage not null default 'new',
  score            smallint not null default 0 check (score between 0 and 100),
  source           text,           -- manual_import | fb_comment | ig_dm | ad | …
  whatsapp_phone   text,           -- rempli uniquement quand le prospect le donne (opt-in)
  whatsapp_opt_in_at timestamptz,
  followups_sent   smallint not null default 0,
  next_followup_at timestamptz,
  deleted_at       timestamptz,    -- droit à l'effacement
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on prospects (organization_id, stage);

-- Identité d'un prospect sur un canal (un prospect peut en avoir plusieurs).
create table prospect_identities (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations(id) on delete cascade,
  prospect_id        uuid not null references prospects(id) on delete cascade,
  channel_account_id uuid not null references channel_accounts(id) on delete cascade,
  external_user_id   text not null, -- PSID Messenger, IGSID, wa_id, URL profil LinkedIn…
  display_name       text,
  unique (channel_account_id, external_user_id)
);

-- ---------- Profil relationnel (« mémoire ») --------------------------
-- Uniquement des informations professionnelles utiles à la vente.
-- Pas de santé, religion, opinions politiques, etc.

create table prospect_profiles (
  prospect_id      uuid primary key references prospects(id) on delete cascade,
  organization_id  uuid not null references organizations(id) on delete cascade,
  tone             text,            -- formel | cordial | direct | …
  interests        text[] not null default '{}',
  pain_points      text[] not null default '{}',
  objections       text[] not null default '{}',
  summary          text,            -- résumé glissant de la relation, maintenu par l'IA
  updated_at       timestamptz not null default now()
);

-- ---------- Conversations & messages ----------------------------------

create table conversations (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations(id) on delete cascade,
  prospect_id        uuid not null references prospects(id) on delete cascade,
  channel_account_id uuid not null references channel_accounts(id) on delete cascade,
  last_inbound_at    timestamptz,   -- pour calculer la fenêtre de 24 h Meta
  last_outbound_at   timestamptz,
  ai_paused          boolean not null default false, -- reprise en main manuelle
  created_at         timestamptz not null default now(),
  unique (prospect_id, channel_account_id)
);

create table messages (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  conversation_id     uuid not null references conversations(id) on delete cascade,
  channel_account_id  uuid not null references channel_accounts(id) on delete cascade,
  direction           message_direction not null,
  status              message_status not null,
  body                text not null,
  external_message_id text,
  ai_generated        boolean not null default false,
  ai_meta             jsonb not null default '{}'::jsonb, -- modèle, coût, classification…
  sent_at             timestamptz not null default now(),
  unique (channel_account_id, external_message_id)  -- idempotence des webhooks
);
create index on messages (conversation_id, sent_at);

-- ---------- Validations humaines (prix, contrat…) --------------------

create table approvals (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  message_id       uuid not null references messages(id) on delete cascade,
  reason           text not null,   -- price | contract | other
  decision         text,            -- approved | edited | rejected
  decided_by       uuid references auth.users(id),
  decided_at       timestamptz,
  created_at       timestamptz not null default now()
);

-- ---------- Journal & événements bruts --------------------------------

create table raw_events (
  id               bigint generated always as identity primary key,
  organization_id  uuid references organizations(id) on delete cascade,
  source           text not null,   -- meta | manual | system
  payload          jsonb not null,
  received_at      timestamptz not null default now()
);

create table activity_log (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null references organizations(id) on delete cascade,
  prospect_id      uuid references prospects(id) on delete cascade,
  kind             text not null,   -- stage_changed | alert_sent | followup_sent | …
  data             jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

-- ---------- RLS --------------------------------------------------------

alter table organizations        enable row level security;
alter table organization_members enable row level security;
alter table channel_accounts     enable row level security;
alter table prospects            enable row level security;
alter table prospect_identities  enable row level security;
alter table prospect_profiles    enable row level security;
alter table conversations        enable row level security;
alter table messages             enable row level security;
alter table approvals            enable row level security;
alter table raw_events           enable row level security;
alter table activity_log         enable row level security;

create policy org_read on organizations
  for select using (is_org_member(id));

create policy members_read on organization_members
  for select using (is_org_member(organization_id));

do $$
declare t text;
begin
  foreach t in array array[
    'channel_accounts', 'prospects', 'prospect_identities', 'prospect_profiles',
    'conversations', 'messages', 'approvals', 'activity_log'
  ] loop
    execute format(
      'create policy tenant_all on %I for all
         using (is_org_member(organization_id))
         with check (is_org_member(organization_id))', t);
  end loop;
end $$;
-- raw_events : aucune policy → lisible uniquement par service_role (n8n).

-- ---------- Ingestion d'un message entrant (appelée par n8n) ----------
-- Idempotente : un même external_message_id n'est inséré qu'une fois.

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
begin
  select * into v_account from channel_accounts
   where channel = p_channel and external_id = p_account_external_id;
  if not found then
    raise exception 'Compte de canal inconnu: % / %', p_channel, p_account_external_id;
  end if;

  select prospect_id into v_prospect from prospect_identities
   where channel_account_id = v_account.id and external_user_id = p_external_user_id;

  if v_prospect is null then
    insert into prospects (organization_id, full_name, source, stage,
                           whatsapp_phone, whatsapp_opt_in_at)
    values (v_account.organization_id, p_display_name,
            p_channel::text || '_inbound', 'replied',
            case when p_channel = 'whatsapp' then p_external_user_id end,
            case when p_channel = 'whatsapp' then now() end)
    returning id into v_prospect;

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

  return v_msg; -- null si doublon
end $$;

revoke execute on function ingest_inbound_message from public, anon, authenticated;

-- ---------- Amorçage : votre organisation (tenant n°1) ----------------
-- Après avoir créé votre compte dans la plateforme (Supabase Auth),
-- remplacez l'e-mail puis exécutez ce bloc une fois :
--
-- with org as (
--   insert into organizations (name) values ('Numera Agentic — interne') returning id
-- )
-- insert into organization_members (organization_id, user_id, role)
-- select org.id, u.id, 'owner' from org, auth.users u
-- where u.email = 'votre@email.com';
