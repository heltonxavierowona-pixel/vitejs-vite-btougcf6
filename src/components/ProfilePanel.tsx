import type { RelationalProfile } from '../lib/types'

function Chips({ label, items, kind }: { label: string; items: string[]; kind?: 'signal' | 'objection' }) {
  if (!items.length) return null
  return (
    <div className="profile-row">
      <span className="muted small">{label}</span>
      <div className="chips">
        {items.map((i) => <span key={i} className={`pchip ${kind ? `pchip-${kind}` : ''}`}>{i}</span>)}
      </div>
    </div>
  )
}

// Profil relationnel : ce que l'IA a retenu du prospect, mis à jour à chaque message.
export default function ProfilePanel({
  profile,
  onRefresh,
}: {
  profile: RelationalProfile | null
  onRefresh?: () => void
}) {
  return (
    <aside className="profile-panel">
      <div className="profile-title">
        <strong>Profil relationnel</strong>
        {onRefresh && <button className="link small" onClick={onRefresh}>Mettre à jour</button>}
      </div>
      {!profile ? (
        <p className="muted small">L'IA construit le profil dès les premiers messages du prospect.</p>
      ) : (
        <>
          {profile.summary && <p className="profile-summary">{profile.summary}</p>}
          <div className="profile-row">
            <span className="muted small">Lui parler</span>
            <span className="small">
              {profile.formality === 'tu' ? 'Tutoiement' : 'Vouvoiement'}
              {profile.language ? ` · ${profile.language.toUpperCase()}` : ''}
              {profile.style.length ? ` · messages ${profile.style.length}s` : ''}
              {profile.style.emojis ? ' · émojis' : ''}
            </span>
          </div>
          {profile.tone && (
            <div className="profile-row"><span className="muted small">Ton</span><span className="small">{profile.tone}</span></div>
          )}
          <Chips label="Signaux d'achat" items={profile.buying_signals} kind="signal" />
          <Chips label="Intérêts" items={profile.interests} />
          <Chips label="Problèmes" items={profile.pain_points} />
          <Chips label="Objections" items={profile.objections} kind="objection" />
          <Chips label="Préférences" items={profile.preferences} />
          <p className="muted small">Version {profile.version} · données professionnelles uniquement</p>
        </>
      )}
    </aside>
  )
}
