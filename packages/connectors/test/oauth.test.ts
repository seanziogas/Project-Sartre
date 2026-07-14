import { describe, expect, it } from 'vitest'
import { createOAuthPkce, exchangeOAuthCode, oauthAuthorizationUrl, refreshOAuthToken } from '../src/oauth.js'
import type { HttpRequest, HttpTransport } from '../src/http.js'

describe('provider OAuth', () => {
  it('binds authorization codes with S256 PKCE', async () => {
    const pkce = createOAuthPkce()
    const authorization = new URL(oauthAuthorizationUrl('hubspot', {
      clientId: 'client', redirectUri: 'https://sartre.example/callback', state: 'state', codeChallenge: pkce.codeChallenge,
    }))
    expect(authorization.searchParams.get('code_challenge')).toBe(pkce.codeChallenge)
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorization.toString()).not.toContain(pkce.codeVerifier)
    let body = ''
    await exchangeOAuthCode('hubspot', {
      clientId: 'client', clientSecret: 'secret', redirectUri: 'https://sartre.example/callback', state: 'state', code: 'code', codeVerifier: pkce.codeVerifier,
    }, { request: async (request) => { body = request.body ?? ''; return { status: 200, body: { access_token: 'token' }, headers: {} } } })
    expect(new URLSearchParams(body).get('code_verifier')).toBe(pkce.codeVerifier)
  })
  it('builds state-bearing provider authorization URLs with minimum scopes', () => {
    const slack = new URL(oauthAuthorizationUrl('slack', { clientId: 'client', redirectUri: 'https://sartre.example/callback', state: 'signed-state' }))
    expect(slack.origin + slack.pathname).toBe('https://slack.com/oauth/v2/authorize')
    expect(slack.searchParams.get('state')).toBe('signed-state')
    expect(slack.searchParams.get('scope')).toContain('chat:write')
    const fathom = new URL(oauthAuthorizationUrl('fathom', {
      clientId: 'client', redirectUri: 'https://sartre.example/callback', state: 'signed-state',
      loginUrl: 'https://app.fathom.video/oauth/authorize',
    }))
    expect(fathom.hostname).toBe('app.fathom.video')
    expect(fathom.searchParams.get('state')).toBe('signed-state')
    const attio = new URL(oauthAuthorizationUrl('attio', { clientId: 'client', redirectUri: 'https://sartre.example/callback', state: 'signed-state' }))
    expect(attio.origin + attio.pathname).toBe('https://app.attio.com/authorize')
    const gmail = new URL(oauthAuthorizationUrl('gmail', { clientId: 'client', redirectUri: 'https://sartre.example/callback', state: 'signed-state' }))
    expect(gmail.searchParams.get('access_type')).toBe('offline')
    expect(gmail.searchParams.get('scope')).toContain('gmail.send')
    const dynamics = new URL(oauthAuthorizationUrl('dynamics', {
      clientId: 'client', redirectUri: 'https://sartre.example/callback', state: 'signed-state',
      instanceUrl: 'https://acme.crm.dynamics.com', tenant: 'tenant-id',
    }))
    expect(dynamics.pathname).toContain('/tenant-id/oauth2/v2.0/authorize')
    expect(dynamics.searchParams.get('scope')).toContain('https://acme.crm.dynamics.com/user_impersonation')
    expect(() => oauthAuthorizationUrl('dynamics', {
      clientId: 'client', redirectUri: 'https://sartre.example/callback', state: 'signed-state', instanceUrl: 'https://attacker.example',
    })).toThrow('dynamics.com')
    const snowflake = new URL(oauthAuthorizationUrl('snowflake', { clientId: 'client', redirectUri: 'https://sartre.example/callback', state: 'signed-state', accountUrl: 'https://acme.snowflakecomputing.com' }))
    expect(snowflake.origin + snowflake.pathname).toBe('https://acme.snowflakecomputing.com/oauth/authorize')
    const databricks = new URL(oauthAuthorizationUrl('databricks', { clientId: 'client', redirectUri: 'https://sartre.example/callback', state: 'signed-state', workspaceUrl: 'https://acme.cloud.databricks.com' }))
    expect(databricks.pathname).toBe('/oidc/v1/authorize')
    expect(() => oauthAuthorizationUrl('snowflake', { clientId: 'client', redirectUri: 'https://sartre.example/callback', state: 'state', accountUrl: 'https://attacker.example' })).toThrow('approved HTTPS provider host')
  })

  it('exchanges Gong authorization codes with Basic client authentication and captures the tenant API host', async () => {
    let request: HttpRequest | undefined
    const credentials = await exchangeOAuthCode('gong', {
      clientId: 'client', clientSecret: 'secret', code: 'code', redirectUri: 'https://sartre.example/callback', state: 'verified',
    }, { request: async (value) => {
      request = value
      return { status: 200, body: { access_token: 'access', refresh_token: 'refresh', expires_in: 3600, api_base_url_for_customer: 'https://acme.api.gong.io' }, headers: {} }
    } })
    expect(request!.headers?.Authorization).toBe(`Basic ${Buffer.from('client:secret').toString('base64')}`)
    expect(request!.body).toContain('client_id=client')
    expect(credentials).toMatchObject({ accessToken: 'access', refreshToken: 'refresh', baseUrl: 'https://acme.api.gong.io' })
  })

  it('records token expiry when providers return expires_in as a string', async () => {
    const before = Date.now()
    const credentials = await exchangeOAuthCode('linkedin-ads', {
      clientId: 'client', clientSecret: 'secret', code: 'code', redirectUri: 'https://sartre.example/callback', state: 'verified',
    }, { request: async () => ({ status: 200, body: { access_token: 'fake-access', expires_in: '3600' }, headers: {} }) })
    expect(Date.parse(credentials.expiresAt!)).toBeGreaterThanOrEqual(before + 3_599_000)
  })

  it('uses Basic client authentication for Pipedrive token exchange', async () => {
    let request: HttpRequest | undefined
    await exchangeOAuthCode('pipedrive', {
      clientId: 'client', clientSecret: 'secret', code: 'code', redirectUri: 'https://sartre.example/callback', state: 'verified',
    }, { request: async (value) => {
      request = value
      return { status: 200, body: { access_token: 'fake-access', refresh_token: 'fake-refresh', expires_in: 7200 }, headers: {} }
    } })
    expect(request!.headers?.Authorization).toBe(`Basic ${Buffer.from('client:secret').toString('base64')}`)
    expect(request!.body).not.toContain('secret')
  })

  it('exchanges callback codes with secrets only in a form body', async () => {
    let request: HttpRequest | undefined
    const http: HttpTransport = { request: async (value) => {
      request = value
      return { status: 200, body: { access_token: 'fake-access', refresh_token: 'fake-refresh', instance_url: 'https://acme.my.salesforce.com' }, headers: {} }
    } }
    const credentials = await exchangeOAuthCode('salesforce', {
      clientId: 'client', clientSecret: 'secret', code: 'code', redirectUri: 'https://sartre.example/callback', state: 'verified',
    }, http)
    expect(credentials).toMatchObject({ accessToken: 'fake-access', refreshToken: 'fake-refresh', instanceUrl: 'https://acme.my.salesforce.com' })
    expect(request!.url).not.toContain('secret')
    expect(request!.body).toContain('client_secret=secret')
  })

  it('refreshes rotating OAuth tokens without putting secrets in the URL', async () => {
    let request: HttpRequest | undefined
    const refreshed = await refreshOAuthToken('fathom', {
      clientId: 'client', clientSecret: 'secret', refreshToken: 'old-refresh', accessToken: 'old-access',
    }, { request: async (value) => {
      request = value
      return { status: 200, body: { access_token: 'new-access', refresh_token: 'new-refresh' }, headers: {} }
    } })
    expect(refreshed).toMatchObject({ accessToken: 'new-access', refreshToken: 'new-refresh' })
    expect(request!.url).not.toContain('old-refresh')
    expect(request!.body).toContain('refresh_token=old-refresh')
  })
})
