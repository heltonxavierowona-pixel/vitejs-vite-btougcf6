/**
 * Test de bout en bout du tableau de bord administrateur.
 *
 * Prérequis :
 *   1. Faux e-mail : python3 scripts/fake-smtp-server.py
 *   2. API démarrée avec PLATFORM_ADMIN_EMAILS=admin@numera.test
 *      SMTP_HOST=localhost SMTP_PORT=2525 SMTP_USER=test SMTP_PASS=test
 *   3. API_URL=http://localhost:3000/api node scripts/admin-dashboard-test.js
 */
const fs = require('fs');
const path = require('path');

const API = process.env.API_URL ?? 'http://localhost:3000/api';
const MAILS = path.join(__dirname, '.mails');

const results = [];
const check = (name, cond, info = '') => {
  results.push(cond);
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond ? '' : `  -> ${JSON.stringify(info)}`}`);
};

async function call(method, urlPath, body, token, raw = false) {
  const res = await fetch(API + urlPath, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) {
    // Octets bruts : res.text() retirerait le BOM UTF-8.
    const bytes = Buffer.from(await res.arrayBuffer());
    return { status: res.status, data: bytes.toString('utf8'), bom: bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), headers: res.headers };
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

function decodeMail(raw) {
  const qp = (t) => Buffer.from(t.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');
  return qp(raw.replace(/=\?UTF-8\?Q\?(.*?)\?=/gi, (_, w) => w.replace(/_/g, ' ')));
}
const mailsTo = (email) => (fs.existsSync(MAILS) ? fs.readdirSync(MAILS) : [])
  .map((f) => decodeMail(fs.readFileSync(path.join(MAILS, f), 'utf8')))
  .filter((m) => m.includes(email));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function register(email, orgName, niu, type = 'ENTREPRISE') {
  const r = await call('POST', '/auth/register', {
    email, password: 'motdepasse123', firstName: 'Awa', lastName: 'Nkeng', phone: '656566762',
    organizationName: orgName, organizationType: type,
    entity: { niu, legalName: `${orgName} SARL`, legalForm: 'SARL', taxRegime: 'RSI', address: 'Bastos', city: 'Yaoundé', phone: '656566762' },
  });
  return { token: r.data.accessToken, org: r.data.organization?.id, email };
}

(async () => {
  fs.mkdirSync(MAILS, { recursive: true });
  const run = Date.now().toString(36);
  await register('admin@numera.test', 'Numera', `NADM${run}`.toUpperCase());
  const admin = (await call('POST', '/auth/login', { email: 'admin@numera.test', password: 'motdepasse123' })).data.accessToken;

  const a = await register(`dash-a-${run}@test.cm`, `Pâtisserie ${run}`, `NDA${run}`.toUpperCase());
  const b = await register(`dash-b-${run}@test.cm`, `=HYPERLINK("x") ${run}`, `NDB${run}`.toUpperCase());

  // --- Accès ---
  const forbidden = await call('GET', '/admin/stats', undefined, a.token);
  check('tableau de bord refusé à un client (403)', forbidden.status === 403, forbidden.status);

  // --- Chiffres ---
  const before = (await call('GET', '/admin/stats', undefined, admin)).data;
  check('chiffres clés', typeof before.organizations === 'number' && typeof before.mrr === 'number' && before.subscriptions, before);

  // --- Prolongation d'un essai (geste commercial) ---
  let detail = (await call('GET', `/admin/clients/${a.org}`, undefined, admin)).data;
  const trialEnd = new Date(detail.subscription.currentPeriodEnd);
  const extTrial = await call('POST', `/admin/clients/${a.org}/extend`, { days: 7, reason: 'Geste commercial' }, admin);
  check('essai prolongé de 7 jours, reste un essai', extTrial.status === 200 && extTrial.data.status === 'TRIALING'
    && Math.round((new Date(extTrial.data.currentPeriodEnd) - trialEnd) / 86_400_000) === 7, extTrial.data);
  const noDuration = await call('POST', `/admin/clients/${a.org}/extend`, { reason: 'rien' }, admin);
  check('prolongation sans durée refusée', noDuration.status === 400, noDuration.status);

  // --- Changement de formule ---
  const plan = await call('POST', `/admin/clients/${a.org}/plan`, { plan: 'PME_PRO' }, admin);
  check('formule changée, prix mis à jour', plan.status === 200 && plan.data.plan === 'PME_PRO' && plan.data.priceAmount === 2500000, plan.data);
  const wrongAudience = await call('POST', `/admin/clients/${a.org}/plan`, { plan: 'CABINET_S' }, admin);
  check('formule cabinet refusée pour une entreprise', wrongAudience.status === 400, wrongAudience.status);

  // --- Suspension et réactivation ---
  const susp = await call('POST', `/admin/clients/${a.org}/suspend`, { reason: 'Test de suspension' }, admin);
  let sub = (await call('GET', `/organizations/${a.org}/subscription`, undefined, a.token)).data;
  check('compte suspendu : saisie bloquée', susp.status === 200 && sub.status === 'SUSPENDED' && sub.canWrite === false, sub.status);
  const react = await call('POST', `/admin/clients/${a.org}/reactivate`, undefined, admin);
  sub = (await call('GET', `/organizations/${a.org}/subscription`, undefined, a.token)).data;
  check('compte réactivé', react.status === 200 && sub.canWrite === true && sub.status === 'TRIALING', sub.status);

  // --- Paiement hors ligne enregistré ---
  const paid = await call('POST', `/admin/clients/${a.org}/extend`, { months: 1, amount: 25000, reason: 'Paiement en espèces' }, admin);
  detail = (await call('GET', `/admin/clients/${a.org}`, undefined, admin)).data;
  check('paiement en espèces : actif et paiement enregistré', paid.status === 200 && paid.data.status === 'ACTIVE'
    && detail.payments[0]?.amount === 2500000 && detail.payments[0]?.provider === 'MANUAL' && detail.payments[0]?.note === 'Paiement en espèces', detail.payments[0]);

  const after = (await call('GET', '/admin/stats', undefined, admin)).data;
  check('encaissé ce mois-ci augmenté de 25 000 FCFA', after.revenueThisMonth - before.revenueThisMonth === 2500000, [before.revenueThisMonth, after.revenueThisMonth]);
  check('revenu récurrent augmenté (PME Pro actif)', after.mrr - before.mrr === 2500000, [before.mrr, after.mrr]);

  const revenue = (await call('GET', '/admin/revenue?months=12', undefined, admin)).data;
  const now = new Date(Date.now() + 3_600_000);
  const key = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  check('revenus sur 12 mois, mois en cours en dernier', revenue.length === 12 && revenue[11].month === key && revenue[11].amount >= 2500000, revenue.slice(-2));

  // --- Liste, recherche, filtres ---
  const search = (await call('GET', `/admin/clients?search=${encodeURIComponent(`pâtisserie ${run}`)}`, undefined, admin)).data;
  check('recherche par nom (sans tenir compte des majuscules)', search.total === 1 && search.items[0].id === a.org, search.total);
  const byEmail = (await call('GET', `/admin/clients?search=dash-b-${run}`, undefined, admin)).data;
  check('recherche par e-mail du propriétaire', byEmail.total === 1 && byEmail.items[0].id === b.org, byEmail.total);
  const trials = (await call('GET', `/admin/clients?segment=trialing&search=${run}`, undefined, admin)).data;
  check('filtre « en essai »', trials.items.length === 1 && trials.items[0].id === b.org, trials.items.map((i) => i.name));
  const activeSeg = (await call('GET', `/admin/clients?segment=active&search=${run}`, undefined, admin)).data;
  check('filtre « payants »', activeSeg.items.length === 1 && activeSeg.items[0].id === a.org, activeSeg.items.map((i) => i.name));
  const badSeg = await call('GET', '/admin/clients?segment=nimporte', undefined, admin);
  check('filtre inconnu refusé', badSeg.status === 400, badSeg.status);

  // --- Exports ---
  const csv = await call('GET', '/admin/export/clients.csv', undefined, admin, true);
  check('export clients : CSV Excel (BOM, « ; »)', csv.status === 200 && csv.bom && csv.data.replace(/^\uFEFF/, '').startsWith('Client;Type;') && /text\/csv/.test(csv.headers.get('content-type')), csv.data.slice(0, 60));
  check('export clients : formules Excel neutralisées', csv.data.includes(`'=HYPERLINK`) && !/(^|;)"?=HYPERLINK/m.test(csv.data), '');
  const pcsv = await call('GET', '/admin/export/payments.csv', undefined, admin, true);
  check('export paiements', pcsv.status === 200 && pcsv.data.includes('25000') && pcsv.data.includes('Paiement en espèces'), pcsv.data.slice(0, 200));
  const csvForbidden = await call('GET', '/admin/export/clients.csv', undefined, a.token, true);
  check('export refusé à un client', csvForbidden.status === 403, csvForbidden.status);

  // --- E-mails ---
  const one = await call('POST', '/admin/emails', { organizationId: a.org, subject: `Bonjour ${run}`, message: 'Message personnel de test.' }, admin);
  await wait(400);
  check('e-mail à un client', one.status === 200 && one.data.sent === 1 && mailsTo(a.email).some((m) => m.includes(`Bonjour ${run}`)), one.data);
  const preview = (await call('GET', '/admin/emails/recipients?segment=trialing', undefined, admin)).data;
  check('aperçu des destinataires', typeof preview.count === 'number' && preview.count >= 1, preview);
  const shortMsg = await call('POST', '/admin/emails', { segment: 'active', subject: 'ok', message: 'court' }, admin);
  check('message trop court refusé', shortMsg.status === 400, shortMsg.status);

  // --- Relance des essais ---
  const remind = await call('POST', '/admin/trial-reminders', { organizationIds: [b.org] }, admin);
  await wait(400);
  check('relance fin d’essai envoyée', remind.data.sent === 1 && mailsTo(b.email).some((m) => /votre essai/i.test(m) && m.includes('/abonnement')), remind.data);
  const again = await call('POST', '/admin/trial-reminders', { organizationIds: [b.org] }, admin);
  check('pas de nouvelle relance dans les 24 h', again.data.eligible === 0, again.data);
  const notTrial = await call('POST', '/admin/trial-reminders', { organizationIds: [a.org] }, admin);
  check('client payant jamais relancé comme un essai', notTrial.data.eligible === 0, notTrial.data);

  const ok = results.filter(Boolean).length;
  console.log(`\n${ok}/${results.length} vérifications réussies`);
  process.exit(ok === results.length ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
