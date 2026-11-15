/**
 * Initialisation Neero — à lancer UNE FOIS par projet (et par
 * environnement : Sandbox puis production).
 *
 * Crée le moyen de paiement marchand du projet (Create Payment
 * Method avec neeroMerchantDetails) et affiche son identifiant, à
 * copier dans NEERO_DESTINATION_PAYMENT_METHOD_ID.
 *
 * Utilisation (Node 20+) :
 *   node --env-file=.env scripts/neero-init.js
 *
 * Variables lues : NEERO_ENV, NEERO_BASE_URL, NEERO_SECRET_KEY,
 * NEERO_MERCHANT_KEY, NEERO_STORE_ID, NEERO_BALANCE_ID,
 * NEERO_OPERATOR_ID, NEERO_MERCHANT_METHOD_TYPE (valeur de « type »
 * pour un marchand : à relever dans la documentation), et si besoin
 * NEERO_AUTH_HEADER / NEERO_AUTH_SCHEME / NEERO_PATH_PAYMENT_METHODS.
 */
const env = process.env;
const baseUrl = (env.NEERO_BASE_URL || (env.NEERO_ENV === 'production' ? 'https://api.neero.tech/payment-gateway' : '')).replace(/\/$/, '');

const missing = ['NEERO_SECRET_KEY', 'NEERO_MERCHANT_KEY', 'NEERO_MERCHANT_METHOD_TYPE'].filter((key) => !env[key]);
if (!baseUrl) missing.unshift('NEERO_BASE_URL');
if (missing.length) {
  console.error(`Variables manquantes : ${missing.join(', ')}`);
  process.exit(1);
}

const authHeader = env.NEERO_AUTH_HEADER || 'Authorization';
const authScheme = env.NEERO_AUTH_SCHEME ?? 'Bearer';

(async () => {
  const body = {
    type: env.NEERO_MERCHANT_METHOD_TYPE,
    neeroMerchantDetails: {
      merchantKey: env.NEERO_MERCHANT_KEY,
      storeId: env.NEERO_STORE_ID || undefined,
      balanceId: env.NEERO_BALANCE_ID || undefined,
      operatorId: env.NEERO_OPERATOR_ID || null,
    },
  };

  const response = await fetch(`${baseUrl}${env.NEERO_PATH_PAYMENT_METHODS || '/api/v1/payment-methods'}`, {
    method: 'POST',
    headers: {
      [authHeader]: authScheme ? `${authScheme} ${env.NEERO_SECRET_KEY}` : env.NEERO_SECRET_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);

  console.log(`HTTP ${response.status}`);
  console.log(JSON.stringify(payload, null, 2));
  if (!response.ok) process.exit(1);

  const id = payload?.id ?? payload?.data?.id;
  console.log(id
    ? `\nÀ copier dans les variables d'environnement :\nNEERO_DESTINATION_PAYMENT_METHOD_ID=${id}`
    : '\nIdentifiant non trouvé : relevez-le dans la réponse ci-dessus.');
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
