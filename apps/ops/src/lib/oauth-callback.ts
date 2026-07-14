import { isOAuthProvider, validateProviderCredentials } from '@sartre/connectors'
import type { OAuthExchangeInput, OAuthProviderId } from '@sartre/connectors'
import type { CredentialKeyConfig } from '@sartre/connectors'
import { openOAuthState } from './oauth-state'

interface CallbackIdentity { email: string }
interface CallbackManifest { commercial: { status: string } }

export interface OAuthCallbackDependencies {
  encryptionKey?: CredentialKeyConfig
  getIdentity(): Promise<CallbackIdentity>
  assertAccess(identity: CallbackIdentity, clientId: string): void
  getManifest(clientId: string): Promise<CallbackManifest | null>
  exchange(provider: OAuthProviderId, input: OAuthExchangeInput): Promise<Record<string, string>>
  connect(clientId: string, input: {
    provider: OAuthProviderId
    authKind: 'oauth'
    label: string
    credentials: Record<string, string>
    metadata: Record<string, string>
  }, actor: string): Promise<unknown>
  now?: () => number
}

export async function handleOAuthCallback(request: Request, deps: OAuthCallbackDependencies): Promise<Response> {
  const url = new URL(request.url)
  const state = url.searchParams.get('state')
  if (url.searchParams.has('error')) return new Response('OAuth authorization was denied by the provider', { status: 400 })
  const code = url.searchParams.get('code')
  if (!code || !state) return new Response('OAuth code and state are required', { status: 400 })
  if (!deps.encryptionKey) return new Response('OAuth is not configured', { status: 503 })

  let clientId: string
  let payload: Record<string, string>
  try {
    ({ clientId, payload } = openOAuthState(deps.encryptionKey, state, deps.now?.()))
  } catch {
    return new Response('Invalid or expired OAuth state', { status: 400 })
  }

  let identity: CallbackIdentity
  try {
    identity = await deps.getIdentity()
    deps.assertAccess(identity, clientId)
  } catch {
    return new Response('OAuth client access denied', { status: 403 })
  }
  if (identity.email !== payload.actor) return new Response('OAuth actor changed', { status: 403 })

  const manifest = await deps.getManifest(clientId)
  if (!manifest || !['trialing', 'active'].includes(manifest.commercial.status)) {
    return new Response('Subscription does not permit connection changes', { status: 403 })
  }
  const provider = payload.provider
  if (!isOAuthProvider(provider)) return new Response('Unsupported provider', { status: 400 })

  let credentials: Record<string, string>
  try {
    const exchanged = await deps.exchange(provider, {
      clientId: payload.oauthClientId!, clientSecret: payload.oauthClientSecret!, code,
      redirectUri: payload.redirectUri!, state,
      ...(payload.tenant ? { tenant: payload.tenant } : {}),
      ...(payload.accountsUrl ? { accountsUrl: payload.accountsUrl } : {}),
      ...(payload.accountUrl ? { accountUrl: payload.accountUrl } : {}),
      ...(payload.workspaceUrl ? { workspaceUrl: payload.workspaceUrl } : {}),
      ...(payload.codeVerifier ? { codeVerifier: payload.codeVerifier } : {}),
    })
    credentials = { ...exchanged, ...oauthConnectionExtras(payload) }
    validateProviderCredentials(provider, credentials, 'oauth')
  } catch {
    return new Response('OAuth token exchange failed', { status: 502 })
  }

  try {
    await deps.connect(clientId, {
      provider, authKind: 'oauth', label: payload.label!, credentials,
      metadata: { oauth: 'true' },
    }, identity.email)
  } catch {
    return new Response('OAuth connection could not be saved', { status: 503 })
  }
  return Response.redirect(new URL(`/clients/${encodeURIComponent(clientId)}/connections`, request.url), 303)
}

function oauthConnectionExtras(payload: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    ['mailboxId', 'customerId', 'adAccountId', 'instanceUrl', 'apiDomain', 'accountsUrl', 'accountUrl', 'workspaceUrl', 'tenant', 'apiVersion', 'projectId', 'leadsUrl']
      .flatMap((key) => payload[key] ? [[key, payload[key]!]] : []),
  )
}
