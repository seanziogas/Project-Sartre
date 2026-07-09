import { describe, expect, it } from 'vitest'
import { fillSlots, generateCampaign, selectReviewSamples } from '../src/campaign-factory.js'
import type { CampaignRow, CampaignTemplates } from '../src/campaign-factory.js'

const TEMPLATES: CampaignTemplates = {
  email1: {
    'timing-check-in': {
      subjects: ['Checking back in', 'Is the timing better now?'],
      body: 'Hi {{first_name}}, when we last connected with {{company_name}}, {opp_detail}. Worth a fresh look?',
    },
    'general-re-engage': {
      subjects: ['Reconnecting'],
      body: 'Hi {{first_name}}, circling back on {opp_short}.',
    },
  },
  email2: {
    fleet: { subjects: ['Fleet proof point'], body: 'Teams like yours cut costs with {proof}.' },
    catchall: { subjects: ['One more thought'], body: 'Companies in your space use {proof}.' },
  },
  email3: [
    { subjects: ['Closing the loop'], body: 'Last note from me, {{first_name}}.' },
    { subjects: ['Should I stop?'], body: 'I will stop here unless the timing changes.' },
  ],
  slotDefaults: {
    opp_detail: 'we discussed your connectivity plans',
    opp_short: 'our earlier conversation',
    proof: 'our platform',
  },
  fallbackPlay: 'general-re-engage',
  fallbackGroup: 'catchall',
}

function row(over: Partial<CampaignRow> & { id: string }): CampaignRow {
  return { play: 'timing-check-in', group: 'fleet', slots: {}, ...over }
}

describe('generateCampaign — eval set (deterministic, exact answers)', () => {
  it('fills mined slots and leaves merge tags for the sequencer', () => {
    const result = generateCampaign(
      [row({ id: '1', slots: { opp_detail: 'you wanted 500 SIMs but lost budget', proof: 'Verkada' } })],
      TEMPLATES,
    )
    const [e1, e2] = result.rows[0]!.emails!
    expect(e1.body).toBe(
      'Hi {{first_name}}, when we last connected with {{company_name}}, you wanted 500 SIMs but lost budget. Worth a fresh look?',
    )
    expect(e2.body).toBe('Teams like yours cut costs with Verkada.')
    expect(result.rows[0]!.defaultedSlots).toEqual([])
  })

  it('falls back to slot defaults conservatively, and reports it', () => {
    const result = generateCampaign([row({ id: '1' })], TEMPLATES)
    expect(result.rows[0]!.emails![0]!.body).toContain('we discussed your connectivity plans')
    expect(result.rows[0]!.defaultedSlots).toEqual(['opp_detail', 'proof'])
  })

  it('rotates subjects and breakup variants by row index', () => {
    const rows = [row({ id: '1' }), row({ id: '2' }), row({ id: '3' })]
    const result = generateCampaign(rows, TEMPLATES)
    expect(result.rows[0]!.emails![0]!.subject).toBe('Checking back in')
    expect(result.rows[1]!.emails![0]!.subject).toBe('Is the timing better now?')
    expect(result.rows[2]!.emails![0]!.subject).toBe('Checking back in')
    expect(result.rows[0]!.emails![2]!.subject).toBe('Closing the loop')
    expect(result.rows[1]!.emails![2]!.subject).toBe('Should I stop?')
  })

  it('routes unknown plays/groups to fallback templates', () => {
    const result = generateCampaign([row({ id: '1', play: 'unknown-play', group: 'space-lasers' })], TEMPLATES)
    expect(result.rows[0]!.emails![0]!.body).toContain('circling back')
    expect(result.rows[0]!.emails![1]!.body).toContain('Companies in your space')
  })

  it('blanks DNC rows', () => {
    const result = generateCampaign([row({ id: '1', doNotContact: true }), row({ id: '2' })], TEMPLATES)
    expect(result.rows[0]!.emails).toBeNull()
    expect(result.skippedDnc).toBe(1)
    expect(result.reviewSampleIds).toEqual(['2'])
  })

  it('throws on a slot with no value and no default (never silently ships a hole)', () => {
    const templates = { ...TEMPLATES, slotDefaults: {} }
    expect(() => generateCampaign([row({ id: '1' })], templates)).toThrow('{opp_detail}')
  })
})

describe('selectReviewSamples', () => {
  it('covers plays first, then groups, then tiers', () => {
    const rows: CampaignRow[] = [
      row({ id: 'p1', play: 'timing-check-in', group: 'fleet', tier: 'enterprise' }),
      row({ id: 'p2', play: 'general-re-engage', group: 'fleet', tier: 'small' }),
      row({ id: 'g1', play: 'timing-check-in', group: 'catchall', tier: 'small' }),
      row({ id: 't1', play: 'timing-check-in', group: 'fleet', tier: 'small' }),
      row({ id: 'x1', play: 'timing-check-in', group: 'fleet', tier: 'enterprise' }),
    ]
    const sample = selectReviewSamples(rows, 4)
    expect(sample.slice(0, 2)).toEqual(['p1', 'p2']) // both plays
    expect(sample).toContain('g1') // second group
    expect(sample).toContain('t1') // uncovered tier
    expect(sample).not.toContain('x1')
  })
})
