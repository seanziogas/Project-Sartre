import { describe, expect, it } from 'vitest'
import { runDataAudit } from '../src/audit.js'
import type { AuditAccountRow, AuditContactRow } from '../src/audit.js'
import { DEFAULT_MODULE_MVD, evaluateMvd } from '../src/mvd.js'

const NOW = new Date('2026-07-09T00:00:00Z')

function acct(over: Partial<AuditAccountRow> & { id: string }): AuditAccountRow {
  return {
    name: 'Co',
    domain: 'co.com',
    ownerRef: 'rep1',
    updatedAt: '2026-06-01T00:00:00Z',
    linkedinUrl: null,
    ...over,
  }
}
function ct(over: Partial<AuditContactRow> & { id: string }): AuditContactRow {
  return {
    firstName: 'A',
    lastName: 'B',
    email: 'a@co.com',
    linkedinUrl: null,
    companyName: 'Co',
    accountRef: 'acct1',
    ownerRef: 'rep1',
    updatedAt: '2026-06-01T00:00:00Z',
    ...over,
  }
}

describe('runDataAudit', () => {
  it('scores a clean book high', () => {
    const report = runDataAudit(
      [acct({ id: '1', domain: 'a.com' }), acct({ id: '2', domain: 'b.com' })],
      [ct({ id: 'c1', email: 'x@a.com' }), ct({ id: 'c2', email: 'y@b.com' })],
      { now: NOW },
    )
    expect(report.score).toBeGreaterThanOrEqual(95)
    expect(report.duplicates.accountGroups).toBe(0)
  })

  it('catches junk identifiers, orphans, staleness, and unowned records', () => {
    const report = runDataAudit(
      [
        acct({ id: '1', domain: 'not a domain', ownerRef: null, updatedAt: '2020-01-01T00:00:00Z' }),
        acct({ id: '2', domain: null }),
      ],
      [ct({ id: 'c1', email: 'bad-email', accountRef: null })],
      { now: NOW },
    )
    expect(report.identifierCoverage.invalidAccountDomains).toBe(1)
    expect(report.identifierCoverage.accountDomain).toBe(0)
    expect(report.identifierCoverage.invalidContactEmails).toBe(1)
    expect(report.orphanContacts).toBe(1)
    expect(report.staleness.staleAccounts).toBe(1)
    expect(report.ownership.accountsUnowned).toBe(1)
    expect(report.score).toBeLessThan(60)
  })

  it('measures duplicate density', () => {
    const report = runDataAudit(
      [acct({ id: '1', domain: 'acme.com' }), acct({ id: '2', domain: 'www.acme.com' }), acct({ id: '3', domain: 'other.com' })],
      [],
      { now: NOW },
    )
    expect(report.duplicates.accountGroups).toBe(1)
    expect(report.duplicates.accountRecordsInGroups).toBe(2)
    expect(report.duplicates.accountDensity).toBeCloseTo(2 / 3)
  })
})

describe('evaluateMvd', () => {
  const dirtyReport = runDataAudit(
    // 1 of 4 accounts has a usable domain → 25% coverage
    [acct({ id: '1' }), acct({ id: '2', domain: null }), acct({ id: '3', domain: null }), acct({ id: '4', domain: null })],
    [ct({ id: 'c1' })],
    { now: NOW },
  )

  it('red-gates outbound-grade requirements on dirty data, with priced gaps', () => {
    const status = evaluateMvd(dirtyReport, DEFAULT_MODULE_MVD['revops.tam']!)
    expect(status.status).toBe('red')
    const gap = status.blocking_gaps.find((g) => g.field === 'account_domain_coverage')
    expect(gap).toBeDefined()
    expect(gap!.coverage).toBe(0.25)
    expect(gap!.required).toBe(0.8)
    // 0.55 gap × 4 accounts = 3 records (ceil) × 2 credits
    expect(gap!.remediation_credits).toBe(6)
  })

  it('yellow within tolerance', () => {
    const status = evaluateMvd(dirtyReport, [{ metric: 'account_domain_coverage', required: 0.3, tolerance: 0.1 }])
    expect(status.status).toBe('yellow')
  })

  it('modules with no requirements are always green (remediation is never blocked)', () => {
    const status = evaluateMvd(dirtyReport, DEFAULT_MODULE_MVD['revops.remediation']!)
    expect(status.status).toBe('green')
  })

  it('green when requirements are met', () => {
    const clean = runDataAudit([acct({ id: '1' })], [ct({ id: 'c1' })], { now: NOW })
    expect(evaluateMvd(clean, DEFAULT_MODULE_MVD['revops.enrichment']!).status).toBe('green')
  })
})
