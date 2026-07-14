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

  it('reads legacy envelopes and rotates to the current versioned key', () => {
    const oldKey = randomBytes(32).toString('base64')
    const newKey = randomBytes(32).toString('base64')
    const legacy = new CredentialVault(oldKey).seal({ apiKey: 'fake-test-key' }, 'Acme')
    const keyring = new CredentialVault({ currentKeyId: '2026-07', keys: { '2026-07': newKey }, legacyKey: oldKey })
    expect(keyring.open(legacy, 'Acme')).toEqual({ apiKey: 'fake-test-key' })
    expect(keyring.needsRotation(legacy)).toBe(true)
    const rotated = keyring.seal(keyring.open(legacy, 'Acme'), 'Acme')
    expect(rotated.startsWith('v2.2026-07.')).toBe(true)
    expect(keyring.needsRotation(rotated)).toBe(false)
    expect(keyring.open(rotated, 'Acme')).toEqual({ apiKey: 'fake-test-key' })
  })

  it('rejects key IDs that cannot be represented safely in an envelope', () => {
    const key = Buffer.alloc(32, 1).toString('base64')
    expect(() => new CredentialVault({ currentKeyId: 'bad.key', keys: { 'bad.key': key } })).toThrow('URL-safe')
  })

  it('requires a labeled provider and at least one secret field', () => {
    expect(ToolConnectionInput.parse({
      provider: 'salesforce', authKind: 'oauth', label: 'Production CRM', credentials: { refreshToken: 'fake' }, metadata: {},
    }).provider).toBe('salesforce')
    expect(() => ToolConnectionInput.parse({ provider: 'salesforce', authKind: 'oauth', label: 'CRM', credentials: {} })).toThrow()
  })
})
