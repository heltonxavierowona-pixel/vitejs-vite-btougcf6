import { Component, type ReactNode } from 'react'

// Une erreur d'affichage ne doit jamais laisser un écran blanc : on montre le message
// (utile pour le support) et un bouton pour recharger.
export default class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <section className="card">
        <h2>Cette page a rencontré un problème</h2>
        <p className="error">{this.state.error.message}</p>
        <p className="muted small">Envoyez une capture de ce message au support si le problème revient.</p>
        <button className="btn" onClick={() => window.location.reload()}>Recharger la page</button>
      </section>
    )
  }
}
