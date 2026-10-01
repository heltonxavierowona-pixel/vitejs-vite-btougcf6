-- =====================================================================
-- Numera Agentic — automatisations sans n8n (tout dans Supabase, gratuit)
-- Remplace les workflows n8n 02 (envoi), 03 (intention / profil / pilote),
-- 04 (relances) et 05 (alertes). Le workflow 01 (réception Meta) est déjà
-- remplacé par l'Edge Function meta-webhook.
--   - messages : un trigger appelle l'Edge Function numera-hooks par pg_net
--     (envoi d'un message en file, ou analyse d'un message reçu) ;
--   - alerts   : envoi direct par e-mail (Gmail, mail_send) et Telegram si configuré ;
--   - relances : pg_cron toutes les heures de 8 h à 19 h (heure de Douala).
-- Secret partagé : le même que send-email (Vault, mail_hook_secret).
-- =====================================================================

-- Vérification du secret par les Edge Functions (clé service_role).
create or replace function hook_secret_ok(p_secret text) returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(p_secret, '') <> '' and mail_hook_check(p_secret) $$;

-- Adresse des Edge Functions, déduite de celle de send-email.
create or replace function functions_base_url() returns text
language sql stable security definer set search_path = public
as $$
  select nullif(regexp_replace(coalesce(value ->> 'mail_function_url', ''), '/send-email/?$', ''), '')
  from platform_settings where key = 'notifications'
$$;

-- Appel asynchrone de numera-hooks (après validation de la transaction).
create or replace function hook_post(p_payload jsonb) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_base text; v_secret text;
begin
  v_base := functions_base_url();
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'mail_hook_secret';
  if v_base is null or v_secret is null then return; end if;
  perform net.http_post(
    url     := v_base || '/numera-hooks',
    body    := p_payload,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-numera-secret', v_secret),
    timeout_milliseconds := 10000);
end $$;

-- ---------- Messages : envoi (ex-workflow 02) et analyse (ex-workflow 03) ----------

create or replace function messages_dispatch() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.direction = 'outbound' and new.status = 'queued'
     and (tg_op = 'INSERT' or old.status = 'pending_approval') then
    perform hook_post(jsonb_build_object('kind', 'outbound', 'message_id', new.id));
  elsif tg_op = 'INSERT' and new.direction = 'inbound' then
    perform hook_post(jsonb_build_object('kind', 'inbound', 'message_id', new.id, 'conversation_id', new.conversation_id));
  end if;
  return new;
end $$;

drop trigger if exists messages_dispatch on messages;
create trigger messages_dispatch after insert or update of status on messages
  for each row execute function messages_dispatch();

-- ---------- Alertes (ex-workflow 05) ----------
-- Les alertes « billing » restent dans la plateforme : leurs e-mails partent déjà (0011).

create or replace function alerts_dispatch() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare d jsonb; v_token text; v_tg boolean := false; v_mail boolean := false;
begin
  if new.kind = 'billing' then return new; end if;
  d := alert_delivery(new.id);
  if d is null then return new; end if;

  if coalesce(d ->> 'email', '') <> '' then
    perform mail_send(d ->> 'email', d ->> 'title', coalesce(d ->> 'body', ''),
                      'Ouvrir Numera Agentic', app_url() || coalesce(d ->> 'link_path', '/'));
    v_mail := true;
  end if;

  if coalesce(d ->> 'telegram_chat_id', '') <> '' then
    select decrypted_secret into v_token from vault.decrypted_secrets where name = 'telegram_bot_token';
    if v_token is not null then
      perform net.http_post(
        url     := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
        body    := jsonb_build_object('chat_id', d ->> 'telegram_chat_id', 'disable_web_page_preview', true,
                     'text', (d ->> 'title') || E'\n' || coalesce(d ->> 'body', '') || E'\n\n' || app_url() || coalesce(d ->> 'link_path', '/')),
        headers := '{"Content-Type": "application/json"}'::jsonb);
      v_tg := true;
    end if;
  end if;

  perform mark_alert_sent(new.id, jsonb_build_object('email', v_mail, 'telegram', v_tg));
  return new;
end $$;

drop trigger if exists alerts_dispatch on alerts;
create trigger alerts_dispatch after insert on alerts
  for each row execute function alerts_dispatch();

-- ---------- Relances (ex-workflow 04) : toutes les heures, 8 h → 19 h à Douala (UTC+1) ----------

select cron.schedule('numera-followups', '0 7-18 * * *', 'select public.run_followups()');

-- ---------- Droits ----------

revoke execute on function hook_secret_ok(text)  from public, anon, authenticated;
revoke execute on function functions_base_url()  from public, anon, authenticated;
revoke execute on function hook_post(jsonb)      from public, anon, authenticated;
revoke execute on function messages_dispatch()   from public, anon, authenticated;
revoke execute on function alerts_dispatch()     from public, anon, authenticated;
grant execute on function hook_secret_ok(text) to service_role;
