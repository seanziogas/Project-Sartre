import { z } from 'zod'

export const PortalRole = z.enum(['internal_admin', 'gtme', 'client_approver', 'client_viewer'])
export type PortalRole = z.infer<typeof PortalRole>

export const PortalGrant = z.object({
  clientId: z.string().min(1),
  role: PortalRole,
})
export type PortalGrant = z.infer<typeof PortalGrant>

export const PortalIdentity = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  grants: z.array(PortalGrant).default([]),
})
export type PortalIdentity = z.infer<typeof PortalIdentity>

export const PortalAccessConfig = z.object({
  version: z.literal(1),
  identities: z.array(PortalIdentity),
})
export type PortalAccessConfig = z.infer<typeof PortalAccessConfig>

export type PortalPermission = 'view' | 'copilot' | 'approve' | 'connect' | 'manage'

export function roleForClient(identity: PortalIdentity, clientId: string): PortalRole | null {
  const admin = identity.grants.find((grant) => grant.role === 'internal_admin')
  if (admin) return 'internal_admin'
  return identity.grants.find((grant) => grant.clientId === clientId)?.role ?? null
}

export function canAccessClient(identity: PortalIdentity, clientId: string, permission: PortalPermission): boolean {
  const role = roleForClient(identity, clientId)
  if (!role) return false
  if (permission === 'view' || permission === 'copilot') return true
  if (permission === 'manage') return role === 'internal_admin' || role === 'gtme'
  return role === 'internal_admin' || role === 'gtme' || role === 'client_approver'
}

/** Brain changes remain internal; designated client approvers may approve operational effects. */
export function canDecideOutputClass(
  identity: PortalIdentity,
  clientId: string,
  outputClass: string,
): boolean {
  const role = roleForClient(identity, clientId)
  if (role === 'internal_admin' || role === 'gtme') return true
  if (role !== 'client_approver') return false
  return ['internal_report', 'client_comms', 'crm_write', 'outbound_send'].includes(outputClass)
}
