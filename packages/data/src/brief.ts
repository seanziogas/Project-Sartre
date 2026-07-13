import type { Account, Activity, Contact, Opportunity, Signal } from '@sartre/core'

export interface CanonicalBriefEvidence {
  id: string
  kind: 'account' | 'contact' | 'opportunity' | 'activity' | 'signal'
  observedAt: string
  content: string
}

export interface CanonicalBriefContext {
  accountId: string
  accountName: string
  evidence: CanonicalBriefEvidence[]
}

/** Tenant-scoped records in, deterministic brief evidence out; no model work occurs here. */
export function canonicalBriefContexts(
  accounts: Account[],
  contacts: Contact[],
  opportunities: Opportunity[],
  activities: Activity[],
  signals: Signal[],
): CanonicalBriefContext[] {
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]))
  return accounts
    .filter((account) => !account.flags.includes('excluded'))
    .map((account) => {
      const accountContacts = contacts.filter((contact) => contact.accountId === account.id && !contact.flags.includes('excluded'))
      const contactIds = new Set(accountContacts.map((contact) => contact.id))
      const accountOpportunities = opportunities.filter((opportunity) => opportunity.accountId === account.id && !opportunity.flags.includes('excluded'))
      const accountActivities = activities.filter((activity) =>
        !activity.flags.includes('excluded')
        && (activity.accountId === account.id || (activity.contactId !== null && contactIds.has(activity.contactId))),
      )
      const accountSignals = signals.filter((signal) =>
        !signal.flags.includes('excluded')
        && (signal.accountId === account.id
          || (signal.contactId !== null && contactsById.get(signal.contactId)?.accountId === account.id)),
      )
      return {
        accountId: account.id,
        accountName: account.name.value ?? account.externalIds[Object.keys(account.externalIds)[0] ?? ''] ?? account.id,
        evidence: [
          evidence('account', account.id, account.updatedAt, compact([
            `Account: ${account.name.value}`,
            `domain: ${account.domain.value}`,
            `industry: ${account.industry.value}`,
            `revenue tier: ${account.revenueTier.value}`,
            `country: ${account.country.value}`,
            `ICP grade: ${account.icpGrade.value}`,
          ])),
          ...accountContacts.map((contact) => evidence('contact', contact.id, contact.updatedAt, compact([
            `Contact: ${[contact.firstName.value, contact.lastName.value].filter(Boolean).join(' ')}`,
            `title: ${contact.title.value}`,
            `seniority: ${contact.seniority.value}`,
            `employment: ${contact.employmentStatus.value}`,
          ]))),
          ...accountOpportunities.map((opportunity) => evidence('opportunity', opportunity.id, opportunity.updatedAt, compact([
            `Opportunity: ${opportunity.name.value}`,
            `stage: ${opportunity.stage.value}`,
            `amount USD: ${opportunity.amountUsd.value}`,
            `close date: ${opportunity.closeDate.value}`,
            `loss reason: ${opportunity.lossReason.value}`,
          ]))),
          ...accountActivities.map((activity) => evidence('activity', activity.id, activity.occurredAt, compact([
            `Activity: ${activity.type}`,
            `direction: ${activity.direction}`,
            `summary: ${activity.summary}`,
          ]))),
          ...accountSignals.map((signal) => evidence('signal', signal.id, signal.observedAt, compact([
            `Signal: ${signal.kind}`,
            `detail: ${signal.detail}`,
          ]))),
        ],
      }
    })
}

function evidence(
  kind: CanonicalBriefEvidence['kind'],
  id: string,
  observedAt: string,
  content: string,
): CanonicalBriefEvidence {
  return { id: `${kind}:${id}`, kind, observedAt, content }
}

function compact(parts: string[]): string {
  return parts.filter((part) => !part.endsWith(': null') && !part.endsWith(': ')).join('; ')
}
