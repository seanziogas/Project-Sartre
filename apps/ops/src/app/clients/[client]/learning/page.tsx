import { notFound } from 'next/navigation'
import { assertClientAccess, getPortalIdentity } from '@/lib/auth'
import { getLearningControlCenter, getManifest, listFeedback } from '@/lib/data'
import { ClientTabs } from '@/lib/nav'
import { computeReviewMetrics } from '@sartre/learning'

export const dynamic = 'force-dynamic'

export default async function LearningPage({ params }: { params: Promise<{ client: string }> }) {
  const clientId = decodeURIComponent((await params).client)
  const identity = await getPortalIdentity()
  assertClientAccess(identity, clientId, 'view')
  if (!(await getManifest(clientId))) notFound()
  const center = await getLearningControlCenter(clientId)
  const metrics = computeReviewMetrics((await listFeedback(clientId)).filter((event) => event.kind === 'human_action'))
  return <>
    <ClientTabs clientId={clientId} active="learning" />
    <h1>Evaluation and learning control center</h1>
    <div className="grid">
      <div className="stat"><div className="label">Eval executions</div><div className="value">{center.totals.evaluations}</div></div>
      <div className="stat"><div className="label">Known answers passed</div><div className="value">{center.totals.passed}</div></div>
      <div className="stat"><div className="label">Regressions</div><div className="value">{center.totals.regressions}</div></div>
      <div className="stat"><div className="label">Approved as-is</div><div className="value">{Math.round(metrics.approveRate * 100)}%</div></div>
    </div>
    <h2>Learning proposals</h2>
    {center.proposals.length === 0 ? <p className="muted">No draft proposals.</p> : <table><thead><tr><th>Artifact</th><th>Kind</th><th>Status</th><th>Created</th></tr></thead><tbody>
      {center.proposals.map((proposal) => <tr key={proposal.key}><td className="mono">{proposal.key}</td><td>{proposal.kind}</td><td><span className="pill yellow">{proposal.status}</span></td><td>{proposal.createdAt ?? '—'}</td></tr>)}
    </tbody></table>}
    <h2>Evaluation history</h2>
    {center.evaluations.length === 0 ? <p className="muted">No recorded tenant eval executions.</p> : <table><thead><tr><th>Skill</th><th>Version</th><th>Source</th><th>Result</th><th>Cases</th><th>At</th></tr></thead><tbody>
      {center.evaluations.map((evaluation) => <tr key={evaluation.evaluationId}><td>{evaluation.skillId}</td><td>{evaluation.version}</td><td>{evaluation.source}</td><td><span className={`pill ${evaluation.status === 'passed' ? 'green' : 'red'}`}>{evaluation.status}</span></td><td>{evaluation.passed} passed / {evaluation.failed} failed</td><td>{evaluation.createdAt}</td></tr>)}
    </tbody></table>}
  </>
}
