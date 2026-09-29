import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

import { BRAND } from '../config/brand';

/**
 * ============================================================
 *  PASSERELLE DE PAIEMENT
 * ============================================================
 *
 *  Flutterwave est isolé derrière cette interface afin de
 *  pouvoir changer d'agrégateur sans toucher au reste du code.
 *  Aucun autre fichier ne doit importer le SDK ou appeler
 *  l'API du fournisseur directement.
 *
 *  ⚠️ À VÉRIFIER avant mise en production :
 *   - couverture réelle MTN MoMo et Orange Money au Cameroun
 *   - frais exacts par transaction
 *   - support ou non des paiements récurrents automatiques
 *     (à ce jour, le Mobile Money impose une action du client)
 * ============================================================
 */

export interface PaymentInitParams {
  txRef: string;
  amount: number; // centimes de FCFA
  customerEmail: string;
  customerPhone: string;
  customerName: string;
  description: string;
  redirectUrl: string;
}

export interface PaymentInitResult {
  paymentUrl: string;
  providerRef?: string;
}

export interface PaymentVerification {
  isSuccessful: boolean;
  /**
   * Échec DÉFINITIF chez le prestataire (refusé, annulé, expiré).
   * Un paiement simplement en attente n'est pas un échec : le client
   * peut encore valider sur son téléphone.
   */
  isFailed?: boolean;
  amount: number; // centimes de FCFA
  currency: string;
  providerTxId: string;
  /** Notre référence, telle qu'enregistrée chez le fournisseur. */
  txRef: string | null;
  method?: string;
  raw: unknown;
}

@Injectable()
export class FlutterwaveService {
  private readonly logger = new Logger(FlutterwaveService.name);
  private readonly baseUrl = 'https://api.flutterwave.com/v3';

  private get secretKey(): string {
    const key = process.env.FLUTTERWAVE_SECRET_KEY;
    if (!key) throw new Error('FLUTTERWAVE_SECRET_KEY non configurée');
    return key;
  }

  /**
   * Crée un lien de paiement. Le client règle par Mobile Money
   * ou carte sur la page hébergée par le fournisseur — on ne
   * manipule jamais ses identifiants de paiement.
   */
  async initPayment(params: PaymentInitParams): Promise<PaymentInitResult> {
    const response = await fetch(`${this.baseUrl}/payments`, {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tx_ref: params.txRef,
        // L'API attend des unités entières de devise, pas des
        // centimes : conversion ici et nulle part ailleurs.
        amount: Math.round(params.amount / 100),
        currency: 'XAF',
        redirect_url: params.redirectUrl,
        payment_options: 'mobilemoneyfranco,card',
        customer: {
          email: params.customerEmail,
          phonenumber: params.customerPhone,
          name: params.customerName,
        },
        customizations: {
          title: `Abonnement ${BRAND.name}`,
          logo: `${process.env.FRONTEND_URL ?? ''}/icon.png`,
          description: params.description,
        },
      }),
    });

    const body: any = await response.json().catch(() => null);

    if (!response.ok || body?.status !== 'success') {
      this.logger.error(
        `Échec d'initialisation du paiement ${params.txRef}`,
        JSON.stringify(body),
      );
      throw new Error(
        body?.message ?? 'Impossible de créer le lien de paiement',
      );
    }

    return { paymentUrl: body.data.link };
  }

  /**
   * Vérifie une transaction auprès du fournisseur.
   *
   * RÈGLE : ne JAMAIS se fier au seul contenu du webhook pour
   * créditer un abonnement. On revérifie toujours côté serveur.
   */
  async verifyPayment(providerTxId: string): Promise<PaymentVerification> {
    // L'identifiant vient du navigateur ou du webhook : on ne
    // l'insère dans l'URL qu'après avoir vérifié son format.
    if (!/^\d{1,20}$/.test(providerTxId)) {
      return {
        isSuccessful: false,
        amount: 0,
        currency: 'XAF',
        providerTxId,
        txRef: null,
        raw: { error: 'Identifiant de transaction invalide' },
      };
    }

    const response = await fetch(
      `${this.baseUrl}/transactions/${providerTxId}/verify`,
      {
        headers: { Authorization: `Bearer ${this.secretKey}` },
        signal: AbortSignal.timeout(15_000),
      },
    );

    const body: any = await response.json().catch(() => null);

    if (!response.ok || body?.status !== 'success') {
      return {
        isSuccessful: false,
        amount: 0,
        currency: 'XAF',
        providerTxId,
        txRef: null,
        raw: body,
      };
    }

    const data = body.data;

    return {
      isSuccessful: data.status === 'successful',
      isFailed: ['failed', 'cancelled'].includes(String(data.status)),
      amount: Math.round(Number(data.amount) * 100),
      currency: data.currency,
      providerTxId: String(data.id),
      txRef: data.tx_ref ?? null,
      method: data.payment_type,
      raw: data,
    };
  }

  /**
   * Valide la signature du webhook.
   * Comparaison à temps constant pour éviter les attaques
   * temporelles.
   */
  verifyWebhookSignature(signature: string | undefined): boolean {
    const expected = process.env.FLUTTERWAVE_WEBHOOK_HASH;
    if (!expected || !signature) return false;

    const a = Buffer.from(signature);
    const b = Buffer.from(expected);

    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Référence de transaction unique et traçable. */
  buildTxRef(organizationId: string): string {
    const stamp = Date.now().toString(36);
    const random = createHmac('sha256', this.secretKey)
      .update(`${organizationId}${stamp}${randomBytes(8).toString('hex')}`)
      .digest('hex')
      .slice(0, 12);
    return `SUB-${organizationId.slice(0, 8)}-${stamp}-${random}`;
  }
}
