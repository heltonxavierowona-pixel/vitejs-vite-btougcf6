// Éditeur de la plateforme : affiché sur les pages publiques (accueil, mentions légales,
// confidentialité). Modifiable sans toucher au code par les variables VITE_COMPANY_* (Vercel).
const env = import.meta.env

export const COMPANY = {
  product: 'Numera Agentic',
  name: (env.VITE_COMPANY_NAME as string | undefined) ?? 'NUMERA GROUPE',
  owner: (env.VITE_COMPANY_OWNER as string | undefined) ?? 'Helton Xavier Owona',
  address: (env.VITE_COMPANY_ADDRESS as string | undefined) ?? 'Ayene, Yaoundé, région du Centre, Cameroun',
  phone: (env.VITE_COMPANY_PHONE as string | undefined) ?? '+237 657 56 67 62',
  email: (env.VITE_COMPANY_EMAIL as string | undefined) ?? 'heltonxavierowona@gmail.com',
  site: 'https://numera-agentic.vercel.app',
}

export const phoneDigits = COMPANY.phone.replace(/\D/g, '')
export const whatsappLink = `https://wa.me/${phoneDigits}`
