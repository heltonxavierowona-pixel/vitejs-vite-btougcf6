import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Signature des webhooks Neero (exemple officiel de la documentation) :
 *   chaîne signée = X-TIMESTAMP + corps brut de la requête
 *   HMAC-SHA512 avec le secret webhook, en hexadécimal = X-SIGNATURE
 */
export function signNeeroPayload(timestamp: string, rawBody: Buffer | string, secret: string): string {
  return createHmac('sha512', secret)
    .update(timestamp)
    .update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody)
    .digest('hex');
}

/**
 * Date d'un en-tête X-TIMESTAMP : secondes ou millisecondes depuis
 * 1970, ou date ISO. Null si illisible.
 */
export function parseNeeroTimestamp(value: string): number | null {
  const trimmed = value.trim();
  if (/^\d{9,16}$/.test(trimmed)) {
    const n = Number(trimmed);
    return n > 1e12 ? n : n * 1000;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

export interface VerifyOptions {
  /** Âge maximal accepté, en secondes ; 0 désactive le contrôle. */
  toleranceSeconds: number;
  now?: number;
}

/**
 * Vérifie signature et fraîcheur. Comparaison à temps constant ;
 * un horodatage illisible ou trop ancien (rejeu) est refusé.
 */
export function verifyNeeroSignature(
  rawBody: Buffer | string,
  timestamp: string | undefined,
  signature: string | undefined,
  secret: string,
  options: VerifyOptions,
): boolean {
  if (!secret || !timestamp || !signature) return false;

  if (options.toleranceSeconds > 0) {
    const sentAt = parseNeeroTimestamp(timestamp);
    if (sentAt === null) return false;
    const age = Math.abs((options.now ?? Date.now()) - sentAt) / 1000;
    if (age > options.toleranceSeconds) return false;
  }

  const expected = Buffer.from(signNeeroPayload(timestamp, rawBody, secret), 'utf8');
  const received = Buffer.from(signature.trim().toLowerCase(), 'utf8');
  return expected.length === received.length && timingSafeEqual(expected, received);
}
