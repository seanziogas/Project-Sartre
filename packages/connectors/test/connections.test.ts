import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CredentialVault, ToolConnectionInput } from '../src/connections.js'

describe('tenant tool connection credentials', () => {
  it('encrypts credentials with authenticated encryption and rejects the wrong key', () => {
    const vault = new CredentialVault(randomBytes(32).toString('base64'))
    const envelope = vault.seal({ apiKey: 'fake-test-key', account: 'sandbox' })
    expect(envelope).not.toContain('fake-test-key')
    expect(vault.open(envelope)).toEqual({ apiKey: 'fake-test-key', account: 'sandbox' })
    expect(() => new CredentialVault(randomBytes(32).toString('base64')).open(envelope)).toThrow()
  })

  it('binds an envelope to its tenant context', () => {
    const vault = new CredentialVault(randomBytes(32).toString('base64'))
    const envelope = vault.seal({ apiKey: 'fake-test-key' }, 'Acme')
    expect(vault.open(envelope, 'Acme')).toEqual({ apiKey: 'fake-test-key' })
    expect(() => vault.open(envelope, 'OtherClient')).toThrow()
  })

  it('requires a labeled provider and at least one secret field', () => {
    expect(ToolConnectionInput.parse({
      provider: 'salesforce', authKind: 'oauth', label: 'Production CRM', credentials: { refreshToken: 'fake' }, metadata: {},
    }).provider).toBe('salesforce')
    expect(() => ToolConnectionInput.parse({ provider: 'salesforce', authKind: 'oauth', label: 'CRM', credentials: {} })).toThrow()
  })
})
