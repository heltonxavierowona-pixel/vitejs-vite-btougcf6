import { useState } from 'react'
import Logo from '../components/Logo'
import { supabase } from '../lib/supabase'

// Connexion / inscription par lien magique. À la première connexion,
// la base crée automatiquement l'organisation de l'utilisateur.
export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const { error } = await supabase!.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin, data: company ? { company } : undefined },
    })
    if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <div className="login">
      <form className="card form login-card" onSubmit={submit}>
        <div className="brand"><Logo size={44} /></div>
        <p className="muted">L'agent IA qui prospecte sur les réseaux et conclut sur WhatsApp.</p>
        {sent ? (
          <p className="success">Lien de connexion envoyé à {email}. Ouvrez votre boîte mail.</p>
        ) : (
          <>
            <label>
              E-mail
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label>
              Entreprise <span className="muted small">(première inscription)</span>
              <input value={company} onChange={(e) => setCompany(e.target.value)} />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="btn">Recevoir mon lien de connexion</button>
          </>
        )}
      </form>
    </div>
  )
}
