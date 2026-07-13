import 'server-only'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { headers } from 'next/headers'
import {
  canAccessClient,
  canDecideOutputClass,
  PortalAccessConfig,
} from '@sartre/core'
import type { PortalIdentity, PortalPermission } from '@sartre/core'

/**
 * Authentication is delegated to a deployment-owned identity proxy. The proxy
 * must strip inbound x-sartre-user-id and inject the verified subject itself.
 * This app refuses to trust the header unless the deployment explicitly opts in.
 */
export async function getPortalIdentity(): Promise<PortalIdentity> {
  if (process.env.SARTRE_TRUSTED_AUTH_PROXY !== 'true') {
    throw new Error('SARTRE_TRUSTED_AUTH_PROXY=true is required for portal access')
  }
  const accessFile = process.env.SARTRE_PORTAL_ACCESS_FILE
  if (!accessFile) throw new Error('SARTRE_PORTAL_ACCESS_FILE is required for portal access')
  const userId = (await headers()).get('x-sartre-user-id')?.trim()
  if (!userId) throw new Error('authenticated portal identity is required')
  const config = PortalAccessConfig.parse(JSON.parse(await readFile(resolve(accessFile), 'utf8')))
  const identity = config.identities.find((candidate) => candidate.id === userId)
  if (!identity) throw new Error('authenticated identity has no Sartre access grant')
  return identity
}

export function assertClientAccess(
  identity: PortalIdentity,
  clientId: string,
  permission: PortalPermission,
): void {
  if (!canAccessClient(identity, clientId, permission)) throw new Error('client access denied')
}

export function mayDecideGate(identity: PortalIdentity, clientId: string, outputClass: string): boolean {
  return canDecideOutputClass(identity, clientId, outputClass)
}
