import { describe, expect, it } from 'vitest'
import { effectiveRevenue, route, routeAll } from '../src/router.js'
import type { RoutingInput, RoutingRules } from '../src/router.js'

/**
 * Known-answer eval set encoding the InEight routing rulebook shape
 * (docs/architecture/skill-patterns.md Pattern 4): classification-first
 * priority order, revenue-threshold territory split, special cases,
 * manual-review flags.
 */
const RULES: RoutingRules = {
  rules: [
    { id: 'dq', description: 'Disqualified leads are skipped', when: { field: 'disqualified', op: 'eq', value: true }, action: { type: 'skip', reason: 'disqualified' } },
    { id: 'edu', description: 'Students go to the nurture flow', when: { field: 'email', op: 'matches', value: '\\.edu$' }, action: { type: 'manual_review', reason: 'student — nurture flow' } },
    { id: 'public', description: 'Public Owner always routes to Jon', when: { field: 'classification', op: 'eq', value: 'Public Owner' }, action: { type: 'assign', owner: 'Jon Liebe' } },
    { id: 'energy', description: 'Energy & Utilities to Jon', when: { field: 'industry', op: 'eq', value: 'Energy & Utilities' }, action: { type: 'assign', owner: 'Jon Liebe' } },
    { id: 'dubai', description: 'Dubai special case', when: { all: [{ field: 'country', op: 'eq', value: 'AE' }, { field: 'city', op: 'eq', value: 'Dubai' }] }, action: { type: 'assign', owner: 'Sarah Mahouachi' } },
    { id: 'uae', description: 'Rest of UAE', when: { field: 'country', op: 'eq', value: 'AE' }, action: { type: 'assign', owner: 'Mark Lettin' } },
    { id: 'us-tx-large', description: 'US TX $100M+ territory', when: { all: [{ field: 'country', op: 'eq', value: 'US' }, { field: 'state', op: 'in', value: ['TX', 'OK'] }, { field: 'effective_revenue', op: 'gte', value: 100_000_000 }] }, action: { type: 'assign', owner: 'AE Texas' } },
    { id: 'us-small', description: 'US under $100M to Shawn', when: { all: [{ field: 'country', op: 'eq', value: 'US' }, { field: 'effective_revenue', op: 'lt', value: 100_000_000 }] }, action: { type: 'assign', owner: 'Shawn' } },
    { id: 'no-rev', description: 'US unknown revenue needs research', when: { all: [{ field: 'country', op: 'eq', value: 'US' }, { field: 'effective_revenue', op: 'missing' }] }, action: { type: 'manual_review', reason: 'revenue unknown — research before routing' } },
  ],
  defaultOwner: null,
}

const lead = (id: string, fields: RoutingInput['fields']): RoutingInput => ({ id, fields })

describe('route — known-answer eval set', () => {
  const cases: [RoutingInput, { decision: string; owner?: string | null; ruleId: string | null }][] = [
    [lead('1', { disqualified: true, classification: 'Public Owner' }), { decision: 'skip', ruleId: 'dq' }], // priority: dq beats public
    [lead('2', { classification: 'Public Owner', country: 'US', state: 'TX', effective_revenue: 5e8 }), { decision: 'assigned', owner: 'Jon Liebe', ruleId: 'public' }], // classification-first
    [lead('3', { industry: 'Energy & Utilities', country: 'US', effective_revenue: 2e7 }), { decision: 'assigned', owner: 'Jon Liebe', ruleId: 'energy' }],
    [lead('4', { country: 'AE', city: 'Dubai' }), { decision: 'assigned', owner: 'Sarah Mahouachi', ruleId: 'dubai' }],
    [lead('5', { country: 'AE', city: 'Abu Dhabi' }), { decision: 'assigned', owner: 'Mark Lettin', ruleId: 'uae' }],
    [lead('6', { country: 'US', state: 'TX', effective_revenue: 150_000_000 }), { decision: 'assigned', owner: 'AE Texas', ruleId: 'us-tx-large' }],
    [lead('7', { country: 'US', state: 'TX', effective_revenue: 99_000_000 }), { decision: 'assigned', owner: 'Shawn', ruleId: 'us-small' }],
    [lead('8', { country: 'US', state: 'TX', effective_revenue: null }), { decision: 'manual_review', ruleId: 'no-rev' }],
    [lead('9', { email: 'kid@state.edu', country: 'US', effective_revenue: 1e9 }), { decision: 'manual_review', ruleId: 'edu' }],
    [lead('10', { country: 'FR' }), { decision: 'manual_review', ruleId: null }], // nothing matched, no default
  ]

  it.each(cases)('%#: routes correctly', (input, expected) => {
    const d = route(input, RULES)
    expect(d.decision).toBe(expected.decision)
    if (expected.owner !== undefined) expect(d.owner).toBe(expected.owner)
    expect(d.ruleId).toBe(expected.ruleId)
  })

  it('every decision carries auditable reasoning', () => {
    const d = route(lead('6', { country: 'US', state: 'TX', effective_revenue: 150_000_000 }), RULES)
    expect(d.reasoning).toContain('us-tx-large')
    expect(d.reasoning).toContain('effective_revenue=150000000 gte 100000000')
    expect(d.reasoning).toContain('→ AE Texas')
  })

  it('case-insensitive string matching, default owner fallback', () => {
    const withDefault = { ...RULES, defaultOwner: 'Catch All' }
    expect(route(lead('x', { classification: 'public owner' }), RULES).owner).toBe('Jon Liebe')
    expect(route(lead('y', { country: 'FR' }), withDefault)).toMatchObject({ owner: 'Catch All', ruleId: null })
  })

  it('routeAll processes batches', () => {
    expect(routeAll([lead('a', { country: 'AE', city: 'Dubai' }), lead('b', { disqualified: true })], RULES)).toHaveLength(2)
  })
})

describe('effectiveRevenue — dual-revenue convention', () => {
  it('parent revenue wins for routing; subsidiary is fallback', () => {
    expect(effectiveRevenue({ revenueUsd: 5e7, parentRevenueUsd: 2e9 })).toBe(2e9)
    expect(effectiveRevenue({ revenueUsd: 5e7, parentRevenueUsd: null })).toBe(5e7)
    expect(effectiveRevenue({})).toBeNull()
  })
})
