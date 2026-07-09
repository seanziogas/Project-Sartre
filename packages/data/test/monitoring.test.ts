import { describe, expect, it } from 'vitest'
import { runDataAudit } from '../src/audit.js'
import type { AuditAccountRow, AuditContactRow } from '../src/audit.js'
import { contractsFromModules, detectDrift, evaluateContracts } from '../src/monitoring.js'

const NOW = new Date('2026-07-09T00:00:00Z')

function acct(id: string, over: Partial<AuditAccountRow> = {}): AuditAccountRow {
  return { id, name: `Co${id}`, domain: `co${id}.com`, ownerRef: 'rep', updatedAt: '2026-06-01T00:00:00Z', linkedinUrl: null, ...over }
}
function ct(id: string, over: Partial<AuditContactRow> = {}): AuditContactRow {
  return { id, firstName: 'A', lastName: id, email: `a${id}@x.com`, linkedinUrl: null, companyName: `Co`, accountRef: 'a1', ownerRef: 'rep', updatedAt: '2026-06-01T00:00:00Z', ...over }
}

const clean = runDataAudit([acct('1'), acct('2'), acct('3'), acct('4')], [ct('1'), ct('2')], { now: NOW })
// half the domains gone, one orphan
const decayed = runDataAudit(
  [acct('1'), acct('2', { domain: null }), acct('3', { domain: null }), acct('4')],
  [ct('1'), ct('2', { accountRef: null })],
  { now: NOW },
)

describe('evaluateContracts', () => {
  it('passes clean data, catches violations with actuals', () => {
    const contracts = [{ metric: 'account_domain_coverage' as const, min: 0.9 }]
    expect(evaluateContracts(clean, contracts)).toEqual([])
    expect(evaluateContracts(decayed, contracts)).toEqual([
      { metric: 'account_domain_coverage', min: 0.9, actual: 0.5 },
    ])
  })
})

describe('contractsFromModules', () => {
  it('derives contracts from enabled modules, strictest requirement wins', () => {
    const contracts = contractsFromModules(['revops.enrichment', 'revops.tam', 'sales.outbound'])
    const domain = contracts.find((c) => c.metric === 'account_domain_coverage')
    expect(domain!.min).toBe(0.8) // tam's 0.8 beats enrichment's 0.7
    expect(contracts.find((c) => c.metric === 'contact_email_coverage')!.min).toBe(0.9)
  })
  it('unknown modules contribute nothing', () => {
    expect(contractsFromModules(['platform.metrics', 'not.a.module'])).toEqual([])
  })
})

describe('detectDrift', () => {
  it('alerts on metric decay with severity, critical first', () => {
    const alerts = detectDrift(clean, decayed)
    const domain = alerts.find((a) => a.metric === 'account_domain_coverage')
    expect(domain).toMatchObject({ before: 1, after: 0.5, severity: 'critical' })
    const linkage = alerts.find((a) => a.metric === 'contact_linkage')
    expect(linkage).toMatchObject({ severity: 'critical' }) // 100% → 50%
    expect(alerts.find((a) => a.metric === 'health_score')).toBeDefined()
    expect(alerts[0]!.severity).toBe('critical')
  })

  it('stays quiet when nothing decayed (improvement is not drift)', () => {
    expect(detectDrift(decayed, clean)).toEqual([])
    expect(detectDrift(clean, clean)).toEqual([])
  })

  it('honors custom thresholds', () => {
    const alerts = detectDrift(clean, decayed, { warnDrop: 0.6, criticalDrop: 0.9, scoreWarnDrop: 60, scoreCriticalDrop: 90 })
    expect(alerts).toEqual([]) // thresholds set above the actual decay
  })
})
