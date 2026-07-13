import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { canAccessClient } from '@sartre/core'
import { assertClientAccess, getPortalIdentity } from '@/lib/auth'
import { connectTool, getManifest, listToolConnections, revokeToolConnection } from '@/lib/data'
import { ClientTabs } from '@/lib/nav'

export const dynamic = 'force-dynamic'

const providers = ['salesforce', 'hubspot', 'clay', 'slack', 'teams', 'gong', 'fathom', 'sixsense', 'g2', 'clearbit', 'snowflake', 'bigquery']

export default async function ConnectionsPage({ params }: { params: Promise<{ client: string }> }) {
  const clientId = decodeURIComponent((await params).client)
  const identity = await getPortalIdentity()
  assertClientAccess(identity, clientId, 'view')
  const manifest = await getManifest(clientId)
  if (!manifest) notFound()
  const connections = await listToolConnections(clientId)
  const mayConnect = canAccessClient(identity, clientId, 'connect')

  async function connect(formData: FormData) {
    'use server'
    const currentIdentity = await getPortalIdentity()
    assertClientAccess(currentIdentity, clientId, 'connect')
    const currentManifest = await getManifest(clientId)
    if (!currentManifest || !['trialing', 'active'].includes(currentManifest.commercial.status)) {
      throw new Error('subscription status does not permit connection changes')
    }
    const credentials = Object.fromEntries(
      ['apiKey', 'clientId', 'clientSecret', 'refreshToken', 'serviceAccountJson']
        .map((key) => [key, String(formData.get(key) ?? '').trim()] as const)
        .filter(([, value]) => value !== ''),
    )
    const customCredentialName = String(formData.get('customCredentialName') ?? '').trim()
    const customCredentialValue = String(formData.get('customCredentialValue') ?? '').trim()
    if (customCredentialName || customCredentialValue) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(customCredentialName) || !customCredentialValue) {
        throw new Error('custom credential requires a valid name and value')
      }
      credentials[customCredentialName] = customCredentialValue
    }
    await connectTool(clientId, {
      provider: String(formData.get('provider') ?? ''),
      authKind: String(formData.get('authKind') ?? ''),
      label: String(formData.get('label') ?? ''),
      credentials,
      metadata: {},
    }, currentIdentity.email)
    revalidatePath(`/clients/${encodeURIComponent(clientId)}/connections`)
  }

  async function revoke(formData: FormData) {
    'use server'
    const currentIdentity = await getPortalIdentity()
    assertClientAccess(currentIdentity, clientId, 'connect')
    const connectionId = String(formData.get('connectionId') ?? '')
    if (!(await listToolConnections(clientId)).some((connection) => connection.connectionId === connectionId)) {
      throw new Error('connection not found for client')
    }
    await revokeToolConnection(clientId, connectionId)
    revalidatePath(`/clients/${encodeURIComponent(clientId)}/connections`)
  }

  return (
    <>
      <ClientTabs clientId={clientId} active="connections" showCopilot={canAccessClient(identity, clientId, 'copilot')} />
      <h1>Connections</h1>
      <p className="muted">
        Sartre access does not depend on a connector. Add credentials owned by {manifest.client.name} only when a module needs a connected tool.
      </p>

      {connections.length === 0 ? (
        <div className="card muted">No tools connected. The portal and modules that do not need an external tool remain available.</div>
      ) : (
        <table>
          <thead><tr><th>Tool</th><th>Label</th><th>Authentication</th><th>Connected</th><th /></tr></thead>
          <tbody>
            {connections.map((connection) => (
              <tr key={connection.connectionId}>
                <td>{connection.provider}</td>
                <td>{connection.label}</td>
                <td>{connection.authKind.replace('_', ' ')}</td>
                <td>{new Date(connection.createdAt).toLocaleString()}</td>
                <td>
                  {mayConnect ? (
                    <form action={revoke}>
                      <input type="hidden" name="connectionId" value={connection.connectionId} />
                      <button type="submit" className="reject">Revoke</button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {mayConnect ? (
        <>
          <h2>Connect a tool</h2>
          <form action={connect} className="card connection-form">
            <label>Provider<input type="text" name="provider" list="connection-providers" required placeholder="salesforce" /></label>
            <datalist id="connection-providers">{providers.map((provider) => <option key={provider} value={provider} />)}</datalist>
            <label>Connection label<input type="text" name="label" required placeholder="Production CRM" /></label>
            <label>Authentication
              <select name="authKind" required defaultValue="api_key">
                <option value="api_key">API key</option>
                <option value="oauth">OAuth credentials</option>
                <option value="service_account">Service account</option>
              </select>
            </label>
            <label>API key<input type="password" name="apiKey" autoComplete="off" /></label>
            <label>OAuth client ID<input type="password" name="clientId" autoComplete="off" /></label>
            <label>OAuth client secret<input type="password" name="clientSecret" autoComplete="off" /></label>
            <label>OAuth refresh token<input type="password" name="refreshToken" autoComplete="off" /></label>
            <label className="full">Service-account JSON<input type="password" name="serviceAccountJson" autoComplete="off" /></label>
            <label>Custom credential name<input type="text" name="customCredentialName" placeholder="accessToken" /></label>
            <label>Custom credential value<input type="password" name="customCredentialValue" autoComplete="off" /></label>
            <div className="full">
              <button type="submit" className="approve">Save encrypted connection</button>
              <span className="muted"> Credentials are write-only and are never displayed after submission.</span>
            </div>
          </form>
        </>
      ) : (
        <p className="muted">Your role can view connection status but cannot add or revoke credentials.</p>
      )}
    </>
  )
}
