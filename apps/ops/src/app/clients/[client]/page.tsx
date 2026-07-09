import { notFound } from 'next/navigation'
import { budgetUsage, getManifest, listPendingGates, listRuns } from '@/lib/data'
import { ClientTabs, mvdPill } from '@/lib/nav'

export const dynamic = 'force-dynamic'

export default async function ClientOverview({ params }: { params: Promise<{ client: string }> }) {
  const clientId = decodeURIComponent((await params).client)
  const manifest = await getManifest(clientId)
  if (!manifest) notFound()

  const runs = await listRuns(clientId)
  const pending = await listPendingGates(clientId)
  const budgets = budgetUsage(manifest, runs)
  // union of declared modules and audit-evaluated MVD statuses — a red module
  // the client hasn't enabled yet is exactly what this table must surface
  const moduleIds = [...new Set([...Object.keys(manifest.modules), ...Object.keys(manifest.mvd)])].sort()
  const modules = moduleIds.map((id) => [id, manifest.modules[id]] as const)

  return (
    <>
      <ClientTabs clientId={clientId} active="overview" />
      <h1>{manifest.client.name}</h1>

      <div className="grid">
        <div className="stat">
          <div className="label">Pending review</div>
          <div className="value">{pending.length}</div>
        </div>
        <div className="stat">
          <div className="label">Runs (total)</div>
          <div className="value">{runs.length}</div>
        </div>
        <div className="stat">
          <div className="label">Clay credits this month</div>
          <div className="value">
            {budgets.monthCredits}
            <span className="muted" style={{ fontSize: '0.9rem' }}>
              {' '}/ {budgets.creditCap ?? '∞'}
            </span>
          </div>
        </div>
        <div className="stat">
          <div className="label">Token spend this month</div>
          <div className="value">
            ${budgets.monthTokensUsd.toFixed(2)}
            <span className="muted" style={{ fontSize: '0.9rem' }}>
              {' '}/ {budgets.tokenCapUsd !== null ? `$${budgets.tokenCapUsd}` : '∞'}
            </span>
          </div>
        </div>
      </div>

      <h2>Modules</h2>
      <table>
        <thead>
          <tr>
            <th>Module</th>
            <th>Enabled</th>
            <th>Always-on</th>
            <th>MVD</th>
            <th>Blocking gaps</th>
          </tr>
        </thead>
        <tbody>
          {modules.map(([id, mod]) => {
            const mvd = manifest.mvd[id]
            return (
              <tr key={id}>
                <td className="mono">{id}</td>
                <td>{mod?.enabled ? <span className="pill green">on</span> : <span className="pill gray">off</span>}</td>
                <td>{mod?.always_on ? '✓' : ''}</td>
                <td>{mvdPill(mvd?.status)}</td>
                <td className="muted">
                  {mvd?.blocking_gaps
                    ?.map(
                      (g) =>
                        `${g.field} ${Math.round(g.coverage * 100)}% (needs ${Math.round(g.required * 100)}%${
                          g.remediation_credits ? `, ~${g.remediation_credits} credits` : ''
                        })`,
                    )
                    .join('; ') ?? ''}
                  {mod?.override_mvd ? ` — override: ${mod.override_mvd.reason} (${mod.override_mvd.approved_by})` : ''}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <h2>Pod</h2>
      <div className="card muted">
        MD: {manifest.client.pod.md || '—'} · GTME: {manifest.client.pod.gtme || '—'} · TOS:{' '}
        {manifest.client.pod.tos || '—'} · engagement start: {manifest.client.engagement_start}
      </div>
    </>
  )
}
