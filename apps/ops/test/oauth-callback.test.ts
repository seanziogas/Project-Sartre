import { describe, expect, it } from 'vitest'
import { handleOAuthCallback } from '../src/lib/oauth-callback.js'
import { sealOAuthState } from '../src/lib/oauth-state.js'
import type { OAuthCallbackDependencies } from '../src/lib/oauth-callback.js'

const key = Buffer.alloc(32, 4).toString('base64')
const now = 1_000

function state(actor = 'operator@example.com') {
  return sealOAuthState(key, {
    clientId: 'acme', provider: 'hubspot', actor, label: 'Acme HubSpot',
    oauthClientId: 'client-id', oauthClientSecret: 'client-secret',
    redirectUri: 'https://sartre.example/api/connections/oauth/callback',
  }, now)
}

function dependencies(overrides: Partial<OAuthCallbackDependencies> = {}): OAuthCallbackDependencies {
  return {
    encryptionKey: key,
    getIdentity: async () => ({ email: 'operator@example.com' }),
    assertAccess: () => {},
    getManifest: async () => ({ commercial: { status: 'active' } }),
    exchange: async () => ({ accessToken: 'token', refreshToken: 'refresh' }),
    connect: async () => ({}),
    now: () => now + 1,
    ...overrides,
  }
}

function request(params: Record<string, string>) {
  const url = new URL('https://sartre.example/api/connections/oauth/callback')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return new Request(url)
}

describe('OAuth callback orchestration', () => {
  it('records a valid tenant connection and redirects', async () => {
    const saved: unknown[] = []
    const response = await handleOAuthCallback(request({ code: 'code', state: state() }), dependencies({
      connect: async (...args) => { saved.push(args); return {} },
    }))
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://sartre.example/clients/acme/connections')
    expect(saved).toMatchObject([['acme', { provider: 'hubspot', authKind: 'oauth', label: 'Acme HubSpot' }, 'operator@example.com']])
  })

  it('handles provider denial without attempting exchange', async () => {
    let exchanged = false
    const response = await handleOAuthCallback(request({ error: 'access_denied', state: state() }), dependencies({
      exchange: async () => { exchanged = true; return {} },
    }))
    expect(response.status).toBe(400)
    expect(exchanged).toBe(false)
  })

  it('rejects expired state, actor changes, and inactive subscriptions', async () => {
    expect((await handleOAuthCallback(request({ code: 'code', state: state() }), dependencies({ now: () => now + 10 * 60_000 + 1 }))).status).toBe(400)
    expect((await handleOAuthCallback(request({ code: 'code', state: state('other@example.com') }), dependencies())).status).toBe(403)
    expect((await handleOAuthCallback(request({ code: 'code', state: state() }), dependencies({ getManifest: async () => ({ commercial: { status: 'past_due' } }) }))).status).toBe(403)
  })

  it('returns a bounded failure without saving when token exchange fails', async () => {
    let saved = false
    const response = await handleOAuthCallback(request({ code: 'code', state: state() }), dependencies({
      exchange: async () => { throw new Error('provider secret detail') },
      connect: async () => { saved = true },
    }))
    expect(response.status).toBe(502)
    expect(await response.text()).toBe('OAuth token exchange failed')
    expect(saved).toBe(false)
  })
})
