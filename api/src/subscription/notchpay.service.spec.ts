import { createHmac } from 'crypto';

import {
  describeNotchPayError,
  normalizeCameroonPhone,
  NotchPayService,
} from './notchpay.service';

describe('normalizeCameroonPhone', () => {
  it.each([
    ['656566762', '+237656566762'],
    ['6 56 56 67 62', '+237656566762'],
    ['237656566762', '+237656566762'],
    ['00237656566762', '+237656566762'],
    ['+237656566762', '+237656566762'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeCameroonPhone(input)).toBe(expected);
  });

  it('omet un numéro vide', () => {
    expect(normalizeCameroonPhone('')).toBeUndefined();
    expect(normalizeCameroonPhone(null)).toBeUndefined();
  });
});

describe('describeNotchPayError', () => {
  it('explique un refus de clé', () => {
    expect(describeNotchPayError(401, null)).toContain('clé API refusée');
  });
  it('reprend le message et les erreurs de validation', () => {
    expect(
      describeNotchPayError(422, { message: 'Validation', errors: { phone: ['Numéro invalide'] } }),
    ).toBe('Validation — Numéro invalide');
  });
});

describe('NotchPayService.verifyWebhookSignature', () => {
  const service = new NotchPayService();
  const body = Buffer.from('{"id":"evt_1","type":"payment.complete"}');

  beforeEach(() => {
    process.env.NOTCHPAY_HASH_KEY = 'cle_de_hachage';
  });
  afterAll(() => {
    delete process.env.NOTCHPAY_HASH_KEY;
  });

  it('accepte une signature HMAC-SHA256 valide', () => {
    const signature = createHmac('sha256', 'cle_de_hachage').update(body).digest('hex');
    expect(service.verifyWebhookSignature(body, signature)).toBe(true);
  });

  it('refuse une signature fausse, absente ou un corps modifié', () => {
    const signature = createHmac('sha256', 'cle_de_hachage').update(body).digest('hex');
    expect(service.verifyWebhookSignature(body, 'deadbeef')).toBe(false);
    expect(service.verifyWebhookSignature(body, undefined)).toBe(false);
    expect(service.verifyWebhookSignature(Buffer.from('{"id":"evt_2"}'), signature)).toBe(false);
  });

  it('refuse tout si la clé n’est pas configurée', () => {
    delete process.env.NOTCHPAY_HASH_KEY;
    expect(service.verifyWebhookSignature(body, 'abc')).toBe(false);
  });
});
