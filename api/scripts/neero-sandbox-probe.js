/**
 * Sonde Sandbox Neero : répond aux « points à vérifier » avant la mise
 * en production, en affichant les réponses BRUTES de Neero.
 *
 *   node --env-file=.env scripts/neero-sandbox-probe.js
 *   node --env-file=.env scripts/neero-sandbox-probe.js <transactionIntentId>
 *
 * 1. Crée une demande d'encaissement de 100 XAF (confirm: false).
 * 2. Crée la session de paiement : quel champ contient l'URL ?
 * 3. Relit la transaction : chemin et format du statut.
 * Avec un identifiant en argument, seule l'étape 3 est jouée
 * (pour suivre un paiement fait à la main sur la page de session).
 *
 * Refuse de tourner avec NEERO_ENV=production.
 */
const env = process.env;
if (env.NEERO_ENV === 'production') {
  console.error('Sonde réservée à la Sandbox (NEERO_ENV=sandbox).');
  process.exit(1);
}
const baseUrl = (env.NEERO_BASE_URL || '').replace(/\/$/, '');
if (!baseUrl || !env.NEERO_SECRET_KEY) {
  console.error('NEERO_BASE_URL et NEERO_SECRET_KEY sont nécessaires.');
  process.exit(1);
}

const headers = {
  [env.NEERO_AUTH_HEADER || 'Authorization']:
    (env.NEERO_AUTH_SCHEME ?? 'Bearer') ? `${env.NEERO_AUTH_SCHEME ?? 'Bearer'} ${env.NEERO_SECRET_KEY}` : env.NEERO_SECRET_KEY,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

async function call(title, method, path, body) {
  console.log(`\n=== ${title} — ${method} ${path}`);
  const response = await fetch(baseUrl + path, { method, headers, body: body && JSON.stringify(body) });
  const payload = await response.json().catch(async () => ({ texte: await response.text().catch(() => '') }));
  console.log(`HTTP ${response.status}`);
  console.log(JSON.stringify(payload, null, 2));
  return payload;
}

(async () => {
  let id = process.argv[2];

  if (!id) {
    if (!env.NEERO_DESTINATION_PAYMENT_METHOD_ID) {
      console.error('NEERO_DESTINATION_PAYMENT_METHOD_ID manquant : lancez d’abord scripts/neero-init.js.');
      process.exit(1);
    }
    const app = (env.APP_PUBLIC_URL || env.FRONTEND_URL || 'https://example.com').replace(/\/$/, '');
    const intent = await call('1. Create Cash In Payment Intent', 'POST', env.NEERO_PATH_CASH_IN || '/api/v1/transaction-intents/cash-in', {
      amount: 100,
      currencyCode: 'XAF',
      paymentType: env.NEERO_CASH_IN_PAYMENT_TYPE || 'TRANSFER_TO_NEERO_PERSON',
      destinationPaymentMethodId: env.NEERO_DESTINATION_PAYMENT_METHOD_ID,
      confirm: false,
      successUrl: `${app}/abonnement/retour?provider=neero&ref=sonde`,
      failureUrl: `${app}/abonnement/retour?provider=neero&ref=sonde&statut=echec`,
      cancelUrl: `${app}/abonnement?paiement=annule`,
      collectCustomerDetails: false,
      customer: { name: 'Test Sandbox', email: 'test@example.com', phone: '+237670000000' },
      metadata: { project: env.NEERO_PROJECT || 'numera-facturation', paymentId: 'sonde' },
      flowTransactions: [],
      displayInfo: { name: 'Numera' },
    });
    id = intent?.id ?? intent?.data?.id;
    if (!id) {
      console.log('\nPas d’identifiant : ajustez NEERO_CASH_IN_PAYMENT_TYPE, l’authentification ou le chemin.');
      return;
    }
    await call('2. Create Session', 'POST', env.NEERO_PATH_SESSIONS || '/api/v1/sessions', { transactionIntentId: id });
    console.log('\n→ Repérez le champ qui contient l’URL de paiement (NEERO_SESSION_URL_FIELD si ce n’est ni url, paymentUrl, checkoutUrl…).');
  }

  const path = (env.NEERO_PATH_TRANSACTION || '/api/v1/transaction-intents/{id}').replace('{id}', encodeURIComponent(id));
  await call('3. Find Transaction Intent By Id', 'GET', path);
  console.log(`\nPour suivre ce paiement : node --env-file=.env scripts/neero-sandbox-probe.js ${id}`);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
