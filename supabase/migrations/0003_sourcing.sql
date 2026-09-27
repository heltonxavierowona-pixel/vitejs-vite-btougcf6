-- =====================================================================
-- Numera Agentic — 0003 : ciblage & sourcing par produit (Partie 2)
--   Sortant (LinkedIn, X)  : import semi-manuel + qualification IA + file du jour
--   Entrant (FB, IG)       : mots-clés en commentaire → réponse privée automatique
--   Entrant (WhatsApp)     : liens wa.me par produit avec code de référence
-- =====================================================================

-- ---------- Prospects : profil et qualification ------------------------

alter table prospects
  add column profile_url    text,          -- URL LinkedIn / X (sourcing sortant)
  add column profile_text   text,          -- texte collé par l'utilisateur (source de l'analyse)
  add column fit_score      smallint check (fit_score between 0 and 100),
  add column fit_reasons    text[] not null default '{}',
  add column best_channel   channel_type,  -- canal conseillé pour ce prospect
  add column qualified_at   timestamptz,
  add column contacted_at   timestamptz;

create unique index prospects_profile_url_uniq
  on prospects (organization_id, profile_url) where profile_url is not null and deleted_at is null;
create index on prospects (organization_id, product_id, stage, fit_score desc);

-- Produit vendu par défaut sur un compte (ex. la Page Facebook de la boutique).
alter table channel_accounts add column default_product_id uuid references products(id) on delete set null;

-- Rythme de prospection sortante (protection des comptes LinkedIn/X).
-- new = compte neuf, warming = en chauffe, established = compte établi
alter table organizations add column outreach_profile text not null default 'new'
  check (outreach_profile in ('new', 'warming', 'established'));

create or replace function daily_outreach_limit(p_channel channel_type, p_profile text)
returns int language sql immutable
as $$
  select case p_channel
    when 'linkedin' then case p_profile when 'new' then 10 when 'warming' then 15 else 20 end
    when 'x'        then case p_profile when 'new' then 10 when 'warming' then 20 else 30 end
    else 0
  end
$$;

-- ---------- Liens d'entrée WhatsApp par produit -------------------------
-- wa.me/<numéro>?text=Bonjour… (réf. AB12C) : le code identifie le produit
-- et la source (bio Instagram, affiche, statut WhatsApp, e-mail…).

create table entry_links (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  product_id       uuid not null references products(id) on delete cascade,
  channel_account_id uuid references channel_accounts(id) on delete cascade,
  label            text not null,   -- où le lien est diffusé : « Bio Instagram », « Flyer salon »…
  code             text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 5)),
  prefilled_text   text not null,
  conversations    int not null default 0,
  created_at       timestamptz not null default now()
);

-- ---------- Déclencheurs par mot-clé (commentaires FB / IG) -------------

create table keyword_triggers (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations(id) on delete cascade,
  product_id         uuid not null references products(id) on delete cascade,
  channel_account_id uuid not null references channel_accounts(id) on delete cascade,
  post_id            text,          -- null = toutes les publications
  keywords           text[] not null check (cardinality(keywords) > 0),
  reply_text         text not null, -- réponse privée envoyée au commentateur
  active             boolean not null default true,
  matches            int not null default 0,
  created_at         timestamptz not null default now()
);

create table comment_events (
  id                 bigint generated always as identity primary key,
  organization_id    uuid not null references organizations(id) on delete cascade,
  channel_account_id uuid not null references channel_accounts(id) on delete cascade,
  comment_id         text not null unique,   -- idempotence des webhooks
  post_id            text,
  from_id            text,
  from_name          text,
  body               text,
  trigger_id         uuid references keyword_triggers(id) on delete set null,
  created_at         timestamptz not null default now()
);

alter table entry_links      enable row level security;
alter table keyword_triggers enable row level security;
alter table comment_events   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['entry_links', 'keyword_triggers', 'comment_events'] loop
    execute format(
      'create policy tenant_all on %I for all
         using (is_org_member(organization_id))
         with check (is_org_member(organization_id))', t);
  end loop;
end $$;

-- ---------- Ingestion : attribution du produit -------------------------
-- Même fonction qu'en 0001, plus : un nouveau prospect est rattaché au produit
-- du code de référence trouvé dans son message, sinon au produit par défaut du compte.

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

-- ---------- Commentaire reçu (appelée par n8n) --------------------------
-- Enregistre le commentaire (une seule fois), cherche un mot-clé actif et,
-- si trouvé, prépare la réponse privée. Renvoie null s'il n'y a rien à envoyer.

create or replace function handle_comment(
  p_channel             channel_type,
  p_account_external_id text,
  p_comment_id          text,
  p_post_id             text,
  p_from_id             text,
  p_from_name           text,
  p_body                text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_account  channel_accounts%rowtype;
  v_trigger  keyword_triggers%rowtype;
  v_event    bigint;
  v_prospect uuid;
  v_conv     uuid;
  v_msg      uuid;
begin
  select * into v_account from channel_accounts
   where channel = p_channel and external_id = p_account_external_id;
  if not found or p_from_id = p_account_external_id then
    return null; -- compte inconnu, ou commentaire de la Page elle-même
  end if;

  select * into v_trigger from keyword_triggers t
   where t.channel_account_id = v_account.id
     and t.active
     and (t.post_id is null or t.post_id = p_post_id)
     and exists (select 1 from unnest(t.keywords) k where p_body ilike '%' || k || '%')
   order by (t.post_id is not null) desc, t.created_at
   limit 1;

  insert into comment_events (organization_id, channel_account_id, comment_id, post_id,
                              from_id, from_name, body, trigger_id)
  values (v_account.organization_id, v_account.id, p_comment_id, p_post_id,
          p_from_id, p_from_name, p_body, v_trigger.id)
  on conflict (comment_id) do nothing
  returning id into v_event;

  if v_event is null or v_trigger.id is null then
    return null; -- doublon de webhook, ou aucun mot-clé
  end if;

  update keyword_triggers set matches = matches + 1 where id = v_trigger.id;

  select prospect_id into v_prospect from prospect_identities
   where channel_account_id = v_account.id and external_user_id = p_from_id;

  if v_prospect is null then
    insert into prospects (organization_id, full_name, source, stage, product_id)
    values (v_account.organization_id, p_from_name, p_channel::text || '_comment', 'contacted',
            v_trigger.product_id)
    returning id into v_prospect;

    insert into prospect_identities (organization_id, prospect_id, channel_account_id,
                                     external_user_id, display_name)
    values (v_account.organization_id, v_prospect, v_account.id, p_from_id, p_from_name);
  end if;

  insert into conversations (organization_id, prospect_id, channel_account_id)
  values (v_account.organization_id, v_prospect, v_account.id)
  on conflict (prospect_id, channel_account_id) do update set prospect_id = excluded.prospect_id
  returning id into v_conv;

  -- Statut « draft » : n8n le passe à sent/failed après l'appel Meta.
  -- (Le workflow 02 ne traite que les messages « queued ».)
  insert into messages (organization_id, conversation_id, channel_account_id, direction,
                        status, body, ai_generated)
  values (v_account.organization_id, v_conv, v_account.id, 'outbound', 'draft',
          v_trigger.reply_text, false)
  returning id into v_msg;

  return jsonb_build_object(
    'message_id',          v_msg,
    'channel',             p_channel,
    'account_external_id', p_account_external_id,
    'comment_id',          p_comment_id,
    'reply',               v_trigger.reply_text,
    'access_token',        (select access_token from channel_credentials
                             where channel_account_id = v_account.id)
  );
end $$;

revoke execute on function handle_comment from public, anon, authenticated;

-- ---------- File du jour (prospection sortante assistée) ----------------
-- Prospects à contacter aujourd'hui pour un produit et un canal, les mieux
-- qualifiés d'abord, dans la limite du rythme autorisé.

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
    select greatest(0,
      daily_outreach_limit(p_channel, o.outreach_profile)
      - (select count(*) from prospects d
          where d.organization_id = o.id
            and d.best_channel = p_channel
            and d.contacted_at >= date_trunc('day', now())))
    from organizations o
    join products p on p.organization_id = o.id
    where p.id = p_product
  )
$$;
