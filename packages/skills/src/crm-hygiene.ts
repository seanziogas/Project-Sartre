import { z } from 'zod'

export const HygieneRecord = z.object({
  id: z.string().min(1),
  email: z.string().nullable().default(null),
  domain: z.string().nullable().default(null),
  name: z.string().nullable().default(null),
})
export type HygieneRecord = z.infer<typeof HygieneRecord>

export interface HygieneResult {
  normalized: HygieneRecord[]
  duplicateGroups: string[][]
  invalid: { id: string; field: 'email' | 'domain'; value: string }[]
}

export function inspectHygiene(records: HygieneRecord[]): HygieneResult {
  const normalized = records.map((raw) => {
    const record = HygieneRecord.parse(raw)
    return {
      ...record,
      email: record.email?.trim().toLowerCase() || null,
      domain: record.domain?.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || null,
      name: record.name?.trim().replace(/\s+/g, ' ') || null,
    }
  })
  const invalid: HygieneResult['invalid'] = []
  const identities = new Map<string, string[]>()
  for (const record of normalized) {
    if (record.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(record.email)) invalid.push({ id: record.id, field: 'email', value: record.email })
    if (record.domain && (!record.domain.includes('.') || /\s/.test(record.domain))) invalid.push({ id: record.id, field: 'domain', value: record.domain })
    const identity = record.email ? `email:${record.email}` : record.domain ? `domain:${record.domain}` : null
    if (identity) identities.set(identity, [...(identities.get(identity) ?? []), record.id])
  }
  return { normalized, duplicateGroups: [...identities.values()].filter((ids) => ids.length > 1), invalid }
}
