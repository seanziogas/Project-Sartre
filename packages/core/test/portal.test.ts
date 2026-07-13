import { describe, expect, it } from 'vitest'
import { canAccessClient, canDecideOutputClass, PortalAccessConfig } from '../src/portal.js'

const config = PortalAccessConfig.parse({
  version: 1,
  identities: [
    { id: 'admin', email: 'admin@kiln.example', name: 'Admin', grants: [{ clientId: '*', role: 'internal_admin' }] },
    { id: 'gtme', email: 'gtme@kiln.example', name: 'GTME', grants: [{ clientId: 'Acme', role: 'gtme' }] },
    { id: 'approver', email: 'buyer@acme.example', name: 'Buyer', grants: [{ clientId: 'Acme', role: 'client_approver' }] },
    { id: 'viewer', email: 'viewer@acme.example', name: 'Viewer', grants: [{ clientId: 'Acme', role: 'client_viewer' }] },
  ],
})

describe('portal authorization', () => {
  it('enforces tenant-scoped view and copilot access', () => {
    expect(canAccessClient(config.identities[1]!, 'Acme', 'view')).toBe(true)
    expect(canAccessClient(config.identities[1]!, 'Other', 'view')).toBe(false)
    expect(canAccessClient(config.identities[3]!, 'Acme', 'copilot')).toBe(true)
    expect(canAccessClient(config.identities[0]!, 'AnyClient', 'copilot')).toBe(true)
  })

  it('keeps brain changes internal while allowing designated operational approvals', () => {
    const approver = config.identities[2]!
    expect(canDecideOutputClass(approver, 'Acme', 'crm_write')).toBe(true)
    expect(canDecideOutputClass(approver, 'Acme', 'brain_change')).toBe(false)
    expect(canDecideOutputClass(config.identities[1]!, 'Acme', 'brain_change')).toBe(true)
    expect(canDecideOutputClass(approver, 'Other', 'outbound_send')).toBe(false)
  })
})
