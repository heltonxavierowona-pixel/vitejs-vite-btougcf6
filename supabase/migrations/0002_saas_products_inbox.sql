-- =====================================================================
-- Le Closer — 0002 : SaaS ouvert à tous
--   * chaque inscription crée automatiquement son organisation
--   * produits : l'agent s'adapte au produit et en déduit les canaux
--   * connexions : chaque utilisateur branche SES comptes Meta
--   * boîte de réception : l'utilisateur répond depuis la plateforme,
--     le client reste sur WhatsApp / Messenger / Instagram
-- =====================================================================

-- ---------- Organisation créée à l'inscription ------------------------

create or replace function handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_org uuid;
begin
  insert into organizations (name, plan)
  values (coalesce(new.raw_user_meta_data->>'company', split_part(new.email, '@', 1)), 'trial')
  returning id into v_org;

  insert into organization_members (organization_id, user_id, role)
  values (v_org, new.id, 'owner');
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- Produits ---------------------------------------------------
-- L'utilisateur décrit ce qu'il vend ; l'IA produit une analyse :
-- cibles, canaux recommandés (score + raison), ton, langues, angle.

create table products (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  name             text not null,
  description      text not null,
  offer_type       text,            -- saas | service | physique | formation | autre
  audience         text,            -- b2b | b2c | mixte
  target           text,            -- qui achète, en texte libre
  countries        text[] not null default '{}',
  price_level      text,            -- bas | moyen | eleve
  links            text[] not null default '{}',
  analysis         jsonb,           -- sortie validée du prompt « Analyse produit »
  analyzed_at      timestamptz,
  created_at       timestamptz not null default now()
);

alter table products enable row level security;
create policy tenant_all on products for all
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

alter table prospects add column product_id uuid references products(id) on delete set null;
-- Les segments deviennent propres à chaque produit (définis par l'analyse IA).
alter table prospects add column segment_label text;

-- ---------- Connexions de canaux (par utilisateur) ---------------------

alter table channel_accounts
  add column connected_by uuid references auth.users(id),
  add column connected_at timestamptz,
  add column meta_business_id text,  -- portefeuille Meta du client
  add column waba_id text,           -- WhatsApp Business Account du client
  add column display_phone text,     -- ex. +237 6 xx xx xx xx
  add column coexistence boolean not null default false;

-- Tokens d'accès : table séparée SANS policy → invisible pour le front,
-- lisible uniquement avec la clé service_role (n8n, Edge Functions).
-- En production, chiffrer la colonne avec Supabase Vault.
create table channel_credentials (
  channel_account_id uuid primary key references channel_accounts(id) on delete cascade,
  access_token       text not null,
  token_expires_at   timestamptz,   -- null = token système / longue durée
  scopes             text[] not null default '{}',
  extra              jsonb not null default '{}'::jsonb, -- ex. PIN d'enregistrement WhatsApp
  updated_at         timestamptz not null default now()
);
alter table channel_credentials enable row level security;

-- ---------- Boîte de réception ----------------------------------------

alter table conversations
  add column unread_count integer not null default 0,
  add column last_message_preview text,
  add column last_message_at timestamptz;

create index on conversations (organization_id, last_message_at desc);

-- Fenêtre de service Meta : réponse libre 24 h après le dernier message du client.
create or replace function conversation_window_open(c conversations)
returns boolean language sql stable
as $$ select c.last_inbound_at is not null and c.last_inbound_at > now() - interval '24 hours' $$;

-- Met à jour l'aperçu de la conversation à chaque message.
create or replace function touch_conversation()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update conversations set
    last_message_preview = left(new.body, 140),
    last_message_at      = new.sent_at,
    unread_count         = case when new.direction = 'inbound' then unread_count + 1 else unread_count end,
    last_outbound_at     = case when new.direction = 'outbound' then new.sent_at else last_outbound_at end
  where id = new.conversation_id;
  return new;
end $$;

create trigger messages_touch_conversation
  after insert on messages
  for each row execute function touch_conversation();

-- L'utilisateur envoie depuis la plateforme : le message est mis en file
-- (status = queued) ; n8n l'envoie via l'API du canal et met à jour le statut.
-- Refuse l'envoi libre hors fenêtre 24 h (il faudra un modèle WhatsApp approuvé).
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

  update conversations set unread_count = 0 where id = v_conv.id;
  return v_msg;
end $$;

create or replace function mark_conversation_read(p_conversation uuid)
returns void language sql security invoker
as $$ update conversations set unread_count = 0 where id = p_conversation $$;

-- Temps réel : la boîte de réception se met à jour sans recharger.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table messages, conversations;
  end if;
end $$;

-- ---------- Envoi sortant (utilisé par n8n, clé service_role) ---------

-- Tout ce qu'il faut pour envoyer un message : canal, destinataire, token.
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
    'access_token', cr.access_token
  )
  from messages m
  join conversations c        on c.id = m.conversation_id
  join channel_accounts a     on a.id = m.channel_account_id
  join prospect_identities i  on i.prospect_id = c.prospect_id and i.channel_account_id = a.id
  left join channel_credentials cr on cr.channel_account_id = a.id
  where m.id = p_message
$$;

create or replace function mark_message_result(
  p_message uuid, p_status message_status, p_external_id text default null, p_error text default null
) returns void
language sql security definer set search_path = public
as $$
  update messages set
    status = p_status,
    external_message_id = coalesce(p_external_id, external_message_id),
    ai_meta = case when p_error is null then ai_meta else ai_meta || jsonb_build_object('error', p_error) end
  where id = p_message
$$;

revoke execute on function outbound_payload(uuid) from public, anon, authenticated;
revoke execute on function mark_message_result(uuid, message_status, text, text) from public, anon, authenticated;
