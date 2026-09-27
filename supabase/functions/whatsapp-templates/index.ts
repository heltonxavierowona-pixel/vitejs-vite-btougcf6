// POST { action: 'create_defaults' | 'sync' }
// create_defaults : soumet à Meta les modèles de relance (FR + EN) pour le WhatsApp de l'utilisateur.
// sync            : met à jour leur statut (PENDING → APPROVED / REJECTED).
// Les relances WhatsApp hors fenêtre de 24 h ne peuvent partir qu'avec un modèle APPROVED.
import { graph, handler, HttpError, json, requireUser, rest } from '../_shared/supabase.ts'
import { DEFAULT_FOLLOWUP_TEMPLATES, templateName } from '../_shared/prompts.ts'

interface Account { id: string; waba_id: string | null }
interface TemplateRow { id: string; name: string; language: string; status: string }

Deno.serve(handler(async (req) => {
  const { jwt, orgId } = await requireUser(req)
  const { action } = (await req.json()) as { action: string }

  const [account] = await rest<Account[]>(
    `channel_accounts?channel=eq.whatsapp&status=eq.active&select=id,waba_id&limit=1`, { jwt })
  if (!account?.waba_id) throw new HttpError(400, 'Connectez d\'abord votre WhatsApp dans « Canaux »')
  const [cred] = await rest<{ access_token: string }[]>(
    `channel_credentials?channel_account_id=eq.${account.id}&select=access_token`)
  if (!cred) throw new HttpError(400, 'Jeton WhatsApp introuvable : reconnectez WhatsApp')
  const token = cred.access_token

  if (action === 'create_defaults') {
    const existing = await rest<TemplateRow[]>(`whatsapp_templates?channel_account_id=eq.${account.id}&select=id,name,language,status`, { jwt })
    for (const t of DEFAULT_FOLLOWUP_TEMPLATES) {
      const name = templateName(t.purpose, t.language)
      if (existing.some((e) => e.name === name && e.language === t.language && e.status !== 'REJECTED')) continue
      let status = 'PENDING'
      let metaId: string | null = null
      let reason: string | null = null
      try {
        const created = await graph<{ id: string; status: string }>(`${account.waba_id}/message_templates`, {
          method: 'POST',
          token,
          body: {
            name, language: t.language, category: 'MARKETING',
            components: [{ type: 'BODY', text: t.body, example: { body_text: [['Awa', 'Core HR']] } }],
          },
        })
        metaId = created.id
        status = created.status ?? 'PENDING'
      } catch (e) {
        status = 'REJECTED'
        reason = e instanceof Error ? e.message.slice(0, 300) : String(e)
      }
      await rest('whatsapp_templates?on_conflict=channel_account_id,name,language', {
        method: 'POST', jwt, prefer: 'resolution=merge-duplicates,return=minimal',
        body: {
          organization_id: orgId, channel_account_id: account.id, purpose: t.purpose, name,
          language: t.language, category: 'MARKETING', body: t.body, status, meta_template_id: metaId,
          rejected_reason: reason, updated_at: new Date().toISOString(),
        },
      })
    }
  } else if (action !== 'sync') {
    throw new HttpError(400, 'action inconnue')
  }

  // Synchronisation des statuts depuis Meta.
  const remote = await graph<{ data: { name: string; language: string; status: string; id: string; rejected_reason?: string }[] }>(
    `${account.waba_id}/message_templates?fields=name,language,status,id,rejected_reason&limit=100`, { token })
  const local = await rest<TemplateRow[]>(`whatsapp_templates?channel_account_id=eq.${account.id}&select=id,name,language,status`, { jwt })
  for (const t of local) {
    const r = remote.data.find((x) => x.name === t.name && x.language === t.language)
    if (r && r.status !== t.status) {
      await rest(`whatsapp_templates?id=eq.${t.id}`, {
        method: 'PATCH', jwt, prefer: 'return=minimal',
        body: { status: r.status, meta_template_id: r.id, rejected_reason: r.rejected_reason ?? null, updated_at: new Date().toISOString() },
      })
    }
  }
  return json(await rest(`whatsapp_templates?channel_account_id=eq.${account.id}&select=*&order=purpose,language`, { jwt }))
}))
