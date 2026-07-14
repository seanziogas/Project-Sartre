import { CredentialVault } from '@sartre/connectors'
import type { CredentialKeyConfig } from '@sartre/connectors'

const STATE_TTL_MS = 10 * 60_000

export interface OAuthStateInput extends Record<string, string> {
  clientId: string
  provider: string
  actor: string
  label: string
  oauthClientId: string
  oauthClientSecret: string
  redirectUri: string
}

export function sealOAuthState(
  key: CredentialKeyConfig,
  input: OAuthStateInput,
  now = Date.now(),
): string {
  const payload = new CredentialVault(key).seal({
    ...input,
    expiresAt: new Date(now + STATE_TTL_MS).toISOString(),
  }, input.clientId)
  return `${Buffer.from(input.clientId).toString('base64url')}.${payload}`
}

export function openOAuthState(
  key: CredentialKeyConfig,
  state: string,
  now = Date.now(),
): { clientId: string; payload: Record<string, string> } {
  const separator = state.indexOf('.')
  if (separator < 1) throw new Error('invalid OAuth state')
  const prefix = state.slice(0, separator)
  const clientId = Buffer.from(prefix, 'base64url').toString('utf8')
  if (!clientId || Buffer.from(clientId).toString('base64url') !== prefix) throw new Error('invalid OAuth state')

  const payload = new CredentialVault(key).open(state.slice(separator + 1), clientId)
  const expiresAt = Date.parse(payload.expiresAt ?? '')
  if (payload.clientId !== clientId || !Number.isFinite(expiresAt) || expiresAt < now) {
    throw new Error('expired OAuth state')
  }
  for (const field of ['provider', 'actor', 'label', 'oauthClientId', 'oauthClientSecret', 'redirectUri']) {
    if (!payload[field]) throw new Error('invalid OAuth state')
  }
  return { clientId, payload }
}
