import { notFound } from 'next/navigation'
import { getRun } from '@/lib/data'
import { ClientTabs } from '@/lib/nav'
import { assertClientAccess, getPortalIdentity } from '@/lib/auth'
import { canAccessClient } from '@sartre/core'

export const dynamic = 'force-dynamic'

export default async function RunDetail({
  params,
}: {
  params: Promise<{ client: string; runId: string }>
}) {
  const p = await params
  const clientId = decodeURIComponent(p.client)
  const identity = await getPortalIdentity()
  assertClientAccess(identity, clientId, 'view')
  const run = await getRun(clientId, decodeURIComponent(p.runId))
  if (!run) notFound()

  return (
    <>
      <ClientTabs clientId={clientId} active="runs" showCopilot={canAccessClient(identity, clientId, 'copilot')} />
      <h1>
        Run <span className="mono">{run.runId.slice(0, 8)}</span>{' '}
        <span className={`pill ${run.status === 'completed' ? 'green' : run.status === 'failed' || run.status === 'rejected' || run.status === 'blocked' ? 'red' : 'yellow'}`}>
          {run.status}
        </span>
      </h1>
      <div className="card muted">
        <span className="mono">{run.pipelineId}</span> on <span className="mono">{run.moduleId}</span> · created{' '}
        {new Date(run.createdAt).toLocaleString()} · spend: {run.spend.clayCredits} credits, $
        {run.spend.tokensUsd.toFixed(4)} tokens
      </div>

      {run.gates.length > 0 && (
        <>
          <h2>Gates</h2>
          <table>
            <thead>
              <tr>
                <th>Gate</th>
                <th>Status</th>
                <th>Resolved by</th>
                <th>At</th>
              </tr>
            </thead>
            <tbody>
              {run.gates.map((g) => (
                <tr key={g.id}>
                  <td className="mono">{g.id}</td>
                  <td>
                    <span className={`pill ${g.status === 'approved' ? 'green' : g.status === 'rejected' ? 'red' : 'yellow'}`}>
                      {g.status}
                    </span>
                  </td>
                  <td>{g.resolvedBy ?? '—'}</td>
                  <td className="muted">{g.resolvedAt ? new Date(g.resolvedAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>Journal</h2>
      <table>
        <thead>
          <tr>
            <th>At</th>
            <th>Step</th>
            <th>Event</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {run.journal.map((j, i) => (
            <tr key={i}>
              <td className="muted mono">{j.at.slice(11, 19)}</td>
              <td className="mono">{j.step ?? ''}</td>
              <td className="mono">{j.event}</td>
              <td>{j.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
