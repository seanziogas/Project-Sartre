import { revalidatePath } from 'next/cache'
import { notFound, redirect } from 'next/navigation'
import { canAccessClient } from '@sartre/core'
import { CredentialVault, isOAuthProvider, oauthAuthorizationUrl, OAUTH_PROVIDERS, PROVIDER_CATALOG } from '@sartre/connectors'
import type { OAuthProviderId } from '@sartre/connectors'
import { assertClientAccess, getPortalIdentity } from '@/lib/auth'
import { connectTool, getManifest, listToolConnectionEvents, listToolConnections, revokeToolConnection, rotateToolConnection, testToolConnection } from '@/lib/data'
import { ClientTabs } from '@/lib/nav'
import { ProviderConnectionForm } from './provider-connection-form'

export const dynamic = 'force-dynamic'

const credentialFields = [
  'apiKey', 'accessToken', 'instanceUrl', 'enrichmentUrl', 'healthcheckUrl',
  'clientId', 'clientSecret', 'refreshToken', 'serviceAccountJson',
  'baseUrl', 'accountUrl', 'token', 'projectId', 'mailboxId', 'enrollmentUrl',
  'signalsUrl', 'leadsUrl', 'accessKey', 'accessKeySecret', 'location',
  'warehouse', 'database', 'schema', 'role', 'lookbackDays', 'apiVersion',
  'apiDomain', 'accountsUrl', 'customerId', 'adAccountId', 'workspaceUrl', 'warehouseId',
  'region', 'accessKeyId', 'secretAccessKey', 'sessionToken', 'clusterIdentifier',
  'workgroupName', 'secretArn', 'dbUser', 'listId', 'tenant',
  'convertedLeadStatus',
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
    const providerValue = String(formData.get('oauthProvider') ?? '')
    if (!isOAuthProvider(providerValue)) throw new Error('unsupported OAuth provider')
    const provider = providerValue as OAuthProviderId
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
    const extras = Object.fromEntries(
      ['mailboxId', 'customerId', 'adAccountId', 'instanceUrl', 'apiDomain', 'accountsUrl', 'tenant', 'apiVersion', 'projectId', 'leadsUrl']
        .map((name) => [name, String(formData.get(`oauth_${name}`) ?? '').trim()] as const)
        .filter(([, value]) => value !== ''),
    )
    const statePayload = new CredentialVault(key).seal({
      clientId, provider, actor: currentIdentity.email, label,
      oauthClientId, oauthClientSecret, redirectUri,
      ...extras,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    }, clientId)
    const state = `${Buffer.from(clientId).toString('base64url')}.${statePayload}`
    redirect(oauthAuthorizationUrl(provider, {
      clientId: oauthClientId, redirectUri, state,
      ...(loginUrl ? { loginUrl } : {}),
      ...(extras.tenant ? { tenant: extras.tenant } : {}),
      ...(extras.accountsUrl ? { accountsUrl: extras.accountsUrl } : {}),
      ...(extras.instanceUrl ? { instanceUrl: extras.instanceUrl } : {}),
    }))
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
          <ProviderConnectionForm providers={PROVIDER_CATALOG} action={connect} />
          <details className="card">
            <summary>Provider credential requirements</summary>
            <table><thead><tr><th>Provider</th><th>Authentication</th><th>Required fields</th><th>Capability</th></tr></thead><tbody>
              {PROVIDER_CATALOG.map((provider) => <tr key={provider.id}><td>{provider.label}</td><td>{provider.auth.join(', ')}</td><td><code>{provider.requiredCredentials.join(', ')}</code></td><td>{provider.detail}</td></tr>)}
            </tbody></table>
          </details>
        </>
      ) : (
        <p className="muted">Your role can view connection status but cannot add or revoke credentials.</p>
      )}

      {mayConnect ? (
        <details className="card">
          <summary>Connect with OAuth</summary>
          <p className="muted">Use an OAuth app owned by this client. Its registered callback must match this deployment.</p>
          <form action={startOAuth} className="connection-form">
            <label>Provider<select name="oauthProvider">{OAUTH_PROVIDERS.map((provider) => <option key={provider} value={provider}>{provider}</option>)}</select></label>
            <label>Connection label<input type="text" name="oauthLabel" required /></label>
            <label>OAuth client ID<input type="password" name="oauthClientId" required autoComplete="off" /></label>
            <label>OAuth client secret<input type="password" name="oauthClientSecret" required autoComplete="off" /></label>
            <label className="full">Fathom authorization URL<input type="url" name="oauthAuthorizationUrl" placeholder="Generated by the registered Fathom app SDK" /></label>
            <label>Outreach mailbox ID<input type="text" name="oauth_mailboxId" /></label>
            <label>Google Ads customer ID<input type="text" name="oauth_customerId" /></label>
            <label>Meta ad-account ID<input type="text" name="oauth_adAccountId" /></label>
            <label>CRM instance URL<input type="url" name="oauth_instanceUrl" /></label>
            <label>Zoho API domain<input type="url" name="oauth_apiDomain" /></label>
            <label>Zoho Accounts URL<input type="url" name="oauth_accountsUrl" /></label>
            <label>Microsoft tenant<input type="text" name="oauth_tenant" /></label>
            <label>BigQuery project ID<input type="text" name="oauth_projectId" /></label>
            <label>Typeform responses URL<input type="url" name="oauth_leadsUrl" /></label>
            <label>API version<input type="text" name="oauth_apiVersion" /></label>
            <div className="full"><button type="submit">Authorize with provider</button></div>
          </form>
        </details>
      ) : null}
    </>
  )
}
