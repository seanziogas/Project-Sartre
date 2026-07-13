import Link from 'next/link'

export function ClientTabs({ clientId, active, showCopilot = false }: { clientId: string; active: string; showCopilot?: boolean }) {
  const base = `/clients/${encodeURIComponent(clientId)}`
  const tabs = [
    { key: 'overview', label: 'Overview', href: base },
    { key: 'review', label: 'Review Queue', href: `${base}/review` },
    { key: 'runs', label: 'Runs', href: `${base}/runs` },
    { key: 'health', label: 'Data Health', href: `${base}/health` },
    { key: 'connections', label: 'Connections', href: `${base}/connections` },
    ...(showCopilot ? [{ key: 'copilot', label: 'Copilot', href: `${base}/copilot` }] : []),
  ]
  return (
    <>
      <nav className="crumbs">
        <Link href="/">Clients</Link> / {clientId}
      </nav>
      <nav className="tabs">
        {tabs.map((t) => (
          <Link key={t.key} href={t.href} className={t.key === active ? 'active' : ''}>
            {t.label}
          </Link>
        ))}
      </nav>
    </>
  )
}

export function mvdPill(status: string | undefined) {
  const cls = status === 'green' ? 'green' : status === 'yellow' ? 'yellow' : status === 'red' ? 'red' : 'gray'
  return <span className={`pill ${cls}`}>{status ?? 'unknown'}</span>
}
