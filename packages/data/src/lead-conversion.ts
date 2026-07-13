import { normalizeDomain, normalizeEmail } from '@sartre/core'
import type { Account, Contact } from '@sartre/core'
import type { LeadConversionRequest } from '@sartre/connectors'
import { z } from 'zod'

export const LeadCandidate = z.object({
  clientId: z.string().min(1),
  sourceSystem: z.string().min(1),
  externalId: z.string().min(1),
  firstName: z.string().nullable().default(null),
  lastName: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
  companyName: z.string().nullable().default(null),
  companyDomain: z.string().nullable().default(null),
  doNotConvert: z.boolean().default(false),
})
export type LeadCandidate = z.infer<typeof LeadCandidate>

export type LeadConversionAction =
  | 'convert_existing_account'
  | 'convert_new_account'
  | 'manual_review'
  | 'skip_existing_contact'
  | 'skip_opted_out'

export interface LeadConversionDecision {
  leadExternalId: string
  action: LeadConversionAction
  targetAccountCanonicalId: string | null
  targetAccountExternalId: string | null
  reasoning: string
}

export interface LeadConversionPlan {
  decisions: LeadConversionDecision[]
  requests: LeadConversionRequest[]
}

const CONSUMER_DOMAINS = new Set([
  'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'aol.com', 'protonmail.com',
])

/** Exact identifiers only: ambiguous or weak matches always stay in human review. */
export function planLeadConversions(
  clientId: string,
  leadInputs: LeadCandidate[],
  accounts: Account[],
  contacts: Contact[],
): LeadConversionPlan {
  if (accounts.some((account) => account.clientId !== clientId)
    || contacts.some((contact) => contact.clientId !== clientId)) {
    throw new Error('canonical lead-conversion references cross the client boundary')
  }
  const leads = z.array(LeadCandidate).parse(leadInputs)
  if (leads.some((lead) => lead.clientId !== clientId)) {
    throw new Error('lead candidate crosses the client boundary')
  }
  if (new Set(leads.map((lead) => lead.sourceSystem)).size > 1) {
    throw new Error('one lead conversion plan cannot mix source systems')
  }
  const externalCounts = new Map<string, number>()
  for (const lead of leads) externalCounts.set(lead.externalId, (externalCounts.get(lead.externalId) ?? 0) + 1)
  const decisions = leads.map((lead) => decideLead(lead, accounts, contacts, externalCounts.get(lead.externalId) ?? 0))
  const requests = decisions.flatMap((decision): LeadConversionRequest[] => {
    if (decision.action === 'convert_existing_account') {
      return [{ leadExternalId: decision.leadExternalId, targetAccountExternalId: decision.targetAccountExternalId!, createAccount: false }]
    }
    if (decision.action === 'convert_new_account') {
      return [{ leadExternalId: decision.leadExternalId, targetAccountExternalId: null, createAccount: true }]
    }
    return []
  })
  return { decisions, requests }
}

function decideLead(
  lead: LeadCandidate,
  accounts: Account[],
  contacts: Contact[],
  externalCount: number,
): LeadConversionDecision {
  const base = { leadExternalId: lead.externalId, targetAccountCanonicalId: null, targetAccountExternalId: null }
  if (externalCount > 1) {
    return { ...base, action: 'manual_review', reasoning: 'duplicate source lead id in the staged conversion batch' }
  }
  if (lead.doNotConvert) return { ...base, action: 'skip_opted_out', reasoning: 'source lead is marked do not convert' }
  const email = lead.email ? normalizeEmail(lead.email) : null
  if (!email) return { ...base, action: 'manual_review', reasoning: 'a valid email is required before conversion' }
  const contactMatches = contacts.filter((contact) =>
    contact.email.value !== null && normalizeEmail(contact.email.value) === email,
  )
  if (contactMatches.length > 0) {
    return {
      ...base,
      action: 'skip_existing_contact',
      targetAccountCanonicalId: contactMatches.length === 1 ? contactMatches[0]!.accountId : null,
      reasoning: `${contactMatches.length} canonical contact match(es) already use ${email}`,
    }
  }
  const domain = lead.companyDomain ? normalizeDomain(lead.companyDomain) : null
  if (!domain) return { ...base, action: 'manual_review', reasoning: 'a valid company domain is required for deterministic account matching' }
  if (CONSUMER_DOMAINS.has(domain)) {
    return { ...base, action: 'manual_review', reasoning: `consumer email domain ${domain} cannot identify a company account` }
  }
  const accountMatches = accounts.filter((account) =>
    !account.flags.includes('excluded')
    && account.domain.value !== null
    && normalizeDomain(account.domain.value) === domain,
  )
  if (accountMatches.length > 1) {
    return { ...base, action: 'manual_review', reasoning: `${accountMatches.length} canonical accounts match domain ${domain}` }
  }
  if (accountMatches.length === 1) {
    const account = accountMatches[0]!
    if (account.flags.includes('duplicate')) {
      return { ...base, action: 'manual_review', reasoning: `matching account ${account.id} is flagged duplicate` }
    }
    const externalId = account.externalIds[lead.sourceSystem]
    if (!externalId) {
      return { ...base, action: 'manual_review', reasoning: `matching account has no ${lead.sourceSystem} external id` }
    }
    return {
      ...base,
      action: 'convert_existing_account',
      targetAccountCanonicalId: account.id,
      targetAccountExternalId: externalId,
      reasoning: `exact normalized domain match on ${domain}`,
    }
  }
  if (!lead.companyName?.trim()) {
    return { ...base, action: 'manual_review', reasoning: 'new-account conversion requires a company name' }
  }
  return { ...base, action: 'convert_new_account', reasoning: `no canonical account matches domain ${domain}` }
}
