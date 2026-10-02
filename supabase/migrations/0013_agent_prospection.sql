-- =====================================================================
-- Numera Agentic — du chatbot à l'agent de prospection
--  1. Chaque prospect est relié à un produit (celui de la publication, du lien
--     d'entrée, du canal, sinon le produit le plus récent de l'organisation) :
--     l'IA sait toujours de quoi elle parle.
--  2. Informations de vente par produit : produit digital → lien d'achat ;
--     produit physique → mise en contact avec le propriétaire (WhatsApp).
--  3. Publications Facebook / Instagram : brouillons générés par l'IA ou écrits
--     par l'utilisateur, image, planification, publication automatique.
--  4. Commentaires : sans mot-clé, l'IA répond en privé au commentateur
--     (organisations.automation.ai_comments, activé par défaut).
-- =====================================================================

-- ---------- 1. Informations de vente ----------------------------------------

alter table products
  add column if not exists sale_mode      text check (sale_mode in ('digital', 'physique')),
  add column if not exists purchase_url   text check (purchase_url is null or purchase_url ~ '^https?://\S+$'),
  add column if not exists owner_name     text,
  add column if not exists owner_whatsapp text,
  add column if not exists image_url      text;

-- ---------- 2. Produit par défaut des prospects -----------------------------

create or replace function org_default_product(p_org uuid) returns uuid
language sql stable security definer set search_path = public
as $$
  select id from products where organization_id = p_org
  order by (analysis is not null) desc, created_at desc limit 1
$$;

create or replace function prospects_default_product() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.product_id is null then
    new.product_id := org_default_product(new.organization_id);
  end if;
  return new;
end $$;

drop trigger if exists prospects_default_product on prospects;
create trigger prospects_default_product before insert on prospects
  for each row execute function prospects_default_product();

update prospects p set product_id = org_default_product(p.organization_id)
 where p.product_id is null;

-- Contexte IA : produit garanti, connaissances = fiche produit si vide, infos de vente.
create or replace function prospect_ai_context(p_prospect uuid, p_conversation uuid default null)
returns jsonb
language sql stable security invoker set search_path = public
as $$
  select jsonb_build_object(
    'organization_id', pr.organization_id,
    'brand_voice',     o.brand_voice,
    'product', case when p.id is null then null else jsonb_build_object(
      'name', p.name, 'description', p.description, 'target', p.target,
      'knowledge', coalesce(nullif(trim(p.knowledge), ''), p.description),
      'tone', p.analysis->>'tone', 'hooks', p.analysis->'hooks', 'segments', p.analysis->'segments') end,
    'sale', case when p.id is null then null else jsonb_build_object(
      'mode', p.sale_mode, 'purchase_url', p.purchase_url,
      'owner_name', p.owner_name, 'owner_whatsapp', p.owner_whatsapp) end,
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
  left join products p on p.id = coalesce(pr.product_id, org_default_product(pr.organization_id))
  left join prospect_profiles pp on pp.prospect_id = pr.id
  where pr.id = p_prospect
$$;

-- ---------- 3. Publications -------------------------------------------------

create table if not exists posts (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations(id) on delete cascade,
  product_id         uuid references products(id) on delete set null,
  channel            channel_type not null check (channel in ('facebook', 'instagram')),
  channel_account_id uuid references channel_accounts(id) on delete set null,
  body               text not null,
  image_url          text,
  image_idea         text,              -- visuel suggéré par l'IA
  status             text not null default 'draft'
                     check (status in ('draft', 'scheduled', 'publishing', 'published', 'failed')),
  scheduled_at       timestamptz,
  published_at       timestamptz,
  external_id        text,
  permalink          text,
  error              text,
  source             text not null default 'ai' check (source in ('ai', 'user')),
  comments           int not null default 0,
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists posts_org on posts (organization_id, created_at desc);
create index if not exists posts_due on posts (scheduled_at) where status = 'scheduled';
create index if not exists posts_external on posts (external_id);

alter table posts enable row level security;
drop policy if exists tenant_all on posts;
create policy tenant_all on posts for all
  using (is_org_member(organization_id)) with check (is_org_member(organization_id));

-- Images des publications (public : Meta doit pouvoir les télécharger).
insert into storage.buckets (id, name, public) values ('post-media', 'post-media', true)
on conflict (id) do update set public = true;
drop policy if exists post_media_insert on storage.objects;
create policy post_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'post-media'
              and is_org_member(((storage.foldername(name))[1])::uuid));
drop policy if exists post_media_delete on storage.objects;
create policy post_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'post-media'
         and is_org_member(((storage.foldername(name))[1])::uuid));

-- « Publier maintenant » depuis la plateforme.
create or replace function request_publish(p_post uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare r posts%rowtype;
begin
  select * into r from posts where id = p_post for update;
  if not found or not is_org_member(r.organization_id) then raise exception 'Publication introuvable'; end if;
  if r.status in ('publishing', 'published') then raise exception 'Publication déjà en cours ou publiée'; end if;
  if r.channel = 'instagram' and coalesce(r.image_url, '') = '' then
    raise exception 'Instagram exige une image : ajoutez-en une avant de publier';
  end if;
  update posts set status = 'publishing', error = null, updated_at = now() where id = p_post;
  perform hook_post(jsonb_build_object('kind', 'publish', 'post_id', p_post));
end $$;

-- Publications planifiées arrivées à échéance (pg_cron, toutes les 5 minutes).
create or replace function publish_due_posts() returns int
language plpgsql security definer set search_path = public
as $$
declare r record; n int := 0;
begin
  for r in
    update posts set status = 'publishing', updated_at = now()
     where status = 'scheduled' and scheduled_at <= now()
    returning id
  loop
    perform hook_post(jsonb_build_object('kind', 'publish', 'post_id', r.id));
    n := n + 1;
  end loop;
  return n;
end $$;

select cron.schedule('numera-publish-posts', '*/5 * * * *', 'select public.publish_due_posts()');

-- ---------- 4. Commentaires : réponse privée par l'IA ------------------------

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
  v_post     posts%rowtype;
  v_event    bigint;
  v_prospect uuid;
  v_conv     uuid;
  v_msg      uuid;
  v_ai       boolean;
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

  -- Publication d'origine (publiée par Numera Agentic) : son produit.
  select * into v_post from posts
   where organization_id = v_account.organization_id and external_id is not null
     and (external_id = p_post_id or p_post_id like '%_' || external_id or external_id like '%_' || p_post_id)
   limit 1;
  if v_post.id is not null then
    update posts set comments = comments + 1 where id = v_post.id;
  end if;

  select coalesce((automation->>'ai_comments')::boolean, true) into v_ai
    from organizations where id = v_account.organization_id;

  insert into comment_events (organization_id, channel_account_id, comment_id, post_id,
                              from_id, from_name, body, trigger_id)
  values (v_account.organization_id, v_account.id, p_comment_id, p_post_id,
          p_from_id, p_from_name, p_body, v_trigger.id)
  on conflict (comment_id) do nothing
  returning id into v_event;

  if v_event is null then return null; end if;            -- doublon de webhook
  if v_trigger.id is null and not v_ai then return null; end if;
  if v_trigger.id is not null then
    update keyword_triggers set matches = matches + 1 where id = v_trigger.id;
  end if;

  select prospect_id into v_prospect from prospect_identities
   where channel_account_id = v_account.id and external_user_id = p_from_id;

  if v_prospect is null then
    insert into prospects (organization_id, full_name, source, stage, product_id)
    values (v_account.organization_id, p_from_name, p_channel::text || '_comment', 'contacted',
            coalesce(v_trigger.product_id, v_post.product_id, v_account.default_product_id))
    returning id into v_prospect;

    insert into prospect_identities (organization_id, prospect_id, channel_account_id,
                                     external_user_id, display_name)
    values (v_account.organization_id, v_prospect, v_account.id, p_from_id, p_from_name);
  end if;

  insert into conversations (organization_id, prospect_id, channel_account_id)
  values (v_account.organization_id, v_prospect, v_account.id)
  on conflict (prospect_id, channel_account_id) do update set prospect_id = excluded.prospect_id
  returning id into v_conv;

  -- Sans mot-clé : l'IA rédige la réponse privée (numera-hooks, kind « comment »).
  if v_trigger.id is null then
    perform hook_post(jsonb_build_object(
      'kind', 'comment', 'comment_id', p_comment_id, 'prospect_id', v_prospect,
      'conversation_id', v_conv, 'channel_account_id', v_account.id,
      'comment', left(p_body, 1000), 'from_name', p_from_name));
    return null;
  end if;

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

-- ---------- Droits ----------------------------------------------------------

revoke execute on function org_default_product(uuid)       from public, anon;
grant  execute on function org_default_product(uuid)       to authenticated;
revoke execute on function prospects_default_product()     from public, anon, authenticated;
revoke execute on function publish_due_posts()             from public, anon, authenticated;
revoke execute on function handle_comment(channel_type, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function request_publish(uuid)           from public, anon;
grant  execute on function request_publish(uuid)           to authenticated;
