import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { canAccessClient } from '@sartre/core'
import { DataCategory } from '@sartre/operations'
import { assertClientAccess, getPortalIdentity } from '@/lib/auth'
import { createGovernanceRequest, getGovernance, getManifest, resolveGovernanceRequest, saveGovernancePolicy } from '@/lib/data'
import { ClientTabs } from '@/lib/nav'

export const dynamic = 'force-dynamic'
const categories = DataCategory.options

export default async function GovernancePage({ params }: { params: Promise<{ client: string }> }) {
  const clientId = decodeURIComponent((await params).client)
  const identity = await getPortalIdentity()
  assertClientAccess(identity, clientId, 'view')
  if (!(await getManifest(clientId))) notFound()
  const canManage = canAccessClient(identity, clientId, 'manage')
  const governance = await getGovernance(clientId)

  async function savePolicy(form: FormData) {
    'use server'
    const actor = await getPortalIdentity(); assertClientAccess(actor, clientId, 'manage')
    const retentionDays = Object.fromEntries(categories.map((category) => [category, Number(form.get(`retention_${category}`))]))
    await saveGovernancePolicy(clientId, {
      retentionDays, residency: String(form.get('residency')), exportEnabled: form.get('exportEnabled') === 'on', deletionGraceDays: Number(form.get('deletionGraceDays')),
    }, actor.email)
    revalidatePath(`/clients/${encodeURIComponent(clientId)}/governance`)
  }
  async function request(form: FormData) {
    'use server'
    const actor = await getPortalIdentity(); assertClientAccess(actor, clientId, 'manage')
    const kind = String(form.get('kind'))
    if (kind !== 'export' && kind !== 'restore' && kind !== 'deletion' && kind !== 'retention') throw new Error('invalid governance request')
    const scope = categories.filter((category) => form.get(`scope_${category}`) === 'on')
    await createGovernanceRequest(clientId, kind, scope, String(form.get('reason')), actor.email)
    revalidatePath(`/clients/${encodeURIComponent(clientId)}/governance`)
  }
  async function decide(form: FormData) {
    'use server'
    const actor = await getPortalIdentity(); assertClientAccess(actor, clientId, 'manage')
    const decision = String(form.get('decision'))
    if (decision !== 'approved' && decision !== 'rejected') throw new Error('invalid governance decision')
    await resolveGovernanceRequest(clientId, String(form.get('requestId')), decision, actor.email)
    revalidatePath(`/clients/${encodeURIComponent(clientId)}/governance`)
  }

  return <>
    <ClientTabs clientId={clientId} active="governance" />
    <h1>Data governance and portability</h1>
    <p className="muted">Policies classify retention and residency. Export, retention, and deletion are explicit requests; approval never executes them automatically.</p>
    <h2>Policy</h2>
    {canManage ? <form action={savePolicy} className="card connection-form">
      <label>Residency<input name="residency" defaultValue={governance.policy?.residency ?? 'US'} required/></label>
      <label>Deletion grace days<input name="deletionGraceDays" type="number" min="1" max="90" defaultValue={governance.policy?.deletionGraceDays ?? 30} required/></label>
      <label><span>Portable export</span><input name="exportEnabled" type="checkbox" defaultChecked={governance.policy?.exportEnabled ?? true}/></label>
      {categories.map((category) => <label key={category}>{category} retention days<input name={`retention_${category}`} type="number" min="1" max="3650" defaultValue={governance.policy?.retentionDays[category] ?? 365} required/></label>)}
      <div className="full"><button type="submit">Save policy</button></div>
    </form> : <div className="card">Residency: {governance.policy?.residency ?? 'not configured'} · export: {governance.policy?.exportEnabled ? 'enabled' : 'disabled'}</div>}
    {canManage && <><h2>New request</h2><form action={request} className="card">
      <select name="kind"><option value="export">Portable export</option><option value="restore">Portable restore</option><option value="retention">Retention sweep</option><option value="deletion">Tenant deletion</option></select>
      <div className="actions">{categories.map((category) => <label key={category}><input type="checkbox" name={`scope_${category}`}/> {category}</label>)}</div>
      <textarea name="reason" placeholder="Reason and ticket reference" required/><button type="submit">Submit for approval</button>
    </form></>}
    <h2>Requests</h2>
    <table><thead><tr><th>Kind</th><th>Scope</th><th>Status</th><th>Requested</th><th>Decision</th></tr></thead><tbody>{governance.requests.map((request) => <tr key={request.requestId}><td>{request.kind}</td><td>{request.scope.join(', ')}</td><td><span className={`pill ${request.status === 'approved' || request.status === 'executed' ? 'green' : request.status === 'rejected' ? 'red' : 'yellow'}`}>{request.status}</span></td><td>{request.requestedBy}<br/><span className="muted">{request.requestedAt}</span></td><td>{canManage && request.status === 'pending' ? <form action={decide} className="actions"><input type="hidden" name="requestId" value={request.requestId}/><button name="decision" value="approved" className="approve">Approve</button><button name="decision" value="rejected" className="reject">Reject</button></form> : request.decidedBy ?? '—'}</td></tr>)}</tbody></table>
    <h2>Portability audit</h2>
    {governance.portabilityEvents.length === 0 ? <p className="muted">No exports, validations, or restores.</p> : <table><tbody>{governance.portabilityEvents.map((event) => <tr key={event.eventId}><td>{event.kind}</td><td>{event.detail}</td><td>{event.actor}</td><td>{event.occurredAt}</td></tr>)}</tbody></table>}
  </>
}
