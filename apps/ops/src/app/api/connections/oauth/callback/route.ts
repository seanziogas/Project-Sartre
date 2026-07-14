import { CredentialVault, exchangeOAuthCode, isOAuthProvider, productionHttpTransport, validateProviderCredentials } from '@sartre/connectors'
import { assertClientAccess, getPortalIdentity } from '@/lib/auth'
import { connectTool, getManifest } from '@/lib/data'

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) return new Response('OAuth code and state are required', { status: 400 })
  const separator = state.indexOf('.')
  if (separator < 1) return new Response('Invalid OAuth state', { status: 400 })
  const clientId = Buffer.from(state.slice(0, separator), 'base64url').toString('utf8')
  const key = process.env.SARTRE_CREDENTIAL_ENCRYPTION_KEY
  if (!key) return new Response('OAuth is not configured', { status: 503 })
  let payload: Record<string, string>
  try {
    payload = new CredentialVault(key).open(state.slice(separator + 1), clientId)
  } catch {
    return new Response('Invalid OAuth state', { status: 400 })
  }
  const expiresAt = Date.parse(payload.expiresAt ?? '')
  if (payload.clientId !== clientId || !Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return new Response('Expired OAuth state', { status: 400 })
  }
  if (!payload.actor || !payload.label || !payload.oauthClientId || !payload.oauthClientSecret || !payload.redirectUri) {
    return new Response('Invalid OAuth state', { status: 400 })
  }
  const identity = await getPortalIdentity()
  assertClientAccess(identity, clientId, 'connect')
  if (identity.email !== payload.actor) return new Response('OAuth actor changed', { status: 403 })
  const manifest = await getManifest(clientId)
  if (!manifest || !['trialing', 'active'].includes(manifest.commercial.status)) {
    return new Response('Subscription does not permit connection changes', { status: 403 })
  }
  const provider = payload.provider
  if (!isOAuthProvider(provider)) return new Response('Unsupported provider', { status: 400 })
  const exchanged = await exchangeOAuthCode(provider, {
    clientId: payload.oauthClientId!, clientSecret: payload.oauthClientSecret!, code,
    redirectUri: payload.redirectUri!, state,
    ...(payload.tenant ? { tenant: payload.tenant } : {}),
    ...(payload.accountsUrl ? { accountsUrl: payload.accountsUrl } : {}),
  }, productionHttpTransport())
  const credentials = { ...exchanged, ...oauthConnectionExtras(payload) }
  validateProviderCredentials(provider, credentials, 'oauth')
  await connectTool(clientId, {
    provider, authKind: 'oauth', label: payload.label!, credentials,
    metadata: { oauth: 'true' },
  }, identity.email)
  return Response.redirect(new URL(`/clients/${encodeURIComponent(clientId)}/connections`, request.url), 303)
}

function oauthConnectionExtras(payload: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    ['mailboxId', 'customerId', 'adAccountId', 'instanceUrl', 'apiDomain', 'accountsUrl', 'tenant', 'apiVersion', 'projectId', 'leadsUrl']
      .flatMap((key) => payload[key] ? [[key, payload[key]!]] : []),
  )
}
