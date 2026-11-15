/**
 * Test de bout en bout du « mot de passe oublié ».
 *
 * Prérequis :
 *   1. Faux serveur d'e-mail : python3 scripts/fake-smtp-server.py
 *   2. API démarrée avec SMTP_HOST=localhost SMTP_PORT=2525 SMTP_USER=test SMTP_PASS=test
 *   3. API_URL=http://localhost:3000/api node scripts/password-reset-flow-test.js
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

async function call(method, urlPath, body, token) {
  const res = await fetch(API + urlPath, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

/** Dernier e-mail envoyé à cette adresse (attend jusqu'à 5 s). */
async function lastMailTo(email) {
  for (let i = 0; i < 25; i += 1) {
    const files = fs.existsSync(MAILS) ? fs.readdirSync(MAILS).sort().reverse() : [];
    for (const file of files) {
      const content = fs.readFileSync(path.join(MAILS, file), 'utf8');
      if (content.includes(email)) return content;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return '';
}

/** Lien du mail (le corps peut être encodé en quoted-printable). */
function tokenFrom(mail) {
  const decoded = mail.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
  return decoded.match(/token=([A-Za-z0-9_-]{32,128})/)?.[1] ?? null;
}

(async () => {
  fs.rmSync(MAILS, { recursive: true, force: true });
  fs.mkdirSync(MAILS, { recursive: true });

  const run = Date.now().toString(36);
  const email = `oubli-${run}@test.cm`;
  const reg = await call('POST', '/auth/register', {
    email, password: 'ancienmotdepasse', firstName: 'Awa', lastName: 'Nkeng',
    phone: '656566762', organizationName: `Oubli ${run}`, organizationType: 'ENTREPRISE',
    entity: { niu: `NRST${run}`.toUpperCase(), legalName: 'AWA SARL', legalForm: 'SARL', taxRegime: 'RSI',
      address: 'Bastos', city: 'Yaoundé', phone: '656566762' },
  });
  check('inscription', reg.status === 201, reg);
  const oldSession = reg.data.accessToken;

  // Même réponse, que le compte existe ou non.
  const unknown = await call('POST', '/auth/forgot-password', { email: `inconnu-${run}@test.cm` });
  const known = await call('POST', '/auth/forgot-password', { email: email.toUpperCase() });
  check('réponse identique (pas de fuite des comptes)', unknown.status === 200 && known.status === 200 && unknown.data.message === known.data.message, [unknown, known]);
  check('aucun e-mail pour une adresse inconnue', !(await lastMailTo(`inconnu-${run}@test.cm`)), '');

  const mail = await lastMailTo(email);
  const token = tokenFrom(mail);
  check('e-mail reçu avec le lien', !!token && /mot-de-passe\/nouveau\?token=/.test(mail.replace(/=\r?\n/g, '').replace(/=3D/g, '=')), mail.slice(0, 400));

  // Un second envoi annule le premier lien.
  await call('POST', '/auth/forgot-password', { email });
  await new Promise((r) => setTimeout(r, 300));
  const token2 = tokenFrom(await lastMailTo(email));
  check('nouveau lien différent', !!token2 && token2 !== token, [token, token2]);
  const stale = await call('POST', '/auth/reset-password', { token, password: 'nouveaumotdepasse' });
  check('ancien lien refusé', stale.status === 400, stale);

  const short = await call('POST', '/auth/reset-password', { token: token2, password: 'court' });
  check('mot de passe trop court refusé', short.status === 400, short);
  const fake = await call('POST', '/auth/reset-password', { token: 'x'.repeat(43), password: 'nouveaumotdepasse' });
  check('faux lien refusé', fake.status === 400, fake);

  const reset = await call('POST', '/auth/reset-password', { token: token2, password: 'nouveaumotdepasse' });
  check('mot de passe modifié', reset.status === 200, reset);
  const reuse = await call('POST', '/auth/reset-password', { token: token2, password: 'encoreunautre1' });
  check('lien utilisable une seule fois', reuse.status === 400, reuse);

  const oldLogin = await call('POST', '/auth/login', { email, password: 'ancienmotdepasse' });
  check('ancien mot de passe refusé', oldLogin.status === 401, oldLogin);
  const newLogin = await call('POST', '/auth/login', { email, password: 'nouveaumotdepasse' });
  check('connexion avec le nouveau mot de passe', newLogin.status === 200 && !!newLogin.data.accessToken, newLogin);
  const me = await call('GET', '/auth/me', undefined, oldSession);
  check('anciennes sessions fermées', me.status === 401, me);

  const ok = results.filter(Boolean).length;
  console.log(`\n${ok}/${results.length} vérifications réussies`);
  process.exit(ok === results.length ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
