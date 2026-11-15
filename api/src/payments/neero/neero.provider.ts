import { Injectable, Logger } from '@nestjs/common';

import {
  CheckoutParams,
  CheckoutResult,
  NormalizedPaymentStatus,
  PaymentProvider,
  PaymentProviderError,
  PaymentWebhookEvent,
  TransactionStatus,
  WebhookHeaders,
} from '../payment-provider';
import { isNeeroConfigured, NeeroConfig, readNeeroConfig } from './neero.config';
import { verifyNeeroSignature } from './neero-signature';

/**
 * ============================================================
 *  PASSERELLE NEERO
 * ============================================================
 *
 *  Encaissement : Create Cash In Payment Intent (confirm: false)
 *  puis Create Session, qui fournit la page de paiement hébergée.
 *  Le client y choisit son moyen de paiement (MTN, Orange…).
 *
 *  Tous les appels partent du serveur ; la clé secrète n'apparaît
 *  jamais dans les journaux ni dans les réponses.
 * ============================================================
 */
@Injectable()
export class NeeroProvider implements PaymentProvider {
  readonly name = 'neero';
  private readonly logger = new Logger(NeeroProvider.name);

  /** Relue à chaque appel : une variable modifiée prend effet au redéploiement. */
  get config(): NeeroConfig {
    return readNeeroConfig();
  }

  get isConfigured(): boolean {
    return isNeeroConfigured(this.config);
  }

  async createCheckout(params: CheckoutParams): Promise<CheckoutResult> {
    const config = this.config;
    if (!Number.isInteger(params.amount) || params.amount <= 0) {
      throw new PaymentProviderError('Montant invalide');
    }

    const intent = await this.request('POST', config.paths.cashIn, {
      amount: params.amount,
      currencyCode: params.currency,
      paymentType: config.cashInPaymentType,
      destinationPaymentMethodId: config.destinationPaymentMethodId,
      confirm: false,
      successUrl: params.successUrl,
      failureUrl: params.failureUrl,
      cancelUrl: params.cancelUrl,
      collectCustomerDetails: false,
      customer: {
        name: params.customer.name,
        email: params.customer.email ?? '',
        phone: params.customer.phone ?? '',
      },
      metadata: params.metadata,
      flowTransactions: [],
      ...(params.displayInfo && { displayInfo: params.displayInfo }),
    });

    const transactionIntentId = pickString(intent, ['id', 'transactionIntentId', 'data.id', 'data.transactionIntentId']);
    if (!transactionIntentId) {
      throw new PaymentProviderError('Neero n’a pas renvoyé d’identifiant de transaction');
    }

    const session = await this.request('POST', config.paths.sessions, { transactionIntentId });
    const paymentUrl = extractSessionUrl(session, config);
    if (!paymentUrl) {
      this.logger.error(
        `Session Neero sans URL de paiement (champs reçus : ${Object.keys(asObject(session)).join(', ')})`,
      );
      throw new PaymentProviderError('Neero n’a pas renvoyé de page de paiement');
    }
    return { transactionIntentId, paymentUrl };
  }

  async getTransactionStatus(transactionIntentId: string): Promise<TransactionStatus> {
    assertId(transactionIntentId);
    const body = await this.request('GET', this.pathFor(this.config.paths.transaction, transactionIntentId));
    const trx = asObject(pick(body, 'data') ?? body);
    const providerStatus = String(pick(trx, 'status') ?? '');
    const amount = Number(pick(trx, 'amount'));

    return {
      transactionIntentId: String(pick(trx, 'id') ?? transactionIntentId),
      status: normalizeNeeroStatus(providerStatus),
      providerStatus,
      amount: Number.isFinite(amount) ? amount : null,
      currency: (pickString(trx, ['currencyCode', 'currency']) ?? null)?.toUpperCase() ?? null,
      metadata: asObject(pick(trx, 'metadata')),
      raw: trx,
    };
  }

  async cancelTransaction(transactionIntentId: string): Promise<void> {
    assertId(transactionIntentId);
    await this.request('POST', this.pathFor(this.config.paths.cancel, transactionIntentId), {});
  }

  verifyWebhook(rawBody: Buffer | string, headers: WebhookHeaders): boolean {
    const config = this.config;
    return verifyNeeroSignature(
      rawBody,
      header(headers, 'x-timestamp'),
      header(headers, 'x-signature'),
      config.webhookSecret,
      { toleranceSeconds: config.webhookToleranceSeconds },
    );
  }

  parseWebhookEvent(rawBody: Buffer | string): PaymentWebhookEvent {
    let body: any;
    try {
      body = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'));
    } catch {
      throw new PaymentProviderError('Webhook illisible');
    }
    const object = asObject(pick(body, 'data.object'));
    const status = pick(object, 'status');
    return {
      eventId: String(body?.id ?? ''),
      type: String(body?.type ?? ''),
      transactionIntentId: pickString(object, ['id', 'transactionIntentId']) ?? null,
      status: status ? normalizeNeeroStatus(String(status)) : null,
      operatorId: pickString(body, ['operatorDetails.operatorId']) ?? null,
      metadata: { ...asObject(body?.metadata), ...asObject(object.metadata) },
      raw: body,
    };
  }

  // ----------------------------------------------------------

  private pathFor(template: string, id: string) {
    return template.replace('{id}', encodeURIComponent(id));
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
    const config = this.config;
    if (!config.baseUrl || !config.secretKey) {
      throw new PaymentProviderError('Neero n’est pas configuré sur ce serveur');
    }

    let response: Response;
    try {
      response = await fetch(`${config.baseUrl}${path}`, {
        method,
        headers: {
          [config.authHeader]: config.authScheme ? `${config.authScheme} ${config.secretKey}` : config.secretKey,
          Accept: 'application/json',
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      this.logger.error(`Neero injoignable (${method} ${path}) : ${error instanceof Error ? error.message : error}`);
      throw new PaymentProviderError('Neero est momentanément injoignable');
    }

    const payload: any = await response.json().catch(() => null);
    if (!response.ok) {
      const reason = describeNeeroError(response.status, payload);
      // Journal sans le corps envoyé (données client) ni la clé.
      this.logger.error(`Neero ${method} ${path} → HTTP ${response.status} : ${reason}`);
      throw new PaymentProviderError(reason, response.status);
    }
    return payload;
  }
}

// ------------------------------------------------------------
//  Fonctions pures (testées unitairement)
// ------------------------------------------------------------

/** Statuts Neero connus : PENDING, SUCCESSFUL, FAILED, EXPIRED (+ annulation). */
export function normalizeNeeroStatus(status: string): NormalizedPaymentStatus {
  switch (status.trim().toUpperCase()) {
    case 'SUCCESSFUL':
    case 'SUCCEEDED':
    case 'SUCCESS':
    case 'COMPLETED':
      return 'succeeded';
    case 'FAILED':
    case 'REJECTED':
      return 'failed';
    case 'EXPIRED':
      return 'expired';
    case 'CANCELED':
    case 'CANCELLED':
      return 'canceled';
    default:
      // PENDING, ou statut inconnu : on attend, on n'active rien.
      return 'pending';
  }
}

/**
 * URL de la page de paiement dans la réponse de Create Session.
 * Le nom du champ n'étant pas confirmé, on essaie les noms usuels ;
 * NEERO_SESSION_URL_FIELD permet de l'imposer.
 */
export function extractSessionUrl(session: unknown, config: Pick<NeeroConfig, 'sessionUrlField' | 'checkoutUrlTemplate'>): string | null {
  const candidates = config.sessionUrlField
    ? [config.sessionUrlField, `data.${config.sessionUrlField}`]
    : ['url', 'paymentUrl', 'checkoutUrl', 'sessionUrl', 'redirectUrl', 'link', 'paymentLink']
        .flatMap((key) => [key, `data.${key}`]);
  const url = pickString(session, candidates);
  if (url && /^https?:\/\//.test(url)) return url;

  const id = pickString(session, ['id', 'sessionId', 'data.id', 'data.sessionId']);
  if (id && config.checkoutUrlTemplate) {
    return config.checkoutUrlTemplate.replace('{id}', encodeURIComponent(id));
  }
  return null;
}

export function describeNeeroError(status: number, body: any): string {
  if (status === 401 || status === 403) return 'clé API Neero refusée (vérifiez NEERO_SECRET_KEY et NEERO_AUTH_HEADER)';
  const message = body?.message ?? body?.error ?? body?.errors;
  const text = Array.isArray(message) ? message.join(' ') : typeof message === 'string' ? message : '';
  return text ? `Neero : ${text}`.slice(0, 300) : `Neero : erreur HTTP ${status}`;
}

function assertId(id: string) {
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(id)) {
    throw new PaymentProviderError('Identifiant de transaction invalide');
  }
}

function header(headers: WebhookHeaders, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()] ??
    Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
  return Array.isArray(value) ? value[0] : value;
}

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function pick(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => asObject(current)[key], value);
}

function pickString(value: unknown, paths: string[]): string | undefined {
  for (const path of paths) {
    const found = pick(value, path);
    if (typeof found === 'string' && found) return found;
    if (typeof found === 'number') return String(found);
  }
  return undefined;
}
