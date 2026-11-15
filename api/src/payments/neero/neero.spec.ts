import { signNeeroPayload, parseNeeroTimestamp, verifyNeeroSignature } from './neero-signature';
import { describeNeeroError, extractSessionUrl, NeeroProvider, normalizeNeeroStatus } from './neero.provider';
import { isNeeroConfigured, readNeeroConfig } from './neero.config';

// Exemple calculé avec l'algorithme de la documentation Neero :
// HMAC-SHA512(secret, X-TIMESTAMP + corps brut), en hexadécimal.
const SECRET = 'whsec_test_numera';
const TIMESTAMP = '1790000000';
const BODY = '{"id":"evt_123","type":"transactionIntent.statusUpdated"}';
const EXPECTED =
  '266c25af762f926d75bc2af1e7047ad591cf198d6aa9460a7b107b2a82ced618' +
  'd1c1cc70d3fa8ccb52a633e61075841f08b5c4db398a468a65a11bc3b620dbed';
const NOW = 1_790_000_000_000 + 60_000; // une minute après l'envoi

describe('Neero — signature des webhooks', () => {
  it('calcule la signature attendue', () => {
    expect(signNeeroPayload(TIMESTAMP, BODY, SECRET)).toBe(EXPECTED);
    expect(signNeeroPayload(TIMESTAMP, Buffer.from(BODY), SECRET)).toBe(EXPECTED);
  });

  it('accepte une signature valide et récente (majuscules comprises)', () => {
    const opts = { toleranceSeconds: 300, now: NOW };
    expect(verifyNeeroSignature(BODY, TIMESTAMP, EXPECTED, SECRET, opts)).toBe(true);
    expect(verifyNeeroSignature(BODY, TIMESTAMP, EXPECTED.toUpperCase(), SECRET, opts)).toBe(true);
  });

  it('refuse un corps, un secret ou une signature modifiés', () => {
    const opts = { toleranceSeconds: 300, now: NOW };
    expect(verifyNeeroSignature(BODY.replace('123', '124'), TIMESTAMP, EXPECTED, SECRET, opts)).toBe(false);
    expect(verifyNeeroSignature(BODY, TIMESTAMP, EXPECTED, 'autre-secret', opts)).toBe(false);
    expect(verifyNeeroSignature(BODY, TIMESTAMP, EXPECTED.slice(0, -2) + '00', SECRET, opts)).toBe(false);
    expect(verifyNeeroSignature(BODY, TIMESTAMP, 'abc', SECRET, opts)).toBe(false);
  });

  it('refuse un en-tête manquant ou un secret non configuré', () => {
    const opts = { toleranceSeconds: 300, now: NOW };
    expect(verifyNeeroSignature(BODY, undefined, EXPECTED, SECRET, opts)).toBe(false);
    expect(verifyNeeroSignature(BODY, TIMESTAMP, undefined, SECRET, opts)).toBe(false);
    expect(verifyNeeroSignature(BODY, TIMESTAMP, EXPECTED, '', opts)).toBe(false);
  });

  it('refuse un webhook trop ancien (rejeu), sauf contrôle désactivé', () => {
    const late = 1_790_000_000_000 + 10 * 60_000;
    expect(verifyNeeroSignature(BODY, TIMESTAMP, EXPECTED, SECRET, { toleranceSeconds: 300, now: late })).toBe(false);
    expect(verifyNeeroSignature(BODY, TIMESTAMP, EXPECTED, SECRET, { toleranceSeconds: 0, now: late })).toBe(true);
  });

  it('lit les horodatages en secondes, millisecondes ou ISO', () => {
    expect(parseNeeroTimestamp('1790000000')).toBe(1_790_000_000_000);
    expect(parseNeeroTimestamp('1790000000000')).toBe(1_790_000_000_000);
    expect(parseNeeroTimestamp('2026-09-21T14:13:20.000Z')).toBe(Date.parse('2026-09-21T14:13:20.000Z'));
    expect(parseNeeroTimestamp('pas une date')).toBeNull();
  });
});

describe('Neero — statuts et réponses', () => {
  it('normalise les statuts', () => {
    expect(normalizeNeeroStatus('SUCCESSFUL')).toBe('succeeded');
    expect(normalizeNeeroStatus('PENDING')).toBe('pending');
    expect(normalizeNeeroStatus('FAILED')).toBe('failed');
    expect(normalizeNeeroStatus('EXPIRED')).toBe('expired');
    expect(normalizeNeeroStatus('CANCELED')).toBe('canceled');
    expect(normalizeNeeroStatus('cancelled')).toBe('canceled');
    // Inconnu : on n'active jamais par défaut.
    expect(normalizeNeeroStatus('SOMETHING_NEW')).toBe('pending');
  });

  it('trouve l’URL de paiement de la session', () => {
    const cfg = { sessionUrlField: '', checkoutUrlTemplate: '' };
    expect(extractSessionUrl({ url: 'https://pay.neero.tech/s/1' }, cfg)).toBe('https://pay.neero.tech/s/1');
    expect(extractSessionUrl({ data: { checkoutUrl: 'https://x.test/c' } }, cfg)).toBe('https://x.test/c');
    expect(extractSessionUrl({ id: 'ses_1' }, cfg)).toBeNull();
    expect(extractSessionUrl({ id: 'ses_1' }, { ...cfg, checkoutUrlTemplate: 'https://pay.test/{id}' })).toBe('https://pay.test/ses_1');
    expect(extractSessionUrl({ link: 'https://a.test', custom: 'https://b.test' }, { ...cfg, sessionUrlField: 'custom' })).toBe('https://b.test');
    expect(extractSessionUrl({ url: 'javascript:alert(1)' }, cfg)).toBeNull();
  });

  it('décrit les erreurs sans exposer la clé', () => {
    expect(describeNeeroError(401, null)).toMatch(/clé API Neero refusée/);
    expect(describeNeeroError(422, { message: ['amount must be positive'] })).toBe('Neero : amount must be positive');
    expect(describeNeeroError(500, null)).toBe('Neero : erreur HTTP 500');
  });

  it('lit un événement webhook', () => {
    const event = new NeeroProvider().parseWebhookEvent(
      JSON.stringify({
        id: 'evt_9',
        type: 'transactionIntent.statusUpdated',
        data: { object: { id: 'ti_1', status: 'SUCCESSFUL', metadata: { paymentId: 'p1' } } },
        operatorDetails: { operatorId: 'op_1', merchantKey: 'mk' },
      }),
    );
    expect(event).toMatchObject({
      eventId: 'evt_9',
      transactionIntentId: 'ti_1',
      status: 'succeeded',
      operatorId: 'op_1',
      metadata: { paymentId: 'p1' },
    });
  });
});

describe('Neero — configuration', () => {
  it('URL de production par défaut, aucune devinée en Sandbox', () => {
    expect(readNeeroConfig({ NEERO_ENV: 'production' }).baseUrl).toBe('https://api.neero.tech/payment-gateway');
    expect(readNeeroConfig({}).baseUrl).toBe('');
    expect(readNeeroConfig({ NEERO_BASE_URL: 'https://sandbox.test/' }).baseUrl).toBe('https://sandbox.test');
  });

  it('n’est prête qu’avec la clé et le moyen de paiement marchand', () => {
    const base = { NEERO_ENV: 'production', NEERO_SECRET_KEY: 'sk' };
    expect(isNeeroConfigured(readNeeroConfig(base))).toBe(false);
    expect(isNeeroConfigured(readNeeroConfig({ ...base, NEERO_DESTINATION_PAYMENT_METHOD_ID: 'pm_1' }))).toBe(true);
  });
});
