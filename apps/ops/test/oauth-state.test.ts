import { describe, expect, it } from 'vitest'
import { openOAuthState, sealOAuthState } from '../src/lib/oauth-state.js'

const key = Buffer.alloc(32, 7).toString('base64')
const input = {
  clientId: 'acme',
  provider: 'hubspot',
  actor: 'operator@example.com',
  label: 'Acme HubSpot',
  oauthClientId: 'client-id',
  oauthClientSecret: 'client-secret',
  redirectUri: 'https://sartre.example/api/connections/oauth/callback',
}

describe('OAuth state envelope', () => {
  it('round trips only inside its tenant context', () => {
    const state = sealOAuthState(key, input, 1_000)
    expect(openOAuthState(key, state, 2_000)).toMatchObject({
      clientId: 'acme',
      payload: input,
    })

    const [, envelope] = state.split('.', 2)
    expect(() => openOAuthState(key, `${Buffer.from('other').toString('base64url')}.${envelope}`, 2_000)).toThrow()
  })

  it('rejects tampering and expiration', () => {
    const state = sealOAuthState(key, input, 1_000)
    expect(() => openOAuthState(key, `${state.slice(0, -1)}x`, 2_000)).toThrow()
    expect(() => openOAuthState(key, state, 1_000 + 10 * 60_000 + 1)).toThrow('expired OAuth state')
  })
})
