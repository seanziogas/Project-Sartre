import { requestJson } from './http.js'
import type { HttpTransport } from './http.js'
import { createHash, randomBytes } from 'node:crypto'

export type OAuthProviderId =
  | 'salesforce' | 'hubspot' | 'slack' | 'teams' | 'fathom'
  | 'attio' | 'outreach' | 'salesloft' | 'gmail' | 'microsoft-email'
  | 'pipedrive' | 'dynamics' | 'zoho-crm' | 'zoom' | 'google-ads' | 'meta-ads'
  | 'linkedin-ads' | 'bigquery' | 'typeform'
  | 'gong' | 'snowflake' | 'databricks' | 'linkedin-leadgen'

export const OAUTH_PROVIDERS: readonly OAuthProviderId[] = [
  'salesforce', 'hubspot', 'slack', 'teams', 'fathom', 'attio', 'outreach', 'salesloft',
  'gmail', 'microsoft-email', 'pipedrive', 'zoho-crm', 'zoom', 'google-ads', 'meta-ads',
  'dynamics', 'linkedin-ads', 'bigquery', 'typeform',
  'gong', 'snowflake', 'databricks', 'linkedin-leadgen',
]

export function isOAuthProvider(value: string): value is OAuthProviderId {
  return (OAUTH_PROVIDERS as readonly string[]).includes(value)
}

export interface OAuthAuthorizationInput {
  clientId: string
  redirectUri: string
  state: string
  scopes?: string[]
  tenant?: string
  loginUrl?: string
  accountsUrl?: string
  instanceUrl?: string
  accountUrl?: string
  workspaceUrl?: string
  codeChallenge?: string
  codeVerifier?: string
}

export interface OAuthExchangeInput extends OAuthAuthorizationInput {
  clientSecret: string
  code: string
}

export function createOAuthPkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(48).toString('base64url')
  return { codeVerifier, codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url') }
}

const defaults: Record<OAuthProviderId, { authorize: string; token: string; scopes: string[]; tokenAuth?: 'basic'; retainClientId?: boolean }> = {
  salesforce: {
    authorize: 'https://login.salesforce.com/services/oauth2/authorize',
    token: 'https://login.salesforce.com/services/oauth2/token',
    scopes: ['api', 'refresh_token'],
  },
  hubspot: {
    authorize: 'https://app.hubspot.com/oauth/authorize',
    token: 'https://api.hubapi.com/oauth/2026-03/token',
    scopes: [
      'crm.objects.companies.read', 'crm.objects.companies.write',
      'crm.objects.contacts.read', 'crm.objects.contacts.write',
      'crm.objects.deals.read', 'crm.objects.deals.write',
      'crm.objects.owners.read',
    ],
  },
  slack: {
    authorize: 'https://slack.com/oauth/v2/authorize',
    token: 'https://slack.com/api/oauth.v2.access',
    scopes: ['chat:write'],
  },
  teams: {
    authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['offline_access', 'User.Read', 'ChannelMessage.Send'],
  },
  fathom: {
    authorize: '',
    token: 'https://api.fathom.ai/external/v1/oauth2/token',
    scopes: ['public_api'],
  },
  attio: {
    authorize: 'https://app.attio.com/authorize',
    token: 'https://app.attio.com/oauth/token',
    scopes: [],
  },
  outreach: {
    authorize: 'https://api.outreach.io/oauth/authorize',
    token: 'https://api.outreach.io/oauth/token',
    scopes: ['users.read', 'prospects.read', 'prospects.write', 'sequences.read', 'sequenceStates.write', 'mailboxes.read'],
  },
  salesloft: {
    authorize: 'https://accounts.salesloft.com/oauth/authorize',
    token: 'https://accounts.salesloft.com/oauth/token',
    scopes: [],
  },
  gmail: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly'],
  },
  'microsoft-email': {
    authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['offline_access', 'User.Read', 'Mail.Send'],
  },
  pipedrive: {
    authorize: 'https://oauth.pipedrive.com/oauth/authorize',
    token: 'https://oauth.pipedrive.com/oauth/token',
    scopes: [], tokenAuth: 'basic',
  },
  dynamics: {
    authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['offline_access'],
  },
  'zoho-crm': {
    authorize: 'https://accounts.zoho.com/oauth/v2/auth',
    token: 'https://accounts.zoho.com/oauth/v2/token',
    scopes: ['ZohoCRM.modules.ALL', 'ZohoCRM.users.READ'],
  },
  zoom: {
    authorize: 'https://zoom.us/oauth/authorize',
    token: 'https://zoom.us/oauth/token',
    scopes: [], tokenAuth: 'basic',
  },
  'google-ads': {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/datamanager'],
  },
  'meta-ads': {
    authorize: 'https://www.facebook.com/v24.0/dialog/oauth',
    token: 'https://graph.facebook.com/v24.0/oauth/access_token',
    scopes: ['ads_management', 'business_management'],
  },
  'linkedin-ads': {
    authorize: 'https://www.linkedin.com/oauth/v2/authorization',
    token: 'https://www.linkedin.com/oauth/v2/accessToken',
    scopes: ['r_ads', 'rw_ads', 'r_ads_reporting'],
  },
  bigquery: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/bigquery'],
  },
  typeform: {
    authorize: 'https://api.typeform.com/oauth/authorize',
    token: 'https://api.typeform.com/oauth/token',
    scopes: ['forms:read', 'responses:read'],
  },
  gong: {
    authorize: 'https://app.gong.io/oauth2/authorize',
    token: 'https://app.gong.io/oauth2/generate-customer-token',
    scopes: ['api:calls:read:basic', 'api:calls:read:transcript'], tokenAuth: 'basic', retainClientId: true,
  },
  snowflake: { authorize: '', token: '', scopes: [], tokenAuth: 'basic' },
  databricks: { authorize: '', token: '', scopes: ['all-apis', 'offline_access'], tokenAuth: 'basic' },
  'linkedin-leadgen': {
    authorize: 'https://www.linkedin.com/oauth/v2/authorization',
    token: 'https://www.linkedin.com/oauth/v2/accessToken',
    scopes: ['r_marketing_leadgen_automation', 'r_ads'],
  },
}

/** Builds a state-bearing authorization URL. State generation/verification belongs to the portal. */
export function oauthAuthorizationUrl(provider: OAuthProviderId, input: OAuthAuthorizationInput): string {
  const config = endpoints(provider, input)
  if (!config.authorize) throw new Error('Fathom authorization URLs must be generated by its registered-app SDK')
  const url = new URL(config.authorize)
  url.searchParams.set('client_id', required(input.clientId, 'clientId'))
  url.searchParams.set('redirect_uri', required(input.redirectUri, 'redirectUri'))
  url.searchParams.set('state', required(input.state, 'state'))
  url.searchParams.set('response_type', 'code')
  if (input.codeChallenge) {
    url.searchParams.set('code_challenge', input.codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
  }
  const scopes = input.scopes ?? (provider === 'dynamics' && input.instanceUrl
    ? ['offline_access', `${dynamicsOrigin(input.instanceUrl)}/user_impersonation`]
    : config.scopes)
  if (scopes.length) url.searchParams.set('scope', provider === 'slack' || provider === 'zoho-crm' ? scopes.join(',') : scopes.join(' '))
  if (provider === 'teams' || provider === 'microsoft-email' || provider === 'dynamics') url.searchParams.set('response_mode', 'query')
  if (provider === 'gmail' || provider === 'google-ads' || provider === 'bigquery' || provider === 'zoho-crm') {
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('prompt', 'consent')
  }
  return url.toString()
}

/** Exchanges a verified callback code; secrets are form-encoded in the body, never the URL. */
export async function exchangeOAuthCode(
  provider: OAuthProviderId,
  input: OAuthExchangeInput,
  http: HttpTransport,
): Promise<Record<string, string>> {
  const config = endpoints(provider, input)
  const form = new URLSearchParams({
    grant_type: 'authorization_code', code: required(input.code, 'code'),
    client_id: required(input.clientId, 'clientId'), client_secret: required(input.clientSecret, 'clientSecret'),
    redirect_uri: required(input.redirectUri, 'redirectUri'),
  })
  if (input.codeVerifier) form.set('code_verifier', input.codeVerifier)
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' }
  if (config.tokenAuth === 'basic') {
    headers.Authorization = `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString('base64')}`
    if (!config.retainClientId) form.delete('client_id')
    form.delete('client_secret')
  }
  const value = await requestJson<Record<string, unknown>>(http, {
    method: 'POST', url: config.token,
    headers, body: form.toString(),
  })
  if (provider === 'slack' && value.ok !== true) throw new Error('Slack OAuth exchange failed')
  const accessToken = stringValue(value.access_token, 'OAuth response access_token')
  return {
    accessToken,
    ...(typeof value.refresh_token === 'string' && value.refresh_token ? { refreshToken: value.refresh_token } : {}),
    ...(provider === 'salesforce' && typeof value.instance_url === 'string' ? { instanceUrl: value.instance_url } : {}),
    ...(provider === 'zoho-crm' && typeof value.api_domain === 'string' ? { apiDomain: value.api_domain } : {}),
    ...(provider === 'gong' && typeof value.api_base_url_for_customer === 'string' ? { baseUrl: value.api_base_url_for_customer } : {}),
    ...(provider === 'snowflake' ? { token: accessToken } : {}),
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    redirectUri: input.redirectUri,
    ...expiry(value.expires_in),
    ...(input.tenant ? { tenant: input.tenant } : {}),
    ...(input.accountsUrl ? { accountsUrl: input.accountsUrl } : {}),
    ...(input.accountUrl ? { accountUrl: input.accountUrl } : {}),
    ...(input.workspaceUrl ? { workspaceUrl: input.workspaceUrl } : {}),
  }
}

export async function refreshOAuthToken(
  provider: OAuthProviderId,
  credentials: Record<string, string>,
  http: HttpTransport,
): Promise<Record<string, string>> {
  const clientId = required(credentials.clientId ?? '', 'clientId')
  const clientSecret = required(credentials.clientSecret ?? '', 'clientSecret')
  const refreshToken = required(credentials.refreshToken ?? '', 'refreshToken')
  const input: OAuthAuthorizationInput = {
    clientId, redirectUri: credentials.redirectUri ?? 'https://localhost.invalid', state: 'refresh',
    ...(credentials.tenant ? { tenant: credentials.tenant } : {}),
    ...(credentials.loginUrl ? { loginUrl: credentials.loginUrl } : {}),
    ...(credentials.accountsUrl ? { accountsUrl: credentials.accountsUrl } : {}),
    ...(credentials.accountUrl ? { accountUrl: credentials.accountUrl } : {}),
    ...(credentials.workspaceUrl ? { workspaceUrl: credentials.workspaceUrl } : {}),
  }
  const config = endpoints(provider, input)
  const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret })
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' }
  if (config.tokenAuth === 'basic') {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
    if (!config.retainClientId) form.delete('client_id')
    form.delete('client_secret')
  }
  const value = await requestJson<Record<string, unknown>>(http, {
    method: 'POST', url: config.token,
    headers, body: form.toString(),
  })
  if (provider === 'slack' && value.ok !== true) throw new Error('Slack OAuth refresh failed')
  return {
    ...credentials,
    accessToken: stringValue(value.access_token, 'OAuth response access_token'),
    refreshToken: typeof value.refresh_token === 'string' && value.refresh_token ? value.refresh_token : refreshToken,
    ...(provider === 'salesforce' && typeof value.instance_url === 'string' ? { instanceUrl: value.instance_url } : {}),
    ...(provider === 'zoho-crm' && typeof value.api_domain === 'string' ? { apiDomain: value.api_domain } : {}),
    ...(provider === 'gong' && typeof value.api_base_url_for_customer === 'string' ? { baseUrl: value.api_base_url_for_customer } : {}),
    ...(provider === 'snowflake' ? { token: stringValue(value.access_token, 'OAuth response access_token') } : {}),
    ...expiry(value.expires_in),
  }
}

function endpoints(provider: OAuthProviderId, input: OAuthAuthorizationInput) {
  const config = defaults[provider]
  if (provider === 'salesforce' && input.loginUrl) {
    const login = new URL(input.loginUrl)
    if (login.protocol !== 'https:' || (login.hostname !== 'salesforce.com' && !login.hostname.endsWith('.salesforce.com'))) {
      throw new Error('Salesforce loginUrl must be an HTTPS endpoint on salesforce.com')
    }
    const base = login.origin
    return { ...config, authorize: `${base}/services/oauth2/authorize`, token: `${base}/services/oauth2/token` }
  }
  if ((provider === 'teams' || provider === 'microsoft-email' || provider === 'dynamics') && input.tenant) {
    const tenant = encodeURIComponent(input.tenant)
    return { ...config, authorize: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`, token: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token` }
  }
  if (provider === 'zoho-crm' && input.accountsUrl) {
    const accounts = new URL(input.accountsUrl)
    const allowed = ['accounts.zoho.com', 'accounts.zoho.com.au', 'accounts.zoho.eu', 'accounts.zoho.in', 'accounts.zoho.com.cn', 'accounts.zoho.jp', 'accounts.zohocloud.ca']
    if (accounts.protocol !== 'https:' || !allowed.includes(accounts.hostname)) throw new Error('Zoho accountsUrl must be an approved HTTPS Zoho Accounts host')
    return { ...config, authorize: `${accounts.origin}/oauth/v2/auth`, token: `${accounts.origin}/oauth/v2/token` }
  }
  if (provider === 'fathom' && input.loginUrl) {
    const authorize = new URL(input.loginUrl)
    if (authorize.protocol !== 'https:' || (authorize.hostname !== 'fathom.video' && !authorize.hostname.endsWith('.fathom.video'))) {
      throw new Error('Fathom authorization URL must be an HTTPS endpoint on fathom.video')
    }
    return { ...config, authorize: authorize.toString() }
  }
  if (provider === 'snowflake') {
    const base = providerOrigin(input.accountUrl, ['snowflakecomputing.com'], 'Snowflake accountUrl')
    return { ...config, authorize: `${base}/oauth/authorize`, token: `${base}/oauth/token-request` }
  }
  if (provider === 'databricks') {
    const base = providerOrigin(input.workspaceUrl, ['databricks.com', 'azuredatabricks.net'], 'Databricks workspaceUrl')
    return { ...config, authorize: `${base}/oidc/v1/authorize`, token: `${base}/oidc/v1/token` }
  }
  return config
}

function required(value: string, name: string): string {
  if (!value.trim()) throw new Error(`${name} is required`)
  return value
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${name} is required`)
  return value
}

function dynamicsOrigin(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || (url.hostname !== 'dynamics.com' && !url.hostname.endsWith('.dynamics.com'))) {
    throw new Error('Dynamics instanceUrl must be an HTTPS endpoint on dynamics.com')
  }
  return url.origin
}

function expiry(value: unknown): Record<string, string> {
  const seconds = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(seconds) && seconds > 0 ? { expiresAt: new Date(Date.now() + seconds * 1000).toISOString() } : {}
}

function providerOrigin(value: string | undefined, suffixes: string[], label: string): string {
  if (!value) throw new Error(`${label} is required`)
  const url = new URL(value)
  if (url.protocol !== 'https:' || !suffixes.some((suffix) => url.hostname === suffix || url.hostname.endsWith(`.${suffix}`))) {
    throw new Error(`${label} must be an approved HTTPS provider host`)
  }
  return url.origin
}
