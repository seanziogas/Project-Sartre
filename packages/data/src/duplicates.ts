import type { Account, Contact } from '@sartre/core'
import type { DuplicateGroup } from './resolution.js'

export interface DuplicateReviewMember {
  canonicalId: string
  externalIds: Record<string, string>
  label: string
}

export interface DuplicateReviewGroup {
  id: string
  recordType: 'account' | 'contact'
  matchedOn: DuplicateGroup['matchedOn']
  confidence: DuplicateGroup['confidence']
  members: DuplicateReviewMember[]
}

/** Project persisted duplicate flags into a non-destructive human review deck. */
export function canonicalDuplicateReviewGroups(
  accounts: Account[],
  contacts: Contact[],
): DuplicateReviewGroup[] {
  const groups = new Map<string, DuplicateReviewGroup>()
  for (const account of accounts) {
    if (!reviewable(account)) continue
    addMember(groups, 'account', account.duplicateGroupId!, {
      canonicalId: account.id,
      externalIds: account.externalIds,
      label: account.name.value ?? account.domain.value ?? account.id,
    })
  }
  for (const contact of contacts) {
    if (!reviewable(contact)) continue
    addMember(groups, 'contact', contact.duplicateGroupId!, {
      canonicalId: contact.id,
      externalIds: contact.externalIds,
      label: [contact.firstName.value, contact.lastName.value].filter(Boolean).join(' ') || contact.email.value || contact.id,
    })
  }
  return [...groups.values()]
    .filter((group) => group.members.length >= 2)
    .sort((a, b) => a.id.localeCompare(b.id))
}

function reviewable(record: Account | Contact): boolean {
  return record.flags.includes('duplicate')
    && !record.flags.includes('excluded')
    && record.duplicateGroupId !== undefined
}

function addMember(
  groups: Map<string, DuplicateReviewGroup>,
  recordType: DuplicateReviewGroup['recordType'],
  key: string,
  member: DuplicateReviewMember,
): void {
  const id = `${recordType}:${key}`
  const existing = groups.get(id)
  if (existing) {
    existing.members.push(member)
    return
  }
  const matchedOn = matchType(key)
  groups.set(id, {
    id,
    recordType,
    matchedOn,
    confidence: matchedOn === 'domain' || matchedOn === 'email' || matchedOn === 'linkedin'
      ? 'high'
      : matchedOn === 'name' ? 'medium' : 'low',
    members: [member],
  })
}

function matchType(key: string): DuplicateGroup['matchedOn'] {
  const type = key.slice(0, key.indexOf(':'))
  return ['domain', 'name', 'linkedin', 'email', 'fuzzy'].includes(type)
    ? type as DuplicateGroup['matchedOn']
    : 'fuzzy'
}
