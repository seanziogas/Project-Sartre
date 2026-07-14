import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { z } from 'zod'

export const ConnectionAuthKind = z.enum(['api_key', 'oauth', 'service_account'])
export type ConnectionAuthKind = z.infer<typeof ConnectionAuthKind>

export const ToolConnectionInput = z.object({
  provider: z.string().trim().min(1).max(80),
  authKind: ConnectionAuthKind,
  label: z.string().trim().min(1).max(120),
  credentials: z.record(z.string(), z.string().min(1)).refine((value) => Object.keys(value).length > 0, 'credentials are required'),
  metadata: z.record(z.string(), z.string()).default({}),
})
export type ToolConnectionInput = z.infer<typeof ToolConnectionInput>

export interface ToolConnectionSummary {
  connectionId: string
  clientId: string
  provider: string
  authKind: ConnectionAuthKind
  label: string
  status: 'active' | 'revoked'
  metadata: Record<string, string>
  createdAt: string
  updatedAt: string
}

export type ToolConnectionEventKind = 'connected' | 'rotated' | 'tested' | 'revoked'

export interface ToolConnectionEvent {
  eventId: string
  connectionId: string
  clientId: string
  kind: ToolConnectionEventKind
  actor: string
  detail: string
  occurredAt: string
}

export type CredentialKeyConfig = string | {
  currentKeyId: string
  keys: Record<string, string>
  legacyKey?: string
}

/** AES-256-GCM envelope. The encryption key is deployment state, never client/git state. */
export class CredentialVault {
  private readonly keys = new Map<string, Buffer>()
  private readonly currentKeyId: string | null
  private readonly legacyKey: Buffer | null

  constructor(config: CredentialKeyConfig) {
    if (typeof config === 'string') {
      this.currentKeyId = null
      this.legacyKey = parseKey(config)
      return
    }
    if (!validKeyId(config.currentKeyId) || !config.keys[config.currentKeyId]) throw new Error('credential current key id must be URL-safe and exist in the keyring')
    for (const [id, value] of Object.entries(config.keys)) {
      if (!validKeyId(id)) throw new Error('credential key ids must be 1-64 URL-safe characters')
      this.keys.set(id, parseKey(value))
    }
    this.currentKeyId = config.currentKeyId
    this.legacyKey = config.legacyKey ? parseKey(config.legacyKey) : null
  }

  seal(credentials: Record<string, string>, tenantContext = ''): string {
    const parsed = z.record(z.string(), z.string().min(1)).parse(credentials)
    const iv = randomBytes(12)
    const key = this.currentKeyId ? this.keys.get(this.currentKeyId)! : this.legacyKey!
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(Buffer.from(tenantContext, 'utf8'))
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(parsed), 'utf8'), cipher.final()])
    return this.currentKeyId
      ? ['v2', this.currentKeyId, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.')
      : ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.')
  }

  open(envelope: string, tenantContext = ''): Record<string, string> {
    const parts = envelope.split('.')
    const version = parts[0]
    const keyId = version === 'v2' ? parts[1] : null
    const offset = version === 'v2' ? 2 : 1
    const [ivText, tagText, encryptedText] = parts.slice(offset)
    const key = version === 'v2' && keyId ? this.keys.get(keyId) : version === 'v1' ? this.legacyKey : undefined
    if (!key || !ivText || !tagText || !encryptedText) throw new Error('invalid credential envelope or unavailable key id')
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'))
    decipher.setAAD(Buffer.from(tenantContext, 'utf8'))
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
    const clear = Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
    return z.record(z.string(), z.string().min(1)).parse(JSON.parse(clear))
  }

  needsRotation(envelope: string): boolean {
    return this.currentKeyId !== null && !envelope.startsWith(`v2.${this.currentKeyId}.`)
  }
}

export function credentialKeyConfigFromEnvironment(environment: NodeJS.ProcessEnv): CredentialKeyConfig | undefined {
  const legacyKey = environment.SARTRE_CREDENTIAL_ENCRYPTION_KEY
  const encoded = environment.SARTRE_CREDENTIAL_ENCRYPTION_KEYS
  const currentKeyId = environment.SARTRE_CREDENTIAL_CURRENT_KEY_ID
  if (!encoded && !currentKeyId) return legacyKey
  if (!encoded || !currentKeyId) throw new Error('SARTRE_CREDENTIAL_ENCRYPTION_KEYS and SARTRE_CREDENTIAL_CURRENT_KEY_ID must be configured together')
  let keys: unknown
  try { keys = JSON.parse(encoded) } catch { throw new Error('SARTRE_CREDENTIAL_ENCRYPTION_KEYS must be a JSON object') }
  const parsed = z.record(z.string(), z.string().min(1)).parse(keys)
  return { currentKeyId, keys: parsed, ...(legacyKey ? { legacyKey } : {}) }
}

function parseKey(value: string): Buffer {
  const key = Buffer.from(value, 'base64')
  if (key.length !== 32) throw new Error('credential encryption keys must be 32 bytes encoded as base64')
  return key
}

function validKeyId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value)
}
