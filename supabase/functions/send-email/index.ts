// POST { log_id, to, subject, html, text }
// Appelée uniquement par la base (pg_net, fonction mail_send) avec le secret x-mail-secret,
// rangé dans Vault et vérifié par mail_hook_check. Envoie l'e-mail depuis votre Gmail (SMTP),
// comme NUMERA-ai : SMTP_USER = votre adresse Gmail, SMTP_PASS = mot de passe d'application.
// Déploiement : verify_jwt = false (la base n'a pas de session utilisateur).
import nodemailer from 'npm:nodemailer@6.9.16'
import { handler, HttpError, json, rest } from '../_shared/supabase.ts'

interface Mail { log_id?: number; to: string; subject: string; html: string; text: string }

let transporter: nodemailer.Transporter | null = null

function smtp(): nodemailer.Transporter {
  const user = Deno.env.get('SMTP_USER')
  const pass = Deno.env.get('SMTP_PASS')
  if (!user || !pass) throw new HttpError(503, 'SMTP non configuré : ajoutez SMTP_USER et SMTP_PASS aux secrets des Edge Functions')
  const port = Number(Deno.env.get('SMTP_PORT') ?? 465)
  transporter ??= nodemailer.createTransport({
    host: Deno.env.get('SMTP_HOST') ?? 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user, pass: pass.replace(/\s+/g, '') }, // Google affiche le mot de passe par groupes de 4
  })
  return transporter
}

async function log(id: number | undefined, status: 'sent' | 'failed', error: string | null) {
  if (!id) return
  await rest(`email_log?id=eq.${id}`, { method: 'PATCH', body: { status, error, sent_at: new Date().toISOString() }, prefer: 'return=minimal' })
    .catch((e) => console.error('email_log', e))
}

Deno.serve(handler(async (req) => {
  const secret = req.headers.get('x-mail-secret') ?? ''
  const ok = secret && await rest<boolean>('rpc/mail_hook_check', { method: 'POST', body: { p_secret: secret } })
  if (!ok) throw new HttpError(401, 'Secret invalide')

  const mail = (await req.json()) as Mail
  if (!mail.to || !mail.subject) throw new HttpError(400, 'to et subject requis')
  try {
    const user = Deno.env.get('SMTP_USER')
    const info = await smtp().sendMail({
      from: `"${Deno.env.get('MAIL_FROM_NAME') ?? 'Numera Agentic'}" <${user}>`,
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    })
    await log(mail.log_id, 'sent', null)
    return json({ ok: true, id: info.messageId })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await log(mail.log_id, 'failed', message.slice(0, 500))
    throw e instanceof HttpError ? e : new HttpError(502, `Envoi impossible : ${message}`)
  }
}))
