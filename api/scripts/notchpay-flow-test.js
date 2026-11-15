/**
 * Test de bout en bout du paiement Notch Pay, SANS vrai compte.
 *
 * Prérequis :
 *   1. Faux serveur :   python3 scripts/fake-notchpay-server.py
 *   2. API démarrée avec :
 *        NOTCHPAY_PUBLIC_KEY=pk_test_fake  NOTCHPAY_HASH_KEY=hash_test
 *        NOTCHPAY_API_URL=http://localhost:12112
 *        NODE_ENV=development (le faux serveur est refusé en production)
 *   3. API_URL=http://localhost:3000/api node scripts/notchpay-flow-test.js
 */
const { createHmac } = require('crypto');

const API = process.env.API_URL ?? 'http://localhost:3000/api';
const FAKE = process.env.FAKE_NOTCHPAY_URL ?? 'http://localhost:12112';
const HASH = process.env.NOTCHPAY_HASH_KEY ?? 'hash_test';

const results = [];
const check = (name, cond, info = '') => {
  results.push(cond);
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond ? '' : `  -> ${JSON.stringify(info)}`}`);
};

async function call(method, path, body, token) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

const fake = (path) => fetch(FAKE + path, { method: 'POST' }).then((r) => r.json());

let n = 0;
async function webhook(data, { type = 'payment.complete', signature, id } = {}) {
  const payload = JSON.stringify({ id: id ?? `evt_${Date.now()}_${n++}`, type, created_at: new Date().toISOString(), data });
  const sig = signature ?? createHmac('sha256', HASH).update(payload).digest('hex');
  const res = await fetch(`${API}/webhooks/notchpay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-notch-signature': sig },
    body: payload,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function register(kind, run) {
  const r = await call('POST', '/auth/register', {
    email: `np-${kind}-${run}@test.cm`, password: 'motdepasse123', firstName: 'Awa', lastName: 'Nkeng',
    phone: '656566762', organizationName: `Org ${kind}`, organizationType: 'ENTREPRISE',
    entity: { niu: `N${kind.toUpperCase()}${run.toUpperCase()}1`, legalName: 'AWA SARL', legalForm: 'SARL',
      taxRegime: 'RSI', address: 'Bastos', city: 'Yaoundé', phone: '656566762' },
  });
  return { token: r.data.accessToken, org: r.data.organization?.id, status: r.status };
}

(async () => {
  const run = Math.random().toString(36).slice(2, 7);
  const a = await register('a', run);
  check('inscription', a.status === 201, a);
  const base = `/organizations/${a.org}/subscription`;

  const plans = await call('GET', `${base}/plans`, undefined, a.token);
  check('Notch Pay proposé', plans.data.providers?.[0] === 'NOTCHPAY', plans.data);

  // ---- Paiement et activation par le retour navigateur ----
  const co = await call('POST', `${base}/checkout`, { plan: 'PME_STARTER', provider: 'NOTCHPAY' }, a.token);
  check('lien de paiement Notch Pay', co.status === 201 && co.data.paymentUrl?.startsWith('https://pay.notchpay.test/'), co.data);
  const notchRef = co.data.paymentUrl.split('/').pop();

  const early = await call('POST', `${base}/confirm-notchpay`, { txRef: co.data.txRef }, a.token);
  check('retour avant paiement : rien n’est activé', early.data.success === false, early.data);

  await fake(`/_test/complete/${notchRef}`);
  const ok = await call('POST', `${base}/confirm-notchpay`, { txRef: co.data.txRef }, a.token);
  check('retour navigateur : abonnement activé', ok.data.success === true, ok.data);
  let sub = (await call('GET', base, undefined, a.token)).data;
  check('PME Essentiel actif, payé par Notch Pay', sub.status === 'ACTIVE' && sub.plan.code === 'PME_STARTER' && sub.provider === 'NOTCHPAY', sub);
  check('paiement enregistré : 10 000 FCFA, MTN', sub.payments[0]?.amount === 1000000 && sub.payments[0]?.method === 'MOBILE_MONEY_MTN', sub.payments);
  const end1 = new Date(sub.currentPeriodEnd);

  const again = await call('POST', `${base}/confirm-notchpay`, { txRef: co.data.txRef }, a.token);
  sub = (await call('GET', base, undefined, a.token)).data;
  check('confirmation répétée : aucune double prolongation', again.data.alreadyProcessed === true && +new Date(sub.currentPeriodEnd) === +end1, again.data);

  const dup = await webhook({ reference: notchRef, merchant_reference: co.data.txRef, status: 'complete' });
  sub = (await call('GET', base, undefined, a.token)).data;
  check('webhook après le retour : sans effet', dup.status === 200 && +new Date(sub.currentPeriodEnd) === +end1, dup);

  // ---- Sécurité ----
  const bad = await webhook({ reference: notchRef }, { signature: 'deadbeef' });
  check('webhook à signature invalide refusé', bad.status === 403, bad);
  const b = await register('b', run);
  const steal = await call('POST', `/organizations/${b.org}/subscription/confirm-notchpay`, { txRef: co.data.txRef }, b.token);
  check('paiement d’une autre organisation refusé', steal.status === 404, steal);

  const low = await call('POST', `${base}/checkout`, { plan: 'PME_PRO', provider: 'NOTCHPAY' }, a.token);
  await fake(`/_test/complete/${low.data.paymentUrl.split('/').pop()}?amount=100`);
  const lowRes = await call('POST', `${base}/confirm-notchpay`, { txRef: low.data.txRef }, a.token);
  sub = (await call('GET', base, undefined, a.token)).data;
  check('montant payé insuffisant : refusé', lowRes.data.success === false && sub.plan.code === 'PME_STARTER', lowRes.data);

  // ---- Renouvellement anticipé ----
  const renew = await call('POST', `${base}/checkout`, { plan: 'PME_STARTER', provider: 'NOTCHPAY' }, a.token);
  await fake(`/_test/complete/${renew.data.paymentUrl.split('/').pop()}`);
  await call('POST', `${base}/confirm-notchpay`, { txRef: renew.data.txRef }, a.token);
  sub = (await call('GET', base, undefined, a.token)).data;
  const months = (new Date(sub.currentPeriodEnd).getMonth() - end1.getMonth() + 12) % 12;
  check('renouvellement anticipé : un mois ajouté à la période en cours', months === 1, sub.currentPeriodEnd);

  // ---- Échec ----
  const fail = await call('POST', `${base}/checkout`, { plan: 'PME_PRO', provider: 'NOTCHPAY' }, a.token);
  await fake(`/_test/fail/${fail.data.paymentUrl.split('/').pop()}`);
  const failRes = await call('POST', `${base}/confirm-notchpay`, { txRef: fail.data.txRef }, a.token);
  check('paiement échoué : signalé, abonnement inchangé', failRes.data.success === false, failRes.data);

  // ---- Activation par le seul webhook (client qui ferme la page) ----
  const bco = await call('POST', `/organizations/${b.org}/subscription/checkout`, { plan: 'PME_PRO' }, b.token);
  const bRef = bco.data.paymentUrl.split('/').pop();
  await fake(`/_test/complete/${bRef}`);
  const hook = await webhook({ reference: bRef, merchant_reference: bco.data.txRef, status: 'complete' });
  const bsub = (await call('GET', `/organizations/${b.org}/subscription`, undefined, b.token)).data;
  check('activation par le webhook seul', hook.status === 200 && bsub.status === 'ACTIVE' && bsub.plan.code === 'PME_PRO', { hook, bsub });

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} réussis`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERREUR', e); process.exit(2); });
