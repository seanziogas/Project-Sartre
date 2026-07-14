import { revalidatePath } from 'next/cache'
import { notFound, redirect } from 'next/navigation'
import { canAccessClient } from '@sartre/core'
import { CredentialVault, oauthAuthorizationUrl, SUPPORTED_PROVIDERS } from '@sartre/connectors'
import type { OAuthProviderId } from '@sartre/connectors'
import { assertClientAccess, getPortalIdentity } from '@/lib/auth'
import { connectTool, getManifest, listToolConnectionEvents, listToolConnections, revokeToolConnection, rotateToolConnection, testToolConnection } from '@/lib/data'
import { ClientTabs } from '@/lib/nav'

export const dynamic = 'force-dynamic'

const credentialFields = [
  'apiKey', 'accessToken', 'instanceUrl', 'enrichmentUrl', 'healthcheckUrl',
  'clientId', 'clientSecret', 'refreshToken', 'serviceAccountJson',
  'baseUrl', 'accountUrl', 'token', 'projectId', 'mailboxId', 'enrollmentUrl',
  'signalsUrl', 'leadsUrl', 'accessKey', 'accessKeySecret', 'location',
  'warehouse', 'database', 'schema', 'role', 'lookbackDays', 'apiVersion',
] as const

export default async function ConnectionsPage({ params }: { params: Promise<{ client: string }> }) {
  const clientId = decodeURIComponent((await params).client)
  const identity = await getPortalIdentity()
  assertClientAccess(identity, clientId, 'view')
  const manifest = await getManifest(clientId)
  if (!manifest) notFound()
  const connections = await listToolConnections(clientId)
  const events = await listToolConnectionEvents(clientId)
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
      credentialFields
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
    await revokeToolConnection(clientId, connectionId, currentIdentity.email)
    revalidatePath(`/clients/${encodeURIComponent(clientId)}/connections`)
  }

  async function rotate(formData: FormData) {
    'use server'
    const currentIdentity = await getPortalIdentity()
    assertClientAccess(currentIdentity, clientId, 'connect')
    const connectionId = String(formData.get('connectionId') ?? '')
    const name = String(formData.get('credentialName') ?? '').trim()
    const value = String(formData.get('credentialValue') ?? '').trim()
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name) || !value) throw new Error('credential name and value are required')
    await rotateToolConnection(clientId, connectionId, { [name]: value }, currentIdentity.email)
    revalidatePath(`/clients/${encodeURIComponent(clientId)}/connections`)
  }

  async function testConnection(formData: FormData) {
    'use server'
    const currentIdentity = await getPortalIdentity()
    assertClientAccess(currentIdentity, clientId, 'connect')
    await testToolConnection(clientId, String(formData.get('connectionId') ?? ''), currentIdentity.email)
    revalidatePath(`/clients/${encodeURIComponent(clientId)}/connections`)
  }

  async function startOAuth(formData: FormData) {
    'use server'
    const currentIdentity = await getPortalIdentity()
    assertClientAccess(currentIdentity, clientId, 'connect')
    const currentManifest = await getManifest(clientId)
    if (!currentManifest || !['trialing', 'active'].includes(currentManifest.commercial.status)) {
      throw new Error('subscription status does not permit connection changes')
    }
    const provider = String(formData.get('oauthProvider') ?? '') as OAuthProviderId
    if (!['salesforce', 'hubspot', 'slack', 'teams', 'fathom'].includes(provider)) throw new Error('unsupported OAuth provider')
    const key = process.env.SARTRE_CREDENTIAL_ENCRYPTION_KEY
    const baseUrl = process.env.SARTRE_PUBLIC_BASE_URL
    if (!key || !baseUrl) throw new Error('credential encryption key and public base URL are required for OAuth')
    const publicUrl = new URL(baseUrl)
    if (publicUrl.protocol !== 'https:' && publicUrl.hostname !== 'localhost' && publicUrl.hostname !== '127.0.0.1') {
      throw new Error('SARTRE_PUBLIC_BASE_URL must use HTTPS outside local development')
    }
    const redirectUri = new URL('/api/connections/oauth/callback', publicUrl).toString()
    const oauthClientId = String(formData.get('oauthClientId') ?? '').trim()
    const oauthClientSecret = String(formData.get('oauthClientSecret') ?? '').trim()
    const label = String(formData.get('oauthLabel') ?? '').trim()
    const loginUrl = String(formData.get('oauthAuthorizationUrl') ?? '').trim()
    if (provider === 'fathom' && !loginUrl) throw new Error('Fathom requires the registered app authorization URL generated by its SDK')
    const statePayload = new CredentialVault(key).seal({
      clientId, provider, actor: currentIdentity.email, label,
      oauthClientId, oauthClientSecret, redirectUri,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    }, clientId)
    const state = `${Buffer.from(clientId).toString('base64url')}.${statePayload}`
    redirect(oauthAuthorizationUrl(provider, { clientId: oauthClientId, redirectUri, state, ...(loginUrl ? { loginUrl } : {}) }))
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
                    <div className="actions">
                      <form action={testConnection}><input type="hidden" name="connectionId" value={connection.connectionId} /><button type="submit">Test</button></form>
                      <form action={revoke}><input type="hidden" name="connectionId" value={connection.connectionId} /><button type="submit" className="reject">Revoke</button></form>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {mayConnect && connections.length > 0 ? (
        <details className="card">
          <summary>Rotate credentials</summary>
          <form action={rotate} className="connection-form" style={{ marginTop: '0.75rem' }}>
            <label>Connection<select name="connectionId">{connections.map((connection) => <option key={connection.connectionId} value={connection.connectionId}>{connection.label}</option>)}</select></label>
            <label>Credential name<input type="text" name="credentialName" required placeholder="accessToken" /></label>
            <label>New value<input type="password" name="credentialValue" required autoComplete="off" /></label>
            <div className="full"><button type="submit">Rotate credential</button></div>
          </form>
        </details>
      ) : null}

      {events.length > 0 ? (
        <><h2>Connection activity</h2><table><thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Detail</th></tr></thead><tbody>
          {events.map((event) => <tr key={event.eventId}><td>{new Date(event.occurredAt).toLocaleString()}</td><td>{event.kind}</td><td>{event.actor}</td><td>{event.detail}</td></tr>)}
        </tbody></table></>
      ) : null}

      {mayConnect ? (
        <>
          <h2>Connect a tool</h2>
          <form action={connect} className="card connection-form">
            <label>Provider<input type="text" name="provider" list="connection-providers" required placeholder="salesforce" /></label>
            <datalist id="connection-providers">{SUPPORTED_PROVIDERS.map((provider) => <option key={provider} value={provider} />)}</datalist>
            <label>Connection label<input type="text" name="label" required placeholder="Production CRM" /></label>
            <label>Authentication
              <select name="authKind" required defaultValue="api_key">
                <option value="api_key">API key</option>
                <option value="oauth">OAuth credentials</option>
                <option value="service_account">Service account</option>
              </select>
            </label>
            <label>API key<input type="password" name="apiKey" autoComplete="off" /></label>
            <label>Access token<input type="password" name="accessToken" autoComplete="off" /></label>
            <label>CRM instance URL<input type="text" name="instanceUrl" autoComplete="off" /></label>
            <label>Clay enrichment URL<input type="text" name="enrichmentUrl" autoComplete="off" /></label>
            <label>Provider API/base URL<input type="url" name="baseUrl" autoComplete="off" /></label>
            <label>Snowflake account URL<input type="url" name="accountUrl" autoComplete="off" /></label>
            <label>Warehouse token<input type="password" name="token" autoComplete="off" /></label>
            <label>BigQuery project ID<input type="text" name="projectId" autoComplete="off" /></label>
            <label>Outreach mailbox ID<input type="text" name="mailboxId" autoComplete="off" /></label>
            <label>Partner enrollment URL<input type="url" name="enrollmentUrl" autoComplete="off" /></label>
            <label>Intent signals URL<input type="url" name="signalsUrl" autoComplete="off" /></label>
            <label>Inbound leads URL<input type="url" name="leadsUrl" autoComplete="off" /></label>
            <label>Gong access key<input type="password" name="accessKey" autoComplete="off" /></label>
            <label>Gong access-key secret<input type="password" name="accessKeySecret" autoComplete="off" /></label>
            <label>Warehouse/location<input type="text" name="location" autoComplete="off" /></label>
            <label>Warehouse name<input type="text" name="warehouse" autoComplete="off" /></label>
            <label>Database<input type="text" name="database" autoComplete="off" /></label>
            <label>Schema<input type="text" name="schema" autoComplete="off" /></label>
            <label>Role<input type="text" name="role" autoComplete="off" /></label>
            <label>Transcript lookback days<input type="number" min="1" max="365" name="lookbackDays" /></label>
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

      {mayConnect ? (
        <details className="card">
          <summary>Connect with OAuth</summary>
          <p className="muted">Use an OAuth app owned by this client. Its registered callback must match this deployment.</p>
          <form action={startOAuth} className="connection-form">
            <label>Provider<select name="oauthProvider"><option value="salesforce">salesforce</option><option value="hubspot">hubspot</option><option value="slack">slack</option><option value="teams">teams</option><option value="fathom">fathom</option></select></label>
            <label>Connection label<input type="text" name="oauthLabel" required /></label>
            <label>OAuth client ID<input type="password" name="oauthClientId" required autoComplete="off" /></label>
            <label>OAuth client secret<input type="password" name="oauthClientSecret" required autoComplete="off" /></label>
            <label className="full">Fathom authorization URL<input type="url" name="oauthAuthorizationUrl" placeholder="Generated by the registered Fathom app SDK" /></label>
            <div className="full"><button type="submit">Authorize with provider</button></div>
          </form>
        </details>
      ) : null}
    </>
  )
}
