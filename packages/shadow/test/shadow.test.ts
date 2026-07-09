import { describe, expect, it } from 'vitest'
import { compareCopy, compareGrades, compareRouting, scoreToBand, shadowReport } from '../src/index.js'

describe('compareGrades', () => {
  const machine = [
    { id: '1', score: 85, labels: { industry: 'Fleet' } }, // A
    { id: '2', score: 70, labels: { industry: 'Healthcare' } }, // B
    { id: '3', score: 15, labels: { industry: 'Other' } }, // X
    { id: '4', score: 50, labels: { industry: 'Fleet' } }, // C — machine only
  ]
  const manual = [
    { id: '1', grade: 'A', labels: { industry: 'fleet' } }, // match (case-insensitive label)
    { id: '2', score: 78, labels: { industry: 'Retail' } }, // band match (B), label miss
    { id: '3', grade: 'B' }, // big disagreement (X vs B)
    { id: '9', grade: 'C' }, // manual only
  ]

  it('computes band/label agreement and surfaces disagreements', () => {
    const c = compareGrades(machine, manual)
    expect(c.compared).toBe(3)
    expect(c.onlyMachine).toEqual(['4'])
    expect(c.onlyManual).toEqual(['9'])
    expect(c.bandAgreement).toBeCloseTo(2 / 3)
    expect(c.labelAgreement.industry).toBeCloseTo(1 / 2)
    expect(c.meanAbsScoreDelta).toBe(8) // only row 2 has both scores
    expect(c.disagreements).toEqual([{ id: '3', machineBand: 'X', manualBand: 'B', scoreDelta: null }])
  })

  it('band mapping matches the proven Hologram bands', () => {
    expect(scoreToBand(66)).toBe('B')
    expect(scoreToBand(20)).toBe('X')
    expect(scoreToBand(81)).toBe('A')
  })
})

describe('compareRouting', () => {
  it('reports agreement and mismatches', () => {
    const c = compareRouting(
      [
        { id: '1', owner: 'Jon Liebe' },
        { id: '2', owner: 'Shawn' },
      ],
      [
        { id: '1', owner: 'jon liebe' },
        { id: '2', owner: 'Sarah M' },
      ],
    )
    expect(c.agreement).toBe(0.5)
    expect(c.mismatches).toEqual([{ id: '2', machineOwner: 'Shawn', manualOwner: 'Sarah M' }])
  })
})

describe('compareCopy', () => {
  it('scores similarity, catches unfilled slots, keeps merge tags legal', () => {
    const c = compareCopy(
      [
        { id: '1', subject: 'Checking back in', body: 'Hi {{first_name}}, when we last connected...' },
        { id: '2', subject: 'Reconnecting', body: 'Hi there, about {opp_detail} we discussed' }, // unfilled!
      ],
      [
        { id: '1', subject: 'Checking back in', body: 'Hi {{first_name}}, when we last connected...' },
        { id: '2', subject: 'Reconnecting soon', body: 'Hi there, about the SIM order we discussed' },
      ],
    )
    expect(c.compared).toBe(2)
    expect(c.meanSubjectSimilarity).toBeGreaterThan(0.8)
    expect(c.unfilledSlotIds).toEqual(['2']) // {{first_name}} is fine; {opp_detail} is not
  })
})

describe('shadowReport', () => {
  it('renders the full markdown artifact', () => {
    const report = shadowReport({
      engagement: 'Acme (mock)',
      date: '2026-07-09',
      grades: {
        comparison: compareGrades(
          [{ id: '1', score: 85, labels: { industry: 'Fleet' } }, { id: '2', score: 15, labels: {} }],
          [{ id: '1', grade: 'A', labels: { industry: 'Fleet' } }, { id: '2', grade: 'B' }],
        ),
      },
      routing: { comparison: compareRouting([{ id: '1', owner: 'A' }], [{ id: '1', owner: 'A' }]) },
      copy: {
        comparison: compareCopy(
          [{ id: '1', subject: 's', body: 'b {{first_name}}' }],
          [{ id: '1', subject: 's', body: 'b {{first_name}}' }],
        ),
      },
    })
    expect(report).toContain('# Shadow-Run Report — Acme (mock)')
    expect(report).toContain('Band agreement: **50%** exact')
    expect(report).toContain('| 2 | X | B | — |')
    expect(report).toContain('agreement: **100%**')
    expect(report).toContain('No unfilled slots.')
  })
})
