type LoadingStateProps = {
  title?: string
  description?: string
  visible?: boolean
}

export function LoadingOverlay({
  title = "Carregando",
  description = "Aguarde enquanto concluimos a operacao.",
  visible = true,
}: LoadingStateProps) {
  if (!visible) return null

  return (
    <div className="app-loading-overlay" role="status" aria-live="polite">
      <LoadingCard title={title} description={description} />
    </div>
  )
}

export function LoadingScreen({
  title = "Carregando",
  description = "Preparando a tela para voce.",
}: LoadingStateProps) {
  return (
    <main className="app-loading-screen">
      <LoadingCard title={title} description={description} />
    </main>
  )
}

export function LoadingInline({
  title = "Carregando",
  description,
}: LoadingStateProps) {
  return (
    <div className="app-loading-inline" role="status" aria-live="polite">
      <LoadingCard title={title} description={description} />
    </div>
  )
}

function LoadingCard({ title, description }: LoadingStateProps) {
  return (
    <div className="app-loading-card">
      <span className="app-loading-spinner" aria-hidden="true" />
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
    </div>
  )
}
