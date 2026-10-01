// Connexion des comptes Meta de l'utilisateur via le SDK JavaScript Facebook :
//  - WhatsApp : « Embedded Signup » (le client connecte SON numéro, avec ou sans coexistence)
//  - Facebook + Instagram : « Facebook Login for Business »
// Le SDK ne renvoie qu'un `code` ; l'échange contre un token se fait côté serveur.

const APP_ID = import.meta.env.VITE_META_APP_ID as string | undefined
const WA_CONFIG_ID = import.meta.env.VITE_META_WA_CONFIG_ID as string | undefined
const LOGIN_CONFIG_ID = import.meta.env.VITE_META_LOGIN_CONFIG_ID as string | undefined
const GRAPH_VERSION = 'v23.0'

interface FBLoginResponse {
  authResponse?: { code?: string } | null
  status?: string
}
interface FBSdk {
  init(opts: Record<string, unknown>): void
  login(cb: (r: FBLoginResponse) => void, opts: Record<string, unknown>): void
}
declare global {
  interface Window {
    FB?: FBSdk
    fbAsyncInit?: () => void
  }
}

export const metaConfigured = !!APP_ID

let sdk: Promise<FBSdk> | null = null
function loadSdk(): Promise<FBSdk> {
  if (!APP_ID) return Promise.reject(new Error('VITE_META_APP_ID manquant'))
  sdk ??= new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: false, version: GRAPH_VERSION })
      resolve(window.FB!)
    }
    const s = document.createElement('script')
    s.src = 'https://connect.facebook.net/fr_FR/sdk.js'
    s.async = true
    s.crossOrigin = 'anonymous'
    s.onerror = () => reject(new Error('Impossible de charger le SDK Facebook'))
    document.body.appendChild(s)
  })
  return sdk
}

function login(configId: string, extras?: Record<string, unknown>): Promise<string> {
  return loadSdk().then(
    (FB) =>
      new Promise((resolve, reject) => {
        FB.login(
          (r) => (r.authResponse?.code ? resolve(r.authResponse.code) : reject(new Error('Connexion annulée'))),
          { config_id: configId, response_type: 'code', override_default_response_type: true, extras },
        )
      }),
  )
}

export interface WhatsAppSignupResult {
  code: string
  waba_id: string
  phone_number_id: string
  business_id?: string
  coexistence: boolean
}

// coexistence = true : le client garde son numéro WhatsApp Business (app)
// ET le connecte à la plateforme. Sinon, nouveau numéro dédié à l'API.
export function whatsappEmbeddedSignup(coexistence: boolean): Promise<WhatsAppSignupResult> {
  if (!WA_CONFIG_ID) return Promise.reject(new Error('VITE_META_WA_CONFIG_ID manquant'))

  let session: { waba_id?: string; phone_number_id?: string; business_id?: string } = {}
  const onMessage = (event: MessageEvent) => {
    if (!event.origin.endsWith('facebook.com')) return
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      if (data?.type === 'WA_EMBEDDED_SIGNUP' && String(data.event).startsWith('FINISH')) {
        session = data.data ?? {}
      }
    } catch {
      // messages non JSON du SDK : ignorés
    }
  }
  window.addEventListener('message', onMessage)

  return login(WA_CONFIG_ID, {
    setup: {},
    featureType: coexistence ? 'whatsapp_business_app_onboarding' : '',
    sessionInfoVersion: '3',
  })
    .then((code) => {
      if (!session.waba_id || !session.phone_number_id) {
        throw new Error('Inscription WhatsApp incomplète : numéro non sélectionné')
      }
      return {
        code,
        waba_id: session.waba_id,
        phone_number_id: session.phone_number_id,
        business_id: session.business_id,
        coexistence,
      }
    })
    .finally(() => window.removeEventListener('message', onMessage))
}

// Facebook Login for Business par redirection (fiable sur téléphone, où la fenêtre du SDK
// ne renvoie pas toujours le code). Retour sur la racine du site, déclarée dans
// « URI de redirection OAuth valides », puis sur Canaux avec ?code=…&state=numera_meta_….
export const META_STATE_PREFIX = 'numera_meta_'
export const metaRedirectUri = () => `${window.location.origin}/`

export function facebookLoginRedirect(): void {
  if (!APP_ID) throw new Error('VITE_META_APP_ID manquant')
  if (!LOGIN_CONFIG_ID) throw new Error('VITE_META_LOGIN_CONFIG_ID manquant')
  const state = META_STATE_PREFIX + crypto.randomUUID().replace(/-/g, '')
  try { sessionStorage.setItem('numera_meta_state', state) } catch { /* navigation privée : contrôle ignoré */ }
  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`)
  url.searchParams.set('client_id', APP_ID)
  url.searchParams.set('redirect_uri', metaRedirectUri())
  url.searchParams.set('config_id', LOGIN_CONFIG_ID)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('override_default_response_type', 'true')
  url.searchParams.set('state', state)
  window.location.href = url.toString()
}

// Vérifie le state du retour (si le navigateur l'a gardé).
export function metaStateOk(state: string | null): boolean {
  if (!state?.startsWith(META_STATE_PREFIX)) return false
  let saved: string | null = null
  try { saved = sessionStorage.getItem('numera_meta_state'); sessionStorage.removeItem('numera_meta_state') } catch { /* ignoré */ }
  return !saved || saved === state
}

export function facebookLoginForBusiness(): Promise<string> {
  if (!LOGIN_CONFIG_ID) return Promise.reject(new Error('VITE_META_LOGIN_CONFIG_ID manquant'))
  return login(LOGIN_CONFIG_ID)
}
