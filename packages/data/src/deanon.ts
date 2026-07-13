import { randomUUID } from 'node:crypto'
import { normalizeDomain, Signal } from '@sartre/core'
import type { Account, Signal as CanonicalSignal } from '@sartre/core'
import { IntentEvent } from '@sartre/connectors'
import type { IntentEvent as IntentEventType } from '@sartre/connectors'

export type DeanonAction = 'match_account' | 'manual_review' | 'unmatched'

export interface DeanonDecision {
  signalExternalId: string
  action: DeanonAction
  accountId: string | null
  normalizedDomain: string | null
  reasoning: string
}

export interface DeanonPlan {
  sourceSystem: string | null
  events: IntentEventType[]
  decisions: DeanonDecision[]
}

export interface SignalBuildOptions {
  now?: () => Date
  createId?: () => string
  runId: string
}

const CONSUMER_DOMAINS = new Set([
  'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'aol.com', 'protonmail.com',
])

/** Exact-domain, tenant-scoped resolution. Weak, duplicate, and ambiguous evidence never matches. */
export function planDeanonMatches(
  clientId: string,
  inputs: IntentEventType[],
  accounts: Account[],
): DeanonPlan {
  if (accounts.some((account) => account.clientId !== clientId)) {
    throw new Error('canonical deanon references cross the client boundary')
  }
  const events = inputs.map((input) => IntentEvent.parse(input))
  if (events.some((event) => event.clientId !== clientId)) {
    throw new Error('intent event crosses the client boundary')
  }
  const sourceSystems = new Set(events.map((event) => event.sourceSystem))
  if (sourceSystems.size > 1) throw new Error('one deanon plan cannot mix source systems')
  const externalCounts = new Map<string, number>()
  for (const event of events) {
    externalCounts.set(event.externalId, (externalCounts.get(event.externalId) ?? 0) + 1)
  }
  return {
    sourceSystem: events[0]?.sourceSystem ?? null,
    events,
    decisions: events.map((event) => decide(event, accounts, externalCounts.get(event.externalId) ?? 0)),
  }
}

/** Converts only approved exact matches into canonical signals. */
export function buildCanonicalSignals(
  clientId: string,
  plan: DeanonPlan,
  options: SignalBuildOptions,
): CanonicalSignal[] {
  const now = (options.now ?? (() => new Date()))().toISOString()
  const createId = options.createId ?? randomUUID
  const events = new Map(plan.events.map((event) => [event.externalId, event]))
  return plan.decisions.flatMap((decision): CanonicalSignal[] => {
    if (decision.action !== 'match_account' || !decision.accountId) return []
    const event = events.get(decision.signalExternalId)
    if (!event) throw new Error(`deanon decision references missing event ${decision.signalExternalId}`)
    return [Signal.parse({
      id: createId(),
      clientId,
      externalIds: { [event.sourceSystem]: event.externalId },
      createdAt: now,
      updatedAt: now,
      flags: [],
      accountId: decision.accountId,
      contactId: null,
      kind: event.kind,
      observedAt: event.occurredAt,
      detail: event.detail,
      provenance: {
        source: 'web',
        origin: event.sourceSystem,
        retrievedAt: now,
        confidence: 'high',
        runId: options.runId,
      },
    })]
  })
}

function decide(event: IntentEventType, accounts: Account[], externalCount: number): DeanonDecision {
  const domain = event.companyDomain ? normalizeDomain(event.companyDomain) : null
  const base = { signalExternalId: event.externalId, accountId: null, normalizedDomain: domain }
  if (externalCount > 1) {
    return { ...base, action: 'manual_review', reasoning: 'duplicate source signal id in the staged batch' }
  }
  if (!domain) {
    return { ...base, action: 'manual_review', reasoning: 'a valid explicit company domain is required for deterministic matching' }
  }
  if (CONSUMER_DOMAINS.has(domain)) {
    return { ...base, action: 'manual_review', reasoning: `consumer domain ${domain} cannot identify a company account` }
  }
  const matches = accounts.filter((account) =>
    !account.flags.includes('excluded')
    && account.domain.value !== null
    && normalizeDomain(account.domain.value) === domain,
  )
  if (matches.length === 0) {
    return { ...base, action: 'unmatched', reasoning: `no canonical account matches domain ${domain}` }
  }
  if (matches.length > 1) {
    return { ...base, action: 'manual_review', reasoning: `${matches.length} canonical accounts match domain ${domain}` }
  }
  const account = matches[0]!
  if (account.flags.includes('duplicate')) {
    return { ...base, action: 'manual_review', reasoning: `matching account ${account.id} is not safe for automatic association` }
  }
  return {
    ...base,
    action: 'match_account',
    accountId: account.id,
    reasoning: `exact normalized domain match on ${domain}`,
  }
}
