import { describe, expect, it } from 'vitest'
import { CredentialVault } from '@sartre/connectors'
import type { StoredToolConnection } from '@sartre/db'
import { TenantConnectionResolver } from '../src/connections.js'

const key = Buffer.alloc(32, 11).toString('base64')

function storeWith(connection: StoredToolConnection) {
  return {
    list: async (clientId: string) => clientId === connection.clientId ? [{
      connectionId: connection.connectionId,
      clientId: connection.clientId,
      provider: connection.provider,
      authKind: connection.authKind,
      label: connection.label,
      status: connection.status,
      metadata: connection.metadata,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    }] : [],
    get: async (clientId: string, connectionId: string) =>
      clientId === connection.clientId && connectionId === connection.connectionId ? connection : null,
  }
}

describe('TenantConnectionResolver', () => {
  it('decrypts only an explicitly tenant-scoped connection at execution time', async () => {
    const connection: StoredToolConnection = {
      connectionId: 'connection-1', clientId: 'Acme', provider: 'salesforce', authKind: 'oauth',
      label: 'CRM', status: 'active', metadata: {},
      encryptedCredentials: new CredentialVault(key).seal({ refreshToken: 'test-token' }, 'Acme'),
      createdAt: '2026-07-13T12:00:00Z', updatedAt: '2026-07-13T12:00:00Z',
    }
    const resolver = new TenantConnectionResolver(storeWith(connection) as never, key)
    expect((await resolver.resolveProvider('Acme', 'salesforce')).credentials).toEqual({ refreshToken: 'test-token' })
    await expect(resolver.resolveProvider('OtherClient', 'salesforce')).rejects.toThrow('not found')
  })

  it('does not require the encryption key until credentials are used', async () => {
    const connection: StoredToolConnection = {
      connectionId: 'connection-1', clientId: 'Acme', provider: 'salesforce', authKind: 'api_key',
      label: 'CRM', status: 'active', metadata: {}, encryptedCredentials: 'sealed',
      createdAt: '2026-07-13T12:00:00Z', updatedAt: '2026-07-13T12:00:00Z',
    }
    const resolver = new TenantConnectionResolver(storeWith(connection) as never)
    expect(await resolver.list('Acme')).toHaveLength(1)
    await expect(resolver.resolve('Acme', 'connection-1')).rejects.toThrow('SARTRE_CREDENTIAL_ENCRYPTION_KEY')
  })

  it('constructs provider clients from only the current tenant connection', async () => {
    const connection: StoredToolConnection = {
      connectionId: 'connection-2', clientId: 'Acme', provider: 'slack', authKind: 'oauth',
      label: 'Slack', status: 'active', metadata: {},
      encryptedCredentials: new CredentialVault(key).seal({ accessToken: 'fake-token' }, 'Acme'),
      createdAt: '2026-07-13T12:00:00Z', updatedAt: '2026-07-13T12:00:00Z',
    }
    const resolver = new TenantConnectionResolver(storeWith(connection) as never, key)
    const client = await resolver.providerClient('Acme', 'slack', { request: async () => ({ status: 200, body: { ok: true, team_id: 'T1' }, headers: {} }) })
    expect((await client.testConnection()).accountRef).toBe('T1')
    await expect(resolver.providerClient('OtherClient', 'slack')).rejects.toThrow('not found')
  })

  it('does not refresh an OAuth access token before its expiry window', async () => {
    const connection: StoredToolConnection = {
      connectionId: 'connection-3', clientId: 'Acme', provider: 'slack', authKind: 'oauth',
      label: 'Slack', status: 'active', metadata: {},
      encryptedCredentials: new CredentialVault(key).seal({
        accessToken: 'fake-token', refreshToken: 'fake-refresh', clientId: 'client', clientSecret: 'secret',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }, 'Acme'),
      createdAt: '2026-07-13T12:00:00Z', updatedAt: '2026-07-13T12:00:00Z',
    }
    const resolver = new TenantConnectionResolver(storeWith(connection) as never, key)
    const client = await resolver.providerClient('Acme', 'slack', { request: async () => { throw new Error('token endpoint must not be called') } })
    expect(client.info.id).toBe('slack')
  })
})
