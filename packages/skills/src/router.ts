/**
 * Router (skill-patterns.md Pattern 4, generalized from the InEight routing
 * skill). Routing as a versioned rule document, not tribal knowledge:
 * priority-ordered rules with a condition mini-language, deterministic
 * evaluation, and reasoning output on every decision. The rules live in the
 * client brain (routing.md frontmatter/config); nothing here is
 * client-specific. Fully deterministic — no model calls.
 */

export const SKILL_ID = 'router@0.1.0'

export interface RoutingInput {
  id: string
  /** Arbitrary fields conditions test against: classification, country, state, … */
  fields: Record<string, string | number | boolean | null>
  /**
   * Dual-revenue convention: enrichment stores subsidiary revenue, ROUTING
   * uses parent revenue when present. Callers set fields.effective_revenue
   * via effectiveRevenue() before routing.
   */
}

export function effectiveRevenue(row: { revenueUsd?: number | null; parentRevenueUsd?: number | null }): number | null {
  return row.parentRevenueUsd ?? row.revenueUsd ?? null
}

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | {
      field: string
      op: 'eq' | 'neq' | 'in' | 'gte' | 'lt' | 'exists' | 'missing' | 'matches'
      value?: string | number | boolean | (string | number)[]
    }

export interface RoutingRule {
  id: string
  description: string
  when: Condition
  action:
    | { type: 'skip'; reason: string }
    | { type: 'assign'; owner: string }
    | { type: 'manual_review'; reason: string }
}

export interface RoutingRules {
  /** Evaluated top to bottom; first match wins (classification-first ordering lives here). */
  rules: RoutingRule[]
  /** No rule matched: route here, or manual review when null. */
  defaultOwner: string | null
}

export interface RoutingDecision {
  id: string
  decision: 'assigned' | 'skip' | 'manual_review'
  owner: string | null
  ruleId: string | null // null = default fallback
  reasoning: string
}

export function route(input: RoutingInput, rules: RoutingRules): RoutingDecision {
  for (const rule of rules.rules) {
    if (!evaluate(rule.when, input.fields)) continue
    const base = `rule ${rule.id} (${rule.description}) matched: ${explain(rule.when, input.fields)}`
    switch (rule.action.type) {
      case 'skip':
        return { id: input.id, decision: 'skip', owner: null, ruleId: rule.id, reasoning: `${base} → skip: ${rule.action.reason}` }
      case 'assign':
        return { id: input.id, decision: 'assigned', owner: rule.action.owner, ruleId: rule.id, reasoning: `${base} → ${rule.action.owner}` }
      case 'manual_review':
        return { id: input.id, decision: 'manual_review', owner: null, ruleId: rule.id, reasoning: `${base} → manual review: ${rule.action.reason}` }
    }
  }
  if (rules.defaultOwner !== null) {
    return {
      id: input.id,
      decision: 'assigned',
      owner: rules.defaultOwner,
      ruleId: null,
      reasoning: `no rule matched → default owner ${rules.defaultOwner}`,
    }
  }
  return {
    id: input.id,
    decision: 'manual_review',
    owner: null,
    ruleId: null,
    reasoning: 'no rule matched and no default owner — manual review',
  }
}

export function routeAll(inputs: RoutingInput[], rules: RoutingRules): RoutingDecision[] {
  return inputs.map((i) => route(i, rules))
}

function evaluate(cond: Condition, fields: RoutingInput['fields']): boolean {
  if ('all' in cond) return cond.all.every((c) => evaluate(c, fields))
  if ('any' in cond) return cond.any.some((c) => evaluate(c, fields))
  if ('not' in cond) return !evaluate(cond.not, fields)

  const raw = fields[cond.field]
  switch (cond.op) {
    case 'exists':
      return raw !== null && raw !== undefined && raw !== ''
    case 'missing':
      return raw === null || raw === undefined || raw === ''
    case 'eq':
      return normalize(raw) === normalize(cond.value as string | number | boolean)
    case 'neq':
      return normalize(raw) !== normalize(cond.value as string | number | boolean)
    case 'in':
      return Array.isArray(cond.value) && cond.value.some((v) => normalize(v) === normalize(raw))
    case 'gte':
      return typeof raw === 'number' && typeof cond.value === 'number' && raw >= cond.value
    case 'lt':
      return typeof raw === 'number' && typeof cond.value === 'number' && raw < cond.value
    case 'matches':
      return typeof raw === 'string' && typeof cond.value === 'string' && new RegExp(cond.value, 'i').test(raw)
  }
}

function normalize(v: unknown): unknown {
  return typeof v === 'string' ? v.trim().toLowerCase() : v
}

function explain(cond: Condition, fields: RoutingInput['fields']): string {
  if ('all' in cond) return cond.all.map((c) => explain(c, fields)).join(' AND ')
  if ('any' in cond) {
    const hit = cond.any.find((c) => evaluate(c, fields))
    return hit ? explain(hit, fields) : 'no branch'
  }
  if ('not' in cond) return `NOT(${explain(cond.not, fields)})`
  return `${cond.field}=${JSON.stringify(fields[cond.field])} ${cond.op}${cond.value !== undefined ? ` ${JSON.stringify(cond.value)}` : ''}`
}
