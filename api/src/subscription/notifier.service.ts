import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

import { PrismaService } from '../prisma/prisma.service';
import { BRAND } from '../config/brand';
import { platformAdminEmails } from '../auth/platform-admin';

const TELEGRAM_CHAT_KEY = 'telegram.chatId';

/**
 * ============================================================
 *  NOTIFICATIONS
 * ============================================================
 *
 *  - Administrateur : bot Telegram (instantané, gratuit), ou
 *    e-mail si Telegram n'est pas configuré ou échoue.
 *  - Client : e-mail (SMTP, par exemple Gmail avec un mot de
 *    passe d'application).
 *
 *  Une notification qui échoue ne bloque JAMAIS l'opération
 *  métier : elle est journalisée et la méthode renvoie false.
 *
 *  Variables :
 *   TELEGRAM_BOT_TOKEN  jeton du bot (BotFather)
 *   TELEGRAM_CHAT_ID    facultatif : détecté depuis l'écran admin
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM
 * ============================================================
 */
@Injectable()
export class NotifierService {
  private readonly logger = new Logger(NotifierService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly prisma: PrismaService) {}

  // ----------------------------------------------------------
  //  Administrateur
  // ----------------------------------------------------------

  /** Prévient l'administrateur : Telegram, sinon e-mail. */
  async notifyAdmin(subject: string, lines: string[]): Promise<boolean> {
    if (await this.sendTelegram(`<b>${escapeHtml(subject)}</b>\n${lines.map(escapeHtml).join('\n')}`)) {
      return true;
    }
    const admins = platformAdminEmails();
    if (!admins.length) return false;
    return this.sendEmail(admins.join(','), `[${BRAND.name}] ${subject}`, lines.join('\n'));
  }

  get telegramConfigured(): boolean {
    return !!process.env.TELEGRAM_BOT_TOKEN;
  }

  async telegramChatId(): Promise<string | null> {
    if (process.env.TELEGRAM_CHAT_ID) return process.env.TELEGRAM_CHAT_ID;
    const setting = await this.prisma.platformSetting.findUnique({
      where: { key: TELEGRAM_CHAT_KEY },
    });
    return setting?.value ?? null;
  }

  /**
   * Retrouve la conversation ouverte avec le bot : l'administrateur
   * envoie un message au bot, puis clique « Détecter ».
   */
  async detectTelegramChat(): Promise<{ chatId: string; name: string } | null> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return null;

    const response = await fetch(`${telegramApi()}/bot${token}/getUpdates`, {
      signal: AbortSignal.timeout(10_000),
    });
    const body: any = await response.json().catch(() => null);
    const updates: any[] = body?.result ?? [];
    const chat = updates
      .map((u) => u.message?.chat ?? u.my_chat_member?.chat)
      .filter(Boolean)
      .pop();
    if (!chat) return null;

    const chatId = String(chat.id);
    await this.prisma.platformSetting.upsert({
      where: { key: TELEGRAM_CHAT_KEY },
      create: { key: TELEGRAM_CHAT_KEY, value: chatId },
      update: { value: chatId },
    });
    const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.title || chatId;
    return { chatId, name };
  }

  async sendTelegram(html: string): Promise<boolean> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return false;
    try {
      const chatId = await this.telegramChatId();
      if (!chatId) return false;
      const response = await fetch(`${telegramApi()}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          chat_id: chatId,
          text: html,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
      if (!response.ok) {
        this.logger.error(`Telegram a refusé le message (HTTP ${response.status})`);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error(`Telegram injoignable : ${describe(error)}`);
      return false;
    }
  }

  // ----------------------------------------------------------
  //  Client
  // ----------------------------------------------------------

  get emailConfigured(): boolean {
    return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  }

  async sendEmail(to: string, subject: string, text: string): Promise<boolean> {
    if (!to || !this.emailConfigured) {
      this.logger.warn(`E-mail non envoyé (SMTP non configuré) : ${subject}`);
      return false;
    }
    try {
      this.transporter ??= createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 465),
        secure: Number(process.env.SMTP_PORT ?? 465) === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        connectionTimeout: 10_000,
        socketTimeout: 15_000,
      });
      await this.transporter.sendMail({
        from: process.env.MAIL_FROM ?? `${BRAND.name} <${process.env.SMTP_USER}>`,
        replyTo: BRAND.supportEmail,
        to,
        subject,
        text: `${text}\n\n— L’équipe ${BRAND.name}\n${BRAND.supportEmail}`,
      });
      return true;
    } catch (error) {
      this.logger.error(`E-mail « ${subject} » non envoyé : ${describe(error)}`);
      return false;
    }
  }
}

/**
 * Lien WhatsApp prêt à envoyer (wa.me) : l'administrateur l'ouvre
 * et n'a plus qu'à appuyer sur « Envoyer ». L'envoi entièrement
 * automatique exige l'API WhatsApp Business (payante).
 */
export function whatsappLink(phone: string | null | undefined, message: string): string | null {
  let digits = (phone ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^6\d{8}$/.test(digits)) digits = `237${digits}`;
  if (digits.length < 9) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Faux serveur autorisé pour les tests locaux uniquement. */
function telegramApi() {
  if (process.env.NODE_ENV !== 'production' && process.env.TELEGRAM_API_URL) {
    return process.env.TELEGRAM_API_URL;
  }
  return 'https://api.telegram.org';
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
