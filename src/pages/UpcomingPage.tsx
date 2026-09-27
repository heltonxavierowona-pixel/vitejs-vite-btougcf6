export default function UpcomingPage({
  title,
  part,
  description,
}: {
  title: string
  part: number
  description: string
}) {
  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Partie {part}</p>
        <h1>{title}</h1>
      </header>
      <section className="card empty">
        <p>{description}</p>
        <p className="muted">Cet écran sera construit à la Partie {part}.</p>
      </section>
    </>
  )
}
