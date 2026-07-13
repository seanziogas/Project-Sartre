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

/** AES-256-GCM envelope. The encryption key is deployment state, never client/git state. */
export class CredentialVault {
  private readonly key: Buffer

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64')
    if (this.key.length !== 32) throw new Error('SARTRE_CREDENTIAL_ENCRYPTION_KEY must be 32 bytes encoded as base64')
  }

  seal(credentials: Record<string, string>, tenantContext = ''): string {
    const parsed = z.record(z.string(), z.string().min(1)).parse(credentials)
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(Buffer.from(tenantContext, 'utf8'))
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(parsed), 'utf8'), cipher.final()])
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.')
  }

  open(envelope: string, tenantContext = ''): Record<string, string> {
    const [version, ivText, tagText, encryptedText] = envelope.split('.')
    if (version !== 'v1' || !ivText || !tagText || !encryptedText) throw new Error('invalid credential envelope')
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivText, 'base64url'))
    decipher.setAAD(Buffer.from(tenantContext, 'utf8'))
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
    const clear = Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
    return z.record(z.string(), z.string().min(1)).parse(JSON.parse(clear))
  }
}
