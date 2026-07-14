import { createHash } from 'node:crypto'
import { z } from 'zod'
import { TenantId } from './governance.js'

const PortableRecord = z.object({ category: z.string().min(1), rows: z.array(z.unknown()) })
export const TenantPortabilityBundle = z.object({
  format: z.literal('sartre-portability'), version: z.literal(1), clientId: TenantId, exportedAt: z.string().datetime(),
  includesCredentials: z.literal(false), files: z.record(z.string(), z.string()), records: z.array(PortableRecord), checksum: z.string().regex(/^[a-f0-9]{64}$/),
})
export type TenantPortabilityBundle = z.infer<typeof TenantPortabilityBundle>

export function createPortabilityBundle(clientId: string, files: Record<string, string>, records: Array<{ category: string; rows: unknown[] }>, exportedAt = new Date().toISOString()): TenantPortabilityBundle {
  assertPortableFiles(files)
  const base = { format: 'sartre-portability' as const, version: 1 as const, clientId, exportedAt, includesCredentials: false as const, files, records }
  return TenantPortabilityBundle.parse({ ...base, checksum: bundleChecksum(base) })
}

export function verifyPortabilityBundle(value: unknown): TenantPortabilityBundle {
  const bundle = TenantPortabilityBundle.parse(value)
  const { checksum: _checksum, ...base } = bundle
  if (bundleChecksum(base) !== bundle.checksum) throw new Error('portability bundle checksum mismatch')
  assertPortableFiles(bundle.files)
  return bundle
}

function assertPortableFiles(files: Record<string, string>): void {
  for (const path of Object.keys(files)) {
    if (path.startsWith('/') || path.includes('..') || path.includes('credentials') || path.includes('.env')) throw new Error(`unsafe portability file path ${path}`)
  }
}

function bundleChecksum(value: unknown): string { return createHash('sha256').update(stableJson(value)).digest('hex') }
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  return JSON.stringify(value)
}
