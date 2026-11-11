-- =====================================================================
-- Numera Agentic — rattrapage des messages restés sans réponse.
-- Quand tous les modèles IA sont saturés, la réponse du pilote automatique échoue.
-- Toutes les 3 minutes, on relance les conversations dont le dernier message est celui
-- du client (reçu il y a 3 à 60 minutes), tant que l'IA n'est pas en pause.
-- =====================================================================

create or replace function retry_unanswered()
returns int language plpgsql security definer set search_path = public
as $$
declare r record; n int := 0;
begin
  for r in
    select c.id as conversation_id, lm.id as message_id
    from conversations c
    join channel_accounts a on a.id = c.channel_account_id
    join organizations o on o.id = c.organization_id
    join prospects p on p.id = c.prospect_id
    join lateral (
      select m.id, m.direction from messages m
      where m.conversation_id = c.id order by m.sent_at desc limit 1
    ) lm on lm.direction = 'inbound'
    where not c.ai_paused
      and not p.do_not_contact
      and a.mode = 'auto'
      and c.last_inbound_at between now() - interval '60 minutes' and now() - interval '3 minutes'
      and case when a.channel = 'whatsapp' then coalesce((o.automation->>'autopilot_whatsapp')::boolean, true)
               when a.channel in ('facebook', 'instagram') then coalesce((o.automation->>'autopilot_social')::boolean, false)
               else false end
    limit 20
  loop
    perform hook_post(jsonb_build_object('kind', 'inbound', 'message_id', r.message_id, 'conversation_id', r.conversation_id));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function retry_unanswered() from public, anon, authenticated;

select cron.unschedule('numera-retry-unanswered') where exists (select 1 from cron.job where jobname = 'numera-retry-unanswered');
select cron.schedule('numera-retry-unanswered', '*/3 * * * *', 'select public.retry_unanswered()');
