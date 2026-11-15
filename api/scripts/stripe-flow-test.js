/**
 * Test de bout en bout du paiement par carte (Stripe), SANS
 * toucher à un vrai compte Stripe.
 *
 * Prérequis :
 *   1. Faux serveur Stripe :   python3 scripts/fake-stripe-server.py
 *   2. API démarrée avec :
 *        STRIPE_SECRET_KEY=sk_test_fake  STRIPE_WEBHOOK_SECRET=whsec_test
 *        STRIPE_API_HOST=localhost  STRIPE_API_PORT=12111  STRIPE_API_PROTOCOL=http
 *        NODE_ENV=development (le faux serveur est refusé en production)
 *   3. API_URL=http://localhost:3000/api WEBHOOK_SECRET=whsec_test node scripts/stripe-flow-test.js
 *
 * Les événements de webhook sont signés comme le ferait Stripe.
 */
const Stripe = require('stripe');

const API = process.env.API_URL ?? 'http://localhost:3000/api';
const FAKE = process.env.FAKE_STRIPE_URL ?? 'http://localhost:12111';
const SECRET = process.env.WEBHOOK_SECRET ?? 'whsec_test';
const stripe = new Stripe('sk_test_signing_only');

const results = [];
const check = (name, cond, info = '') => {
  results.push(cond);
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond ? '' : `  -> ${JSON.stringify(info)}`}`);
};

async function call(method, path, body, token) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function fake(path) {
  const res = await fetch(FAKE + path, { method: path.startsWith('/_test/state') ? 'GET' : 'POST' });
  return res.json();
}

let eventCounter = 0;
async function webhook(type, object, { id, signature } = {}) {
  const payload = JSON.stringify({
    id: id ?? `evt_test_${Date.now()}_${eventCounter++}`,
    object: 'event',
    type,
    api_version: '2026-08-26.dahlia',
    created: Math.floor(Date.now() / 1000),
    data: { object },
  });
  const header = signature ?? stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  const res = await fetch(`${API}/webhooks/stripe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header },
    body: payload,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

function invoice(subId, billingReason, amount, id) {
  return {
    id: id ?? `in_${Date.now()}_${eventCounter++}`,
    object: 'invoice',
    billing_reason: billingReason,
    amount_paid: amount,
    currency: 'xaf',
    parent: {
      type: 'subscription_details',
      subscription_details: { subscription: subId, metadata: {} },
    },
  };
}

(async () => {
  const run = Math.random().toString(36).slice(2, 8);
  const reg = await call('POST', '/auth/register', {
    email: `stripe-${run}@test.cm`, password: 'motdepasse123', firstName: 'Awa', lastName: 'Nkeng',
    organizationName: 'Awa Services', organizationType: 'ENTREPRISE',
    entity: { niu: `S${run.toUpperCase()}01`, legalName: 'AWA SARL', legalForm: 'SARL', taxRegime: 'RSI',
      address: 'Akwa', city: 'Douala', phone: '677000000' },
  });
  check('inscription', reg.status === 201, reg.data);
  const token = reg.data.accessToken;
  const org = reg.data.organization.id;
  const base = `/organizations/${org}/subscription`;

  const plans = await call('GET', `${base}/plans`, undefined, token);
  check('Stripe proposé comme moyen de paiement', plans.data.providers?.includes('STRIPE'), plans.data);

  // ---- 1. Checkout ----
  const co = await call('POST', `${base}/checkout`, { plan: 'PME_STARTER', provider: 'STRIPE' }, token);
  check('session Checkout créée', co.status === 201 && co.data.paymentUrl?.startsWith('https://checkout.stripe.test/'), co.data);
  const sessionId = co.data.paymentUrl.split('/').pop();
  const state0 = await fake('/_test/state');
  const created = state0.calls.find((c) => c[1] === '/v1/checkout/sessions' && c[2]['metadata[txRef]'] === co.data.txRef);
  check('montant envoyé en XAF sans décimale (10 000 FCFA → 10000)',
    created && created[2]['line_items[0][price_data][unit_amount]'] === '10000' && created[2]['line_items[0][price_data][currency]'] === 'xaf', created);
  check('abonnement mensuel', created?.[2]['line_items[0][price_data][recurring][interval]'] === 'month');

  const early = await call('POST', `${base}/confirm-stripe`, { sessionId }, token);
  check('retour avant paiement : rien n’est activé', early.status === 200 && early.data.success === false, early.data);

  // ---- 2. Paiement + activation ----
  const paid = await fake(`/_test/pay/${sessionId}`);
  const confirm = await call('POST', `${base}/confirm-stripe`, { sessionId }, token);
  check('retour navigateur : abonnement activé', confirm.data.success === true, confirm.data);
  let sub = (await call('GET', base, undefined, token)).data;
  check('statut ACTIVE, formule PME Essentiel, payé par carte',
    sub.status === 'ACTIVE' && sub.plan.code === 'PME_STARTER' && sub.provider === 'STRIPE' && sub.stripeSubscriptionId === paid.subscription, sub);
  const firstEnd = sub.currentPeriodEnd;

  const dupe = await webhook('checkout.session.completed', paid);
  sub = (await call('GET', base, undefined, token)).data;
  check('webhook après le retour navigateur : aucune double activation', dupe.status === 200 && sub.currentPeriodEnd === firstEnd && sub.payments.length === 1, { dupe, payments: sub.payments.length });

  // ---- Sécurité ----
  const other = await call('POST', '/auth/register', {
    email: `stripe2-${run}@test.cm`, password: 'motdepasse123', firstName: 'X', lastName: 'Y',
    organizationName: 'Autre cabinet', organizationType: 'CABINET',
  });
  const steal = await call('POST', `/organizations/${other.data.organization.id}/subscription/confirm-stripe`, { sessionId }, other.data.accessToken);
  check('session d’une autre organisation refusée', steal.status === 404, steal);
  const bad = await webhook('invoice.paid', invoice(paid.subscription, 'subscription_cycle', 10000), { signature: 't=1,v1=deadbeef' });
  check('webhook à signature invalide refusé (400)', bad.status === 400, bad);

  // ---- 3. Renouvellement mensuel ----
  await fake(`/_test/renew/${paid.subscription}`);
  const renewal = invoice(paid.subscription, 'subscription_cycle', 10000);
  const evtId = `evt_renew_${run}`;
  const r1 = await webhook('invoice.paid', renewal, { id: evtId });
  sub = (await call('GET', base, undefined, token)).data;
  check('renouvellement : période prolongée d’un mois', r1.status === 200 && new Date(sub.currentPeriodEnd) - new Date(firstEnd) === 30 * 86400000, { r1, end: sub.currentPeriodEnd });
  check('renouvellement : paiement enregistré (10 000 FCFA)', sub.payments.length === 2 && sub.payments.some((p) => p.amount === 1000000), sub.payments);
  const r2 = await webhook('invoice.paid', renewal, { id: evtId });
  sub = (await call('GET', base, undefined, token)).data;
  check('événement réémis par Stripe : ignoré', r2.data?.duplicate === true && sub.payments.length === 2, r2);

  // ---- 4. Impayé puis régularisation ----
  await webhook('invoice.payment_failed', invoice(paid.subscription, 'subscription_cycle', 0));
  sub = (await call('GET', base, undefined, token)).data;
  check('échec de prélèvement : impayé avec période de grâce, saisie toujours possible', sub.status === 'PAST_DUE' && sub.gracePeriodEnd && sub.canWrite === true, sub);
  const subObj = (await fetch(`${FAKE}/v1/subscriptions/${paid.subscription}`).then((r) => r.json()));
  await webhook('customer.subscription.updated', subObj);
  sub = (await call('GET', base, undefined, token)).data;
  check('carte régularisée : retour à ACTIVE', sub.status === 'ACTIVE' && !sub.gracePeriodEnd, sub);

  // ---- 5. Résiliation programmée et reprise ----
  const cancel = await call('POST', `${base}/cancel`, undefined, token);
  check('résiliation programmée en fin de période (accès maintenu)', cancel.status === 200 && cancel.data.cancelAtPeriodEnd === true && cancel.data.status === 'ACTIVE', cancel.data);
  const resume = await call('POST', `${base}/resume`, undefined, token);
  check('reprise de l’abonnement', resume.status === 200 && resume.data.cancelAtPeriodEnd === false, resume.data);

  // ---- Garde-fous ----
  const free = await call('POST', `${base}/checkout`, { plan: 'FREE' }, token);
  check('passage au gratuit refusé tant que la carte est débitée', free.status === 400, free.data);
  const same = await call('POST', `${base}/checkout`, { plan: 'PME_STARTER', provider: 'STRIPE' }, token);
  check('re-souscription de la même formule refusée', same.status === 400, same.data);
  const portal = await call('POST', `${base}/portal`, undefined, token);
  check('portail client Stripe', portal.status === 200 && portal.data.url.includes(paid.customer), portal.data);

  // ---- 6. Changement de formule ----
  const up = await call('POST', `${base}/checkout`, { plan: 'PME_PRO', provider: 'STRIPE' }, token);
  const upSession = up.data.paymentUrl.split('/').pop();
  const state1 = await fake('/_test/state');
  const upCall = state1.calls.find((c) => c[1] === '/v1/checkout/sessions' && c[2]['metadata[txRef]'] === up.data.txRef);
  check('changement de formule : même client Stripe réutilisé', upCall?.[2].customer === paid.customer, upCall?.[2]);
  const upPaid = await fake(`/_test/pay/${upSession}`);
  await webhook('checkout.session.completed', upPaid);
  sub = (await call('GET', base, undefined, token)).data;
  check('nouvelle formule PME Pro active', sub.plan.code === 'PME_PRO' && sub.stripeSubscriptionId === upPaid.subscription, sub);
  const state2 = await fake('/_test/state');
  check('ancien abonnement arrêté au prorata', state2.calls.some((c) => c[0] === 'DELETE' && c[1] === `/v1/subscriptions/${paid.subscription}` && c[2].prorate === 'true'), state2.calls.filter((c) => c[0] === 'DELETE'));
  const oldDeleted = await fetch(`${FAKE}/v1/subscriptions/${paid.subscription}`).then((r) => r.json());
  await webhook('customer.subscription.deleted', oldDeleted);
  sub = (await call('GET', base, undefined, token)).data;
  check('suppression de l’ancien abonnement sans effet sur le nouveau', sub.status === 'ACTIVE' && sub.plan.code === 'PME_PRO', sub);

  // ---- 7. Fin de l'abonnement ----
  await fake(`/_test/pay/nonexistent`).catch(() => null);
  const current = await fetch(`${FAKE}/v1/subscriptions/${upPaid.subscription}`).then((r) => r.json());
  await webhook('customer.subscription.deleted', { ...current, status: 'canceled', ended_at: Math.floor(Date.now() / 1000) - 60 });
  sub = (await call('GET', base, undefined, token)).data;
  check('abonnement terminé : saisie bloquée, lecture conservée', sub.status === 'CANCELLED' && sub.canWrite === false && !sub.stripeSubscriptionId, sub);
  const entityId = reg.data.entityId;
  const read = await call('GET', `/entities/${entityId}/invoices`, undefined, token);
  const write = await call('POST', `/entities/${entityId}/customers`, { name: 'Client' }, token);
  check('lecture autorisée, écriture refusée', read.status === 200 && write.status === 403, { read: read.status, write: write.status });
  const again = await call('POST', `${base}/checkout`, { plan: 'PME_STARTER', provider: 'STRIPE' }, token);
  check('réabonnement possible après la fin', again.status === 201, again.data);

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} réussis`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error('ERREUR', error);
  process.exit(2);
});
