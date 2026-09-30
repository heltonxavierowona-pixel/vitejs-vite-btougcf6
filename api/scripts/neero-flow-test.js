/**
 * Test de bout en bout de l'encaissement Neero, SANS compte Neero.
 *
 * Prérequis :
 *   1. Faux Neero :          python3 scripts/fake-neero-server.py
 *   2. Faux e-mail :         python3 scripts/fake-smtp-server.py
 *   3. API démarrée avec :
 *        PAYMENT_MODE=online  NEERO_BASE_URL=http://localhost:12114
 *        NEERO_SECRET_KEY=sk_test_fake  NEERO_WEBHOOK_SECRET=whsec_test
 *        NEERO_OPERATOR_ID=op_numera  NEERO_DESTINATION_PAYMENT_METHOD_ID=pm_numera
 *        SMTP_HOST=localhost SMTP_PORT=2525 SMTP_USER=test SMTP_PASS=test
 *        CRON_SECRET=cron-secret
 *   4. DATABASE_URL=… API_URL=http://localhost:3000/api node scripts/neero-flow-test.js
 */
const { createHmac } = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const API = process.env.API_URL ?? 'http://localhost:3000/api';
const FAKE = process.env.FAKE_NEERO_URL ?? 'http://localhost:12114';
const SECRET = process.env.NEERO_WEBHOOK_SECRET ?? 'whsec_test';
const OPERATOR = process.env.NEERO_OPERATOR_ID ?? 'op_numera';
const CRON = { Authorization: `Bearer ${process.env.CRON_SECRET ?? 'cron-secret'}` };
const MAILS = path.join(__dirname, '.mails');

const results = [];
const check = (name, cond, info = '') => {
  results.push(cond);
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond ? '' : `  -> ${JSON.stringify(info)}`}`);
};

async function call(method, urlPath, body, token, headers = {}) {
  const res = await fetch(API + urlPath, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

const sql = (query) => execFileSync('psql', [process.env.DATABASE_URL, '-tAc', query]).toString().trim();
const setStatus = (id, status, amount) =>
  fetch(`${FAKE}/__set/${id}/${status}${amount ? `?amount=${amount}` : ''}`, { method: 'POST' }).then((r) => r.json());
const fakeIntent = (id) => fetch(`${FAKE}/__intent/${id}`).then((r) => r.json());

let n = 0;
async function webhook(intentId, status, { secret = SECRET, operatorId = OPERATOR, eventId, timestamp } = {}) {
  const body = JSON.stringify({
    id: eventId ?? `evt_${Date.now()}_${n++}`,
    type: 'transactionIntent.statusUpdated',
    createdAt: new Date().toISOString(),
    data: { object: { id: intentId, status } },
    operatorDetails: { operatorId, merchantKey: 'mk_test' },
  });
  const ts = timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha512', secret).update(ts + body).digest('hex');
  const res = await fetch(`${API}/webhooks/neero`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-TIMESTAMP': ts, 'X-SIGNATURE': signature },
    body,
  });
  return { status: res.status, data: await res.json().catch(() => null), body };
}

/** Décode le quoted-printable du corps et du sujet (accents, tirets). */
function decodeMail(raw) {
  const qp = (text) =>
    Buffer.from(
      text.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))),
      'latin1',
    ).toString('utf8');
  return qp(raw.replace(/=\?UTF-8\?Q\?(.*?)\?=/gi, (_, word) => word.replace(/_/g, ' ')));
}

function mailsTo(email) {
  if (!fs.existsSync(MAILS)) return [];
  return fs
    .readdirSync(MAILS)
    .map((f) => decodeMail(fs.readFileSync(path.join(MAILS, f), 'utf8')))
    .filter((m) => m.includes(email));
}

async function register(run, tag) {
  const email = `neero-${tag}-${run}@test.cm`;
  const r = await call('POST', '/auth/register', {
    email, password: 'motdepasse123', firstName: 'Awa', lastName: 'Nkeng', phone: '656566762',
    organizationName: `Neero ${tag} ${run}`, organizationType: 'ENTREPRISE',
    entity: { niu: `NN${tag}${run}`.toUpperCase().slice(0, 30), legalName: 'AWA SARL', legalForm: 'SARL', taxRegime: 'RSI',
      address: 'Bastos', city: 'Yaoundé', phone: '656566762' },
  });
  return { email, token: r.data.accessToken, org: r.data.organization?.id, base: `/organizations/${r.data.organization?.id}/subscription` };
}

async function checkout(user, plan = 'PME_STARTER') {
  const r = await call('POST', `${user.base}/checkout`, { plan, provider: 'NEERO' }, user.token);
  const txRef = r.data.txRef;
  const intentId = txRef ? sql(`select "providerTxId" from payments where "txRef"='${txRef}'`) : null;
  return { ...r, txRef, intentId };
}

const paymentStatus = (txRef) => sql(`select status from payments where "txRef"='${txRef}'`);

(async () => {
  fs.rmSync(MAILS, { recursive: true, force: true });
  fs.mkdirSync(MAILS, { recursive: true });
  const run = Date.now().toString(36);

  // --- Souscription ---
  const a = await register(run, 'a');
  const plans = await call('GET', `${a.base}/plans`, undefined, a.token);
  check('Neero proposé en premier', plans.data.providers?.[0] === 'NEERO', plans.data.providers);

  const c1 = await checkout(a);
  check('page de paiement Neero renvoyée', c1.status === 201 && /^http:\/\/localhost:12114\/pay\/ti_/.test(c1.data.paymentUrl ?? ''), c1.data);
  check('paiement « pending » enregistré avec l’identifiant Neero', paymentStatus(c1.txRef) === 'PENDING' && c1.intentId?.startsWith('ti_'), c1.intentId);
  const intent1 = await fakeIntent(c1.intentId);
  check('montant calculé côté serveur (10 000 XAF) et metadata', intent1.amount === 10000 && intent1.currencyCode === 'XAF' && intent1.metadata?.planId === 'PME_STARTER' && intent1.metadata?.customerId === a.org, intent1);

  // --- Retour navigateur avant le webhook : rien n'est activé ---
  const early = await call('POST', `${a.base}/confirm-neero`, { txRef: c1.txRef }, a.token);
  let sub = await call('GET', a.base, undefined, a.token);
  check('retour avant paiement : pas d’activation', early.data.success === false && sub.data.status === 'TRIALING', [early.data, sub.data.status]);

  // --- Webhooks refusés ---
  const bad = await webhook(c1.intentId, 'SUCCESSFUL', { secret: 'mauvais-secret' });
  check('signature invalide → 401', bad.status === 401, bad);
  const old = await webhook(c1.intentId, 'SUCCESSFUL', { timestamp: String(Math.floor(Date.now() / 1000) - 3600) });
  check('webhook trop ancien → 401', old.status === 401, old);
  const invalidLogged = sql(`select count(*) from webhook_events where provider='NEERO' and "signatureValid"=false`);
  check('refus journalisés', Number(invalidLogged) >= 2, invalidLogged);

  // Webhook qui ment : il annonce « payé » alors que Neero dit « en attente ».
  const liar = await webhook(c1.intentId, 'SUCCESSFUL');
  sub = await call('GET', a.base, undefined, a.token);
  check('statut revérifié chez Neero (webhook seul insuffisant)', liar.status === 200 && sub.data.status === 'TRIALING', [liar.data, sub.data.status]);

  // --- Paiement réussi ---
  await setStatus(c1.intentId, 'SUCCESSFUL');
  const ok = await webhook(c1.intentId, 'SUCCESSFUL', { eventId: `evt_ok_${run}` });
  sub = await call('GET', a.base, undefined, a.token);
  const days = Math.round((new Date(sub.data.currentPeriodEnd) - Date.now()) / 86_400_000);
  check('paiement réussi → abonnement actif un mois', ok.status === 200 && sub.data.status === 'ACTIVE' && sub.data.provider === 'NEERO' && days >= 27 && days <= 32, [ok.data, sub.data.status, days]);
  check('paiement « SUCCEEDED » et payé', paymentStatus(c1.txRef) === 'SUCCEEDED', paymentStatus(c1.txRef));
  const again = await webhook(c1.intentId, 'SUCCESSFUL', { eventId: `evt_ok_${run}` });
  const endAfter = (await call('GET', a.base, undefined, a.token)).data.currentPeriodEnd;
  check('même webhook deux fois → traité une seule fois', again.data?.duplicate === true && endAfter === sub.data.currentPeriodEnd, again.data);
  const retour = await call('POST', `${a.base}/confirm-neero`, { txRef: c1.txRef }, a.token);
  check('page de retour après paiement : confirmé sans double prolongation', retour.data.success === true && retour.data.alreadyProcessed === true, retour.data);
  await new Promise((r) => setTimeout(r, 500));
  check('e-mail de confirmation au client', mailsTo(a.email).some((m) => /paiement confirm/i.test(m)), mailsTo(a.email).length);

  // --- Autre opérateur ---
  const b = await register(run, 'b');
  const cb = await checkout(b);
  await setStatus(cb.intentId, 'SUCCESSFUL');
  const foreign = await webhook(cb.intentId, 'SUCCESSFUL', { operatorId: 'op_autre_projet' });
  check('webhook d’un autre opérateur ignoré', foreign.data?.ignored === true && paymentStatus(cb.txRef) === 'PENDING', foreign.data);

  // --- Montant falsifié ---
  const c2 = await checkout(b);
  await setStatus(c2.intentId, 'SUCCESSFUL', 100);
  await webhook(c2.intentId, 'SUCCESSFUL');
  sub = await call('GET', b.base, undefined, b.token);
  check('montant inférieur → refusé, paiement clos', sub.data.status === 'TRIALING' && paymentStatus(c2.txRef) === 'FAILED', [sub.data.status, paymentStatus(c2.txRef)]);

  // --- Échec, expiration, annulation ---
  const c3 = await checkout(b);
  await setStatus(c3.intentId, 'FAILED');
  await webhook(c3.intentId, 'FAILED');
  check('paiement échoué → FAILED', paymentStatus(c3.txRef) === 'FAILED', paymentStatus(c3.txRef));
  const c4 = await checkout(b);
  await setStatus(c4.intentId, 'EXPIRED');
  await webhook(c4.intentId, 'EXPIRED');
  check('paiement expiré → EXPIRED', paymentStatus(c4.txRef) === 'EXPIRED', paymentStatus(c4.txRef));
  const c5 = await checkout(b);
  await setStatus(c5.intentId, 'CANCELED');
  await webhook(c5.intentId, 'CANCELED');
  check('paiement annulé → CANCELED', paymentStatus(c5.txRef) === 'CANCELED', paymentStatus(c5.txRef));
  await new Promise((r) => setTimeout(r, 500));
  check('e-mail d’échec au client', mailsTo(b.email).some((m) => /non abouti/i.test(m)), mailsTo(b.email).length);

  // --- Webhook perdu : rattrapage ---
  const d = await register(run, 'd');
  const c6 = await checkout(d);
  await setStatus(c6.intentId, 'SUCCESSFUL');
  sql(`update payments set "createdAt" = now() - interval '11 minutes' where "txRef"='${c6.txRef}'`);
  const noAuth = await call('GET', '/cron/payments-reconcile');
  check('rattrapage protégé par CRON_SECRET', noAuth.status === 401, noAuth);
  const rec = await call('GET', '/cron/payments-reconcile', undefined, undefined, CRON);
  sub = await call('GET', d.base, undefined, d.token);
  check('webhook perdu → rattrapé par la tâche planifiée', rec.status === 200 && sub.data.status === 'ACTIVE', [rec.data, sub.data.status]);

  // --- Jamais payé : expiration et annulation chez Neero ---
  const c7 = await checkout(b);
  sql(`update payments set "createdAt" = now() - interval '25 hours' where "txRef"='${c7.txRef}'`);
  await call('GET', '/cron/payments-reconcile', undefined, undefined, CRON);
  const i7 = await fakeIntent(c7.intentId);
  check('pending trop ancien → EXPIRED et annulé chez Neero', paymentStatus(c7.txRef) === 'EXPIRED' && i7.canceled === true, [paymentStatus(c7.txRef), i7]);

  // --- Renouvellement J-5 ---
  sql(`update subscriptions set "currentPeriodEnd" = now() + interval '4 days 12 hours' where "organizationId"='${a.org}'`);
  await call('GET', '/cron/dunning', undefined, undefined, CRON);
  const renewal = sql(`select "txRef" from payments where "organizationId"='${a.org}' and "providerRaw"->>'renewalStage'='J-5'`);
  check('J-5 : lien de renouvellement créé', !!renewal, renewal);
  await new Promise((r) => setTimeout(r, 500));
  check('J-5 : lien envoyé par e-mail', mailsTo(a.email).some((m) => /arrive à échéance/.test(m) && /localhost:12114\/pay/.test(m)), '');
  await call('GET', '/cron/dunning', undefined, undefined, CRON);
  const renewals = sql(`select count(*) from payments where "organizationId"='${a.org}' and "providerRaw"->>'renewalStage'='J-5'`);
  check('J-5 : pas de doublon au passage suivant', renewals === '1', renewals);

  // --- Échéance, grâce, suspension, réactivation ---
  sql(`update subscriptions set "currentPeriodEnd" = now() - interval '1 hour' where "organizationId"='${a.org}'`);
  await call('GET', '/cron/dunning', undefined, undefined, CRON);
  sub = await call('GET', a.base, undefined, a.token);
  check('échéance sans paiement → période de grâce', sub.data.status === 'PAST_DUE' && !!sub.data.gracePeriodEnd && sub.data.canWrite === true, [sub.data.status, sub.data.gracePeriodEnd]);
  sql(`update subscriptions set "gracePeriodEnd" = now() - interval '1 hour' where "organizationId"='${a.org}'`);
  await call('GET', '/cron/dunning', undefined, undefined, CRON);
  sub = await call('GET', a.base, undefined, a.token);
  check('grâce écoulée → suspendu, saisie bloquée', sub.data.status === 'SUSPENDED' && sub.data.canWrite === false, sub.data.status);
  await new Promise((r) => setTimeout(r, 500));
  check('e-mail de suspension', mailsTo(a.email).some((m) => /abonnement suspendu/i.test(m)), '');

  const renewalIntent = sql(`select "providerTxId" from payments where "txRef"='${renewal}'`);
  await setStatus(renewalIntent, 'SUCCESSFUL');
  await webhook(renewalIntent, 'SUCCESSFUL');
  sub = await call('GET', a.base, undefined, a.token);
  check('paiement reçu → réactivation immédiate', sub.data.status === 'ACTIVE' && sub.data.canWrite === true, sub.data.status);

  const ok2 = results.filter(Boolean).length;
  console.log(`\n${ok2}/${results.length} vérifications réussies`);
  process.exit(ok2 === results.length ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
