import { describe, expect, it } from 'vitest'
import { exchangeOAuthCode, oauthAuthorizationUrl, refreshOAuthToken } from '../src/oauth.js'
import type { HttpRequest, HttpTransport } from '../src/http.js'

describe('provider OAuth', () => {
  it('builds state-bearing provider authorization URLs with minimum scopes', () => {
    const slack = new URL(oauthAuthorizationUrl('slack', { clientId: 'client', redirectUri: 'https://sartre.example/callback', state: 'signed-state' }))
    expect(slack.origin + slack.pathname).toBe('https://slack.com/oauth/v2/authorize')
    expect(slack.searchParams.get('state')).toBe('signed-state')
    expect(slack.searchParams.get('scope')).toContain('chat:write')
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
