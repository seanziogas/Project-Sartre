import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getManifest, listRuns } from '@/lib/data'
import { ClientTabs } from '@/lib/nav'
import { assertClientAccess, getPortalIdentity } from '@/lib/auth'
import { canAccessClient } from '@sartre/core'

export const dynamic = 'force-dynamic'

const STATUS_PILL: Record<string, string> = {
  completed: 'green',
  running: 'yellow',
  awaiting_approval: 'yellow',
  pending: 'gray',
  failed: 'red',
  rejected: 'red',
  blocked: 'red',
}

export default async function Runs({ params }: { params: Promise<{ client: string }> }) {
  const clientId = decodeURIComponent((await params).client)
  const identity = await getPortalIdentity()
  assertClientAccess(identity, clientId, 'view')
  const manifest = await getManifest(clientId)
  if (!manifest) notFound()
  const runs = await listRuns(clientId)

  return (
    <>
      <ClientTabs clientId={clientId} active="runs" showCopilot={canAccessClient(identity, clientId, 'copilot')} />
      <h1>Runs</h1>
      {runs.length === 0 ? (
        <div className="card muted">No runs yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Run</th>
              <th>Pipeline</th>
              <th>Module</th>
              <th>Status</th>
              <th>Credits</th>
              <th>Tokens $</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.runId}>
                <td>
                  <Link href={`/clients/${encodeURIComponent(clientId)}/runs/${encodeURIComponent(r.runId)}`} className="mono">
                    {r.runId.slice(0, 8)}
                  </Link>
                </td>
                <td className="mono">{r.pipelineId}</td>
                <td className="mono">{r.moduleId}</td>
                <td>
                  <span className={`pill ${STATUS_PILL[r.status] ?? 'gray'}`}>{r.status}</span>
                </td>
                <td>{r.spend.clayCredits}</td>
                <td>${r.spend.tokensUsd.toFixed(2)}</td>
                <td className="muted">{new Date(r.updatedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
