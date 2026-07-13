import { describe, expect, it } from 'vitest'
import { inspectHygiene } from '../src/crm-hygiene.js'
import { matchSignals } from '../src/signal-watcher.js'
import { draftEngagementDocument } from '../src/sow-qbr-generator.js'

describe('remaining shared skills', () => {
  it('normalizes and flags CRM records without deleting or merging', () => {
    const result = inspectHygiene([
      { id: '1', email: ' A@Example.com ', domain: 'https://www.example.com/', name: ' Acme  Inc ' },
      { id: '2', email: 'a@example.com', domain: null, name: null },
    ])
    expect(result.normalized[0]).toMatchObject({ email: 'a@example.com', domain: 'example.com', name: 'Acme Inc' })
    expect(result.duplicateGroups).toEqual([['1', '2']])
  })

  it('matches signals deterministically in declared rule order', () => {
    const result = matchSignals([{ id: 's1', accountId: 'a1', kind: 'pricing', strength: 80, occurredAt: '2026-07-13T00:00:00Z' }], [
      { id: 'high-intent', kinds: ['pricing'], minStrength: 70, play: 'executive-followup' },
    ])
    expect(result.matches[0]).toMatchObject({ ruleId: 'high-intent', play: 'executive-followup' })
  })

  it('generates a grounded SOW draft with exact evidence', async () => {
    const sourceContext = '=== transcript.md ===\nThe client selected inbound routing as the first track.'
    const result = await draftEngagementDocument({ kind: 'sow', sourceContext, allowedSources: ['transcript.md'] }, {
      complete: async () => JSON.stringify({ title: 'Draft SOW', markdown: '# Scope\nInbound routing.', citations: [{ source: 'transcript.md', evidence: 'selected inbound routing as the first track' }], status: 'draft' }),
    })
    expect(result.status).toBe('draft')
  })
})
