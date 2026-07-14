import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { canAccessClient } from '@sartre/core'
import { assertClientAccess, getPortalIdentity } from '@/lib/auth'
import { captureConfigRelease, getManifest, listConfigReleases, requestConfigPromotion, resolveConfigPromotion } from '@/lib/data'
import { ClientTabs } from '@/lib/nav'

export const dynamic = 'force-dynamic'

export default async function ReleasesPage({ params }: { params: Promise<{ client: string }> }) {
  const clientId = decodeURIComponent((await params).client)
  const identity = await getPortalIdentity()
  assertClientAccess(identity, clientId, 'view')
  if (!(await getManifest(clientId))) notFound()
  const canManage = canAccessClient(identity, clientId, 'manage')
  const releases = await listConfigReleases(clientId)

  async function capture() {
    'use server'
    const actor = await getPortalIdentity(); assertClientAccess(actor, clientId, 'manage')
    await captureConfigRelease(clientId, actor.email); revalidatePath(`/clients/${encodeURIComponent(clientId)}/releases`)
  }
  async function request(form: FormData) {
    'use server'
    const actor = await getPortalIdentity(); assertClientAccess(actor, clientId, 'manage')
    const target = String(form.get('target'))
    if (target !== 'staging' && target !== 'production') throw new Error('invalid target stage')
    await requestConfigPromotion(clientId, String(form.get('releaseId')), target, actor.email); revalidatePath(`/clients/${encodeURIComponent(clientId)}/releases`)
  }
  async function decide(form: FormData) {
    'use server'
    const actor = await getPortalIdentity(); assertClientAccess(actor, clientId, 'manage')
    const decision = String(form.get('decision'))
    if (decision !== 'approved' && decision !== 'rejected') throw new Error('invalid decision')
    await resolveConfigPromotion(clientId, String(form.get('releaseId')), decision, actor.email); revalidatePath(`/clients/${encodeURIComponent(clientId)}/releases`)
  }

  return <>
    <ClientTabs clientId={clientId} active="releases" />
    <h1>Configuration releases</h1>
    <p className="muted">Immutable manifest and approved runtime-config snapshots promote development → staging → production with a second-person decision.</p>
    {canManage && <form action={capture}><button type="submit">Capture development release</button></form>}
    <table><thead><tr><th>Version</th><th>Digest</th><th>Stage</th><th>Status</th><th>Created</th><th>Action</th></tr></thead><tbody>
      {releases.map((release) => <tr key={release.releaseId}>
        <td>v{release.version}</td><td className="mono">{release.digest.slice(0, 12)}</td><td>{release.stage}</td><td><span className={`pill ${release.status === 'active' ? 'green' : release.status === 'rejected' ? 'red' : 'yellow'}`}>{release.status}</span></td><td>{release.createdAt}<br/><span className="muted">{release.createdBy}</span></td>
        <td>{canManage && release.status === 'active' && release.stage !== 'production' && <form action={request}><input type="hidden" name="releaseId" value={release.releaseId}/><input type="hidden" name="target" value={release.stage === 'development' ? 'staging' : 'production'}/><button type="submit">Request {release.stage === 'development' ? 'staging' : 'production'}</button></form>}
          {canManage && release.status === 'pending_approval' && <form action={decide} className="actions"><input type="hidden" name="releaseId" value={release.releaseId}/><button name="decision" value="approved" className="approve">Approve</button><button name="decision" value="rejected" className="reject">Reject</button></form>}
        </td>
      </tr>)}
    </tbody></table>
  </>
}
