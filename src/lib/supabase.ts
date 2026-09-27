import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// Null tant que .env n'est pas renseigné : la plateforme tourne alors en mode démo.
export const supabase = url && anonKey ? createClient(url, anonKey) : null
