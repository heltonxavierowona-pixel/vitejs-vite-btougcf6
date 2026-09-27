import { useCallback, useState } from 'react'

const KEY = 'closer.setup-checklist'

function load(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}

// Progression de la Partie 1, gardée localement.
// Sera déplacée dans channel_accounts.setup_checklist une fois Supabase branché.
export function useChecklist() {
  const [done, setDone] = useState<Record<string, boolean>>(load)

  const toggle = useCallback((key: string) => {
    setDone((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        // stockage indisponible : la progression reste en mémoire
      }
      return next
    })
  }, [])

  return { done, toggle }
}
