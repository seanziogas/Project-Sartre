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
})
