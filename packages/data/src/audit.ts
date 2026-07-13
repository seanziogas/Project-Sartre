import { normalizeDomain, normalizeEmail } from '@sartre/core'
import { resolveAccountDuplicates, resolveContactDuplicates } from './resolution.js'
import type { AccountLike, ContactLike } from './resolution.js'

/**
 * Day-1 Data Audit (Layer 7): automated diagnostic that runs before any
 * module turns on. Storage-agnostic — callers hand it rows already pulled
 * from the CRM connector. Output doubles as sales collateral (the
 * productized GTM Diagnostic).
 */

export interface AuditAccountRow extends AccountLike {
  ownerRef: string | null
  updatedAt: string | null // ISO date of last CRM modification
  linkedinUrl: string | null
}

export interface AuditContactRow extends ContactLike {
  accountRef: string | null // link to account row (orphan check)
  ownerRef: string | null
  updatedAt: string | null
}

export interface FieldFillRate {
  object: 'account' | 'contact'
  field: string
  filled: number
  total: number
  rate: number // 0..1
}

export interface DataHealthReport {
  generatedAt: string
  counts: { accounts: number; contacts: number }
  fillRates: FieldFillRate[]
  identifierCoverage: {
    accountDomain: number
    accountLinkedin: number
    contactEmail: number
    contactLinkedin: number
    /** Identifiers that exist but don't survive normalization (junk values). */
    invalidAccountDomains: number
    invalidContactEmails: number
  }
  duplicates: {
    accountGroups: number
    accountRecordsInGroups: number
    contactGroups: number
    contactRecordsInGroups: number
    /** Fraction of records that sit in some duplicate group. */
    accountDensity: number
    contactDensity: number
  }
  staleness: {
    staleDays: number
    staleAccounts: number
    staleContacts: number
  }
  orphanContacts: number
  ownership: { accountsUnowned: number; contactsUnowned: number }
  /** 0–100. Weighted composite; the weights are stated in `scoreBreakdown`. */
  score: number
  scoreBreakdown: { component: string; weight: number; value: number }[]
}

function fillRate(object: 'account' | 'contact', field: string, values: (string | null)[]): FieldFillRate {
  const filled = values.filter((v) => v !== null && v.trim() !== '').length
  return { object, field, filled, total: values.length, rate: values.length === 0 ? 0 : filled / values.length }
}

function isStale(updatedAt: string | null, now: Date, staleDays: number): boolean {
  if (!updatedAt) return true // never-touched counts as stale
  const age = (now.getTime() - new Date(updatedAt).getTime()) / 86_400_000
  return Number.isNaN(age) ? true : age > staleDays
}

export interface AuditOptions {
  now?: Date
  staleDays?: number // default 365 — a year untouched is stale for GTM purposes
}

export function runDataAudit(
  accounts: AuditAccountRow[],
  contacts: AuditContactRow[],
  options: AuditOptions = {},
): DataHealthReport {
  const now = options.now ?? new Date()
  const staleDays = options.staleDays ?? 365

  const fillRates: FieldFillRate[] = [
    fillRate('account', 'name', accounts.map((a) => a.name)),
    fillRate('account', 'domain', accounts.map((a) => a.domain)),
    fillRate('account', 'owner', accounts.map((a) => a.ownerRef)),
    fillRate('contact', 'email', contacts.map((c) => c.email)),
    fillRate('contact', 'linkedin', contacts.map((c) => c.linkedinUrl)),
    fillRate('contact', 'account_link', contacts.map((c) => c.accountRef)),
    fillRate('contact', 'owner', contacts.map((c) => c.ownerRef)),
  ]

  const accountsWithDomain = accounts.filter((a) => a.domain && a.domain.trim() !== '')
  const validDomains = accountsWithDomain.filter((a) => normalizeDomain(a.domain as string) !== null)
  const contactsWithEmail = contacts.filter((c) => c.email && c.email.trim() !== '')
  const validEmails = contactsWithEmail.filter((c) => normalizeEmail(c.email as string) !== null)

  const accountGroups = resolveAccountDuplicates(accounts)
  const contactGroups = resolveContactDuplicates(contacts)
  const accountsInGroups = accountGroups.reduce((n, g) => n + g.memberIds.length, 0)
  const contactsInGroups = contactGroups.reduce((n, g) => n + g.memberIds.length, 0)

  const staleAccounts = accounts.filter((a) => isStale(a.updatedAt, now, staleDays)).length
  const staleContacts = contacts.filter((c) => isStale(c.updatedAt, now, staleDays)).length
  const orphanContacts = contacts.filter((c) => !c.accountRef).length
  const accountsUnowned = accounts.filter((a) => !a.ownerRef).length
  const contactsUnowned = contacts.filter((c) => !c.ownerRef).length

  // Empty populations have zero coverage but zero defect density. Treating
  // zero records as 100% identifier coverage would incorrectly open MVD gates.
  const ratio = (num: number, den: number) => (den === 0 ? 0 : num / den)

  // Composite score: identifier coverage is weighted heaviest because every
  // downstream module keys on it (the Field Priority Matrix, formalized).
  const components = [
    { component: 'identifier_coverage', weight: 0.35, value: (ratio(validDomains.length, accounts.length) + ratio(validEmails.length, contacts.length)) / 2 },
    { component: 'dedup_cleanliness', weight: 0.2, value: 1 - (ratio(accountsInGroups, accounts.length) + ratio(contactsInGroups, contacts.length)) / 2 },
    { component: 'freshness', weight: 0.15, value: 1 - (ratio(staleAccounts, accounts.length) + ratio(staleContacts, contacts.length)) / 2 },
    { component: 'linkage', weight: 0.15, value: 1 - ratio(orphanContacts, contacts.length) },
    { component: 'ownership', weight: 0.15, value: 1 - (ratio(accountsUnowned, accounts.length) + ratio(contactsUnowned, contacts.length)) / 2 },
  ]
  const score = accounts.length + contacts.length === 0
    ? 0
    : Math.round(components.reduce((s, c) => s + c.weight * c.value, 0) * 100)

  return {
    generatedAt: now.toISOString(),
    counts: { accounts: accounts.length, contacts: contacts.length },
    fillRates,
    identifierCoverage: {
      accountDomain: ratio(validDomains.length, accounts.length),
      accountLinkedin: ratio(accounts.filter((a) => a.linkedinUrl).length, accounts.length),
      contactEmail: ratio(validEmails.length, contacts.length),
      contactLinkedin: ratio(contacts.filter((c) => c.linkedinUrl).length, contacts.length),
      invalidAccountDomains: accountsWithDomain.length - validDomains.length,
      invalidContactEmails: contactsWithEmail.length - validEmails.length,
    },
    duplicates: {
      accountGroups: accountGroups.length,
      accountRecordsInGroups: accountsInGroups,
      contactGroups: contactGroups.length,
      contactRecordsInGroups: contactsInGroups,
      accountDensity: ratio(accountsInGroups, accounts.length),
      contactDensity: ratio(contactsInGroups, contacts.length),
    },
    staleness: { staleDays, staleAccounts, staleContacts },
    orphanContacts,
    ownership: { accountsUnowned, contactsUnowned },
    score,
    scoreBreakdown: components,
  }
}
