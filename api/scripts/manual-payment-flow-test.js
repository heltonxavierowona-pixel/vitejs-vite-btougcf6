/**
 * Test de bout en bout du paiement manuel par lien Neero.
 *
 * Prérequis :
 *   1. Faux Telegram :  python3 scripts/fake-telegram-server.py
 *   2. API démarrée avec :
 *        NODE_ENV=development  PLATFORM_ADMIN_EMAILS=admin@numera.test
 *        TELEGRAM_BOT_TOKEN=test-token  TELEGRAM_API_URL=http://localhost:12113
 *        CRON_SECRET=cron-secret   (PAYMENT_MODE absent = paiement manuel)
 *   3. DATABASE_URL=… API_URL=http://localhost:3000/api node scripts/manual-payment-flow-test.js
 *      (DATABASE_URL sert à avancer une échéance pour tester le renouvellement)
 */
const { execFileSync } = require('child_process');

const API = process.env.API_URL ?? 'http://localhost:3000/api';
const TELEGRAM = process.env.FAKE_TELEGRAM_URL ?? 'http://localhost:12113';
const CRON_SECRET = process.env.CRON_SECRET ?? 'cron-secret';

const results = [];
const check = (name, cond, info = '') => {
  results.push(cond);
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond ? '' : `  -> ${JSON.stringify(info)}`}`);
};

async function call(method, path, body, token, headers = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

const telegram = () => fetch(`${TELEGRAM}/__messages`).then((r) => r.json());
const lastTelegram = async () => (await telegram()).slice(-1)[0]?.text ?? '';

function sql(query) {
  return execFileSync('psql', [process.env.DATABASE_URL, '-tAc', query]).toString().trim();
}

async function register(email, orgName, niu) {
  const r = await call('POST', '/auth/register', {
    email, password: 'motdepasse123', firstName: 'Awa', lastName: 'Nkeng',
    phone: '656566762', organizationName: orgName, organizationType: 'ENTREPRISE',
    entity: { niu, legalName: `${orgName} SARL`, legalForm: 'SARL', taxRegime: 'RSI',
      address: 'Bastos', city: 'Yaoundé', phone: '656566762' },
  });
  return { token: r.data.accessToken, org: r.data.organization?.id, user: r.data.user, status: r.status };
}

(async () => {
  const run = Date.now().toString(36);
  const admin = await register('admin@numera.test', 'Numera', `NADM${run}`.toUpperCase());
  const adminToken = admin.token ?? (await call('POST', '/auth/login', { email: 'admin@numera.test', password: 'motdepasse123' })).data.accessToken;
  const client = await register(`client-${run}@test.cm`, `Boulangerie ${run}`, `NCLI${run}`.toUpperCase());
  const other = await register(`autre-${run}@test.cm`, `Garage ${run}`, `NOTH${run}`.toUpperCase());
  check('inscriptions', client.status === 201 && other.status === 201, [client.status, other.status]);

  // --- Rôles ---
  const meAdmin = await call('GET', '/auth/me', undefined, adminToken);
  const meClient = await call('GET', '/auth/me', undefined, client.token);
  check('administrateur reconnu', meAdmin.data.isPlatformAdmin === true, meAdmin.data);
  check('client non administrateur', meClient.data.isPlatformAdmin === false, meClient.data);
  const forbidden = await call('GET', '/admin/payment-requests', undefined, client.token);
  check('écran admin refusé au client (403)', forbidden.status === 403, forbidden);

  // Conversation Telegram à relier avant toute notification.
  const status = await call('GET', '/admin/notifications', undefined, adminToken);
  check('état des notifications', status.data.telegramBot === true && status.data.email === false, status.data);
  const detect = await call('POST', '/admin/notifications/telegram/detect', undefined, adminToken);
  check('conversation Telegram reliée', detect.status === 200 && detect.data.chatId === '424242', detect);

  const base = `/organizations/${client.org}/subscription`;
  const plans = await call('GET', `${base}/plans`, undefined, client.token);
  check('mode manuel, aucun paiement en ligne', plans.data.paymentMode === 'manual' && plans.data.providers.length === 0, plans.data);

  // --- 1. Demande ---
  const before = (await telegram()).length;
  const req = await call('POST', `${base}/checkout`, { plan: 'PME_PRO' }, client.token);
  check('demande créée sans redirection', req.status === 201 && req.data.paymentUrl === null && req.data.paymentRequest.status === 'AWAITING_LINK', req);
  check('message « quelques heures » au client', /quelques heures/.test(req.data.message), req.data.message);
  const tg1 = await lastTelegram();
  check('Telegram : nouvelle demande', (await telegram()).length === before + 1 && tg1.includes('Nouvelle demande'), tg1);
  check('Telegram : client, projet, offre, montant', tg1.includes('Awa Nkeng') && tg1.includes(`Boulangerie ${run}`) && tg1.includes('Offre') && /FCFA/.test(tg1), tg1);

  const again = await call('POST', `${base}/checkout`, { plan: 'PME_PRO' }, client.token);
  check('double clic : même demande', again.data.paymentRequest?.id === req.data.paymentRequest.id, again.data);
  const change = await call('POST', `${base}/checkout`, { plan: 'PME_STARTER' }, client.token);
  check('changement de formule avant le lien', change.data.paymentRequest?.id === req.data.paymentRequest.id && change.data.paymentRequest.plan === 'PME_STARTER', change.data);
  const openCount = sql(`select count(*) from payment_requests where "organizationId"='${client.org}'`);
  check('une seule demande en base', openCount === '1', openCount);

  let current = await call('GET', base, undefined, client.token);
  check('abonnement : en attente de paiement', current.data.paymentRequest?.status === 'AWAITING_LINK' && current.data.status === 'TRIALING', current.data);

  const early = await call('POST', `${base}/payment-request/reference`, { transactionRef: 'ABC12345' }, client.token);
  check('référence refusée avant le lien', early.status === 400, early);

  // --- 2. Lien Neero ---
  const list = await call('GET', '/admin/payment-requests', undefined, adminToken);
  const item = list.data.find?.((r) => r.id === req.data.paymentRequest.id);
  check('demande visible par l’admin', !!item && item.requester?.name === 'Awa Nkeng' && item.planLabel, list.data);

  const badLink = await call('POST', `/admin/payment-requests/${item.id}/link`, { paymentLink: 'http://neero.test/pay' }, adminToken);
  check('lien non https refusé', badLink.status === 400, badLink);
  const link = await call('POST', `/admin/payment-requests/${item.id}/link`, { paymentLink: 'https://pay.neero.test/l/abc123' }, adminToken);
  check('lien envoyé', link.status === 200 && link.data.emailed === false, link);
  check('lien WhatsApp vers le client', /^https:\/\/wa\.me\/237656566762\?text=/.test(link.data.whatsappUrl ?? '') && decodeURIComponent(link.data.whatsappUrl).includes('https://pay.neero.test/l/abc123'), link.data);

  const locked = await call('POST', `${base}/checkout`, { plan: 'PME_PRO' }, client.token);
  check('autre formule refusée une fois le lien envoyé (409)', locked.status === 409, locked);

  current = await call('GET', base, undefined, client.token);
  check('le client voit son lien', current.data.paymentRequest?.status === 'LINK_SENT' && current.data.paymentRequest.paymentLink === 'https://pay.neero.test/l/abc123', current.data.paymentRequest);

  // --- 3. Référence ---
  const invalid = await call('POST', `${base}/payment-request/reference`, { transactionRef: '<script>' }, client.token);
  check('référence invalide refusée', invalid.status === 400, invalid);
  const ref1 = await call('POST', `${base}/payment-request/reference`, { transactionRef: '  neero  111222 ' }, client.token);
  check('référence enregistrée et normalisée', ref1.status === 200 && ref1.data.paymentRequest.transactionRef === 'NEERO 111222' && ref1.data.paymentRequest.status === 'REFERENCE_SUBMITTED', ref1);
  const tg2 = await lastTelegram();
  check('Telegram : paiement à vérifier', tg2.includes('Paiement à vérifier') && tg2.includes('NEERO 111222'), tg2);

  const noCancel = await call('POST', `${base}/payment-request/cancel`, undefined, client.token);
  check('annulation impossible pendant la vérification', noCancel.status === 400, noCancel);

  const reject = await call('POST', `/admin/payment-requests/${item.id}/reject`, { reason: 'Aucune transaction trouvée dans Neero.' }, adminToken);
  check('référence refusée par l’admin', reject.status === 200, reject);
  current = await call('GET', base, undefined, client.token);
  check('le client voit le motif et peut corriger', current.data.paymentRequest?.status === 'LINK_SENT' && /Aucune transaction/.test(current.data.paymentRequest.rejectionReason), current.data.paymentRequest);

  const ref2 = await call('POST', `${base}/payment-request/reference`, { transactionRef: 'TX-998877' }, client.token);
  check('nouvelle référence', ref2.data.paymentRequest?.transactionRef === 'TX-998877', ref2);

  // --- 4. Validation ---
  const validate = await call('POST', `/admin/payment-requests/${item.id}/validate`, {}, adminToken);
  check('paiement validé', validate.status === 200 && validate.data.subscription?.status === 'ACTIVE' && validate.data.subscription.plan === 'PME_STARTER', validate);
  const twice = await call('POST', `/admin/payment-requests/${item.id}/validate`, {}, adminToken);
  check('double validation refusée', twice.status === 400 || twice.status === 409, twice);

  current = await call('GET', base, undefined, client.token);
  const end = new Date(current.data.currentPeriodEnd);
  const days = Math.round((end - Date.now()) / 86_400_000);
  check('accès actif pour un mois', current.data.status === 'ACTIVE' && current.data.provider === 'MANUAL' && days >= 27 && days <= 32 && current.data.canWrite, { status: current.data.status, days });
  check('plus de demande en cours', current.data.paymentRequest === null, current.data.paymentRequest);
  check('paiement dans l’historique', current.data.payments?.[0]?.provider === 'MANUAL' && current.data.payments[0].status === 'SUCCEEDED', current.data.payments);
  const audit = sql(`select count(*) from audit_logs where "targetType"='PaymentRequest' and "targetId"='${item.id}'`);
  check('validation tracée au journal d’audit', audit === '1', audit);

  // --- Une référence ne sert qu'une fois ---
  const otherBase = `/organizations/${other.org}/subscription`;
  const otherReq = await call('POST', `${otherBase}/checkout`, { plan: 'PME_STARTER' }, other.token);
  await call('POST', `/admin/payment-requests/${otherReq.data.paymentRequest.id}/link`, { paymentLink: 'https://pay.neero.test/l/zzz' }, adminToken);
  const reuse = await call('POST', `${otherBase}/payment-request/reference`, { transactionRef: 'tx-998877' }, other.token);
  check('référence déjà utilisée refusée (409)', reuse.status === 409, reuse);
  const adminReuse = await call('POST', `/admin/payment-requests/${otherReq.data.paymentRequest.id}/validate`, { transactionRef: 'TX-998877' }, adminToken);
  check('même contrôle à la validation admin', adminReuse.status === 409, adminReuse);
  const otherCancel = await call('POST', `${otherBase}/payment-request/cancel`, undefined, other.token);
  check('le client peut annuler avant de payer', otherCancel.status === 200, otherCancel);
  const closed = await call('GET', '/admin/payment-requests?scope=closed', undefined, adminToken);
  check('historique admin', closed.data.some((r) => r.status === 'VALIDATED') && closed.data.some((r) => r.status === 'CANCELLED'), closed.data.map((r) => r.status));

  // --- 5. Renouvellement ---
  sql(`update subscriptions set "currentPeriodEnd" = now() + interval '2 days' where "organizationId"='${client.org}'`);
  const unauthorized = await call('GET', '/cron/dunning');
  check('relances protégées par CRON_SECRET', unauthorized.status === 401, unauthorized);
  const cron = await call('GET', '/cron/dunning', undefined, undefined, { Authorization: `Bearer ${CRON_SECRET}` });
  check('relances exécutées', cron.status === 200, cron);
  current = await call('GET', base, undefined, client.token);
  check('demande de renouvellement créée', current.data.paymentRequest?.kind === 'RENEWAL' && current.data.paymentRequest.status === 'AWAITING_LINK' && current.data.paymentRequest.plan === 'PME_STARTER', current.data.paymentRequest);
  const messages = (await telegram()).map((m) => m.text);
  check('Telegram : abonnements à renouveler', messages.some((t) => t.includes('à renouveler') && t.includes(`Boulangerie ${run}`)), messages.slice(-3));
  await call('GET', '/cron/dunning', undefined, undefined, { Authorization: `Bearer ${CRON_SECRET}` });
  const renewals = sql(`select count(*) from payment_requests where "organizationId"='${client.org}' and kind='RENEWAL'`);
  check('pas de doublon au passage suivant', renewals === '1', renewals);

  // --- Notifications ---
  const test = await call('POST', '/admin/notifications/test', undefined, adminToken);
  check('notification de test', test.status === 200 && (await lastTelegram()).includes('Test de notification'), test);

  const ok = results.filter(Boolean).length;
  console.log(`\n${ok}/${results.length} vérifications réussies`);
  process.exit(ok === results.length ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
