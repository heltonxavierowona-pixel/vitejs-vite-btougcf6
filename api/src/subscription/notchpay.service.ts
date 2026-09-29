import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

import { BRAND } from '../config/brand';
import type {
  PaymentInitParams,
  PaymentVerification,
} from './flutterwave.service';

/**
 * ============================================================
 *  PASSERELLE NOTCH PAY — MTN Mobile Money, Orange Money, carte
 * ============================================================
 *
 *  Prestataire camerounais. Le client paie sur la page hébergée
 *  par Notch Pay : Numera ne voit jamais ses identifiants.
 *
 *  Comme tout paiement Mobile Money, il n'y a pas de prélèvement
 *  automatique : chaque mois est payé à l'avance, les relances
 *  (SubscriptionCronService) provoquent le renouvellement.
 *
 *  Clés (tableau de bord Notch Pay → Développeurs) :
 *   - NOTCHPAY_PUBLIC_KEY : en-tête Authorization des appels
 *   - NOTCHPAY_HASH_KEY   : vérification de la signature des webhooks
 *
 *  Montants : l'API attend des francs CFA entiers ; Numera stocke
 *  des centimes. La conversion se fait ici et nulle part ailleurs.
 * ============================================================
 */
@Injectable()
export class NotchPayService {
  private readonly logger = new Logger(NotchPayService.name);

  get isEnabled(): boolean {
    return !!process.env.NOTCHPAY_PUBLIC_KEY;
  }

  private get baseUrl(): string {
    // Serveur simulé autorisé pour les tests locaux uniquement.
    if (process.env.NODE_ENV !== 'production' && process.env.NOTCHPAY_API_URL) {
      return process.env.NOTCHPAY_API_URL;
    }
    return 'https://api.notchpay.co';
  }

  private get publicKey(): string {
    const key = process.env.NOTCHPAY_PUBLIC_KEY;
    if (!key) {
      throw new ServiceUnavailableException(
        'Le paiement Notch Pay n’est pas configuré sur ce serveur.',
      );
    }
    return key;
  }

  private headers() {
    return {
      Authorization: this.publicKey,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  /** Référence unique, transmise à Notch Pay et conservée chez nous. */
  buildTxRef(organizationId: string): string {
    return `NUM-${organizationId.slice(0, 8)}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  }

  /**
   * Crée le paiement et renvoie la page où rediriger le client.
   * `providerRef` est la référence attribuée par Notch Pay : elle
   * sert ensuite à vérifier la transaction.
   */
  async initPayment(
    params: PaymentInitParams,
  ): Promise<{ paymentUrl: string; providerRef: string | null }> {
    const phone = normalizeCameroonPhone(params.customerPhone);
    const payload = {
      amount: Math.round(params.amount / 100),
      currency: 'XAF',
      reference: params.txRef,
      description: params.description,
      callback: params.redirectUrl,
      email: params.customerEmail,
      ...(phone && { phone }),
      customer: {
        email: params.customerEmail,
        name: params.customerName,
        ...(phone && { phone }),
      },
    };

    // Point d'entrée actuel, puis l'historique en secours : les deux
    // coexistent chez Notch Pay selon l'ancienneté du compte.
    let lastError = 'réponse inattendue';
    for (const path of ['/payments', '/payments/initialize']) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: this.headers(),
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify(payload),
      });
      const body: any = await response.json().catch(() => null);
      const paymentUrl: string | undefined =
        body?.authorization_url ?? body?.transaction?.authorization_url;

      if (response.ok && paymentUrl) {
        return { paymentUrl, providerRef: body?.transaction?.reference ?? null };
      }

      lastError = describeNotchPayError(response.status, body);
      this.logger.error(
        `Notch Pay ${path} a refusé ${params.txRef} (HTTP ${response.status}) : ${JSON.stringify(body)}`,
      );
      // Clé refusée : inutile d'essayer l'autre point d'entrée.
      if (response.status === 401 || response.status === 403) break;
    }

    throw new BadGatewayException(`Notch Pay a refusé le paiement : ${lastError}`);
  }

  /**
   * Relit une transaction chez Notch Pay. RÈGLE : ni le retour
   * navigateur ni le webhook ne suffisent à activer un abonnement ;
   * seule cette vérification serveur fait foi.
   */
  async verifyPayment(reference: string): Promise<PaymentVerification> {
    const failed = (raw: unknown): PaymentVerification => ({
      isSuccessful: false,
      amount: 0,
      currency: 'XAF',
      providerTxId: reference,
      txRef: null,
      raw,
    });

    if (!/^[A-Za-z0-9._-]{4,120}$/.test(reference)) {
      return failed({ error: 'Référence invalide' });
    }

    const response = await fetch(
      `${this.baseUrl}/payments/${encodeURIComponent(reference)}`,
      { headers: this.headers(), signal: AbortSignal.timeout(15_000) },
    );
    const body: any = await response.json().catch(() => null);
    const trx = body?.transaction;
    if (!response.ok || !trx) return failed(body);

    const francs = Number(trx.amounts?.total ?? trx.amount ?? 0);
    return {
      isSuccessful: trx.status === 'complete',
      isFailed: ['failed', 'canceled', 'cancelled', 'expired', 'rejected'].includes(
        String(trx.status),
      ),
      amount: Math.round(francs * 100),
      currency: String(trx.currency ?? '').toUpperCase(),
      providerTxId: String(trx.reference),
      // Notre référence, telle que Notch Pay l'a enregistrée.
      txRef: trx.merchant_reference ?? trx.reference ?? null,
      method: trx.payment_method ?? trx.channel,
      raw: trx,
    };
  }

  /**
   * Signature des webhooks : HMAC-SHA256 du corps brut avec la
   * clé de hachage, en hexadécimal, dans l'en-tête x-notch-signature.
   * Comparaison à temps constant.
   */
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    const secret = process.env.NOTCHPAY_HASH_KEY;
    if (!secret || !signature) return false;
    const expected = Buffer.from(
      createHmac('sha256', secret).update(rawBody).digest('hex'),
    );
    const received = Buffer.from(signature.trim().toLowerCase());
    return expected.length === received.length && timingSafeEqual(expected, received);
  }

  /** Libellé affiché sur la page de paiement. */
  describe(planLabel: string) {
    return `${BRAND.name} — ${planLabel} — 1 mois`;
  }
}

/**
 * Numéro camerounais au format international (+237…). Les numéros
 * saisis sans indicatif (« 656566762 ») sont complétés ; tout autre
 * format est transmis tel quel ou omis s'il est vide.
 */
export function normalizeCameroonPhone(input?: string | null): string | undefined {
  const digits = (input ?? '').replace(/[^\d+]/g, '');
  if (!digits) return undefined;
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('237') && digits.length === 12) return `+${digits}`;
  if (/^6\d{8}$/.test(digits)) return `+237${digits}`;
  return digits;
}

/** Message lisible à partir d'une erreur de l'API Notch Pay. */
export function describeNotchPayError(status: number, body: any): string {
  if (status === 401 || status === 403) {
    return 'clé API refusée (vérifiez NOTCHPAY_PUBLIC_KEY).';
  }
  const details =
    body?.errors && typeof body.errors === 'object'
      ? Object.values(body.errors).flat().filter(Boolean).join(' ')
      : '';
  return [body?.message, details].filter(Boolean).join(' — ') || `erreur HTTP ${status}`;
}
