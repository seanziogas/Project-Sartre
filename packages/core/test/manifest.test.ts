import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ManifestError, moduleRunnable, parseManifest } from '../src/manifest/manifest.js'

const templatePath = resolve(import.meta.dirname, '../../../clients/_template/client.yaml')

describe('parseManifest', () => {
  it('validates the shipped instance template', () => {
    const manifest = parseManifest(readFileSync(templatePath, 'utf8'))
    expect(manifest.client.name).toBe('[Client Name]')
    expect(manifest.status).toBe('onboarding')
    expect(manifest.policies.approval.outbound_send).toBe('block')
    expect(manifest.modules['platform.learning']?.enabled).toBe(true)
  })

  it('rejects bad module ids', () => {
    const yaml = readFileSync(templatePath, 'utf8').replace('revops.enrichment:', 'notafunction.enrichment:')
    expect(() => parseManifest(yaml)).toThrow(ManifestError)
  })

  it('rejects invalid YAML with a helpful error', () => {
    expect(() => parseManifest(':::not yaml:::')).toThrow(ManifestError)
  })

  it('rejects auto-approval policies', () => {
    const unsafe = readFileSync(templatePath, 'utf8').replace('internal_report: block', 'internal_report: auto')
    expect(() => parseManifest(unsafe)).toThrow(ManifestError)
  })
})

describe('moduleRunnable', () => {
  const base = parseManifest(readFileSync(templatePath, 'utf8'))

  it('blocks an enabled module with no MVD status', () => {
    const m = structuredClone(base)
    m.modules['revops.enrichment']!.enabled = true
    const res = moduleRunnable(m, 'revops.enrichment')
    expect(res.runnable).toBe(false)
    expect(res.reason).toContain('Data Audit')
  })

  it('runs on green MVD', () => {
    const m = structuredClone(base)
    m.modules['revops.enrichment']!.enabled = true
    m.mvd['revops.enrichment'] = { status: 'green', as_of: '2026-07-09', blocking_gaps: [] }
    expect(moduleRunnable(m, 'revops.enrichment').runnable).toBe(true)
  })

  it('blocks on red MVD and names the gaps', () => {
    const m = structuredClone(base)
    m.modules['revops.enrichment']!.enabled = true
    m.mvd['revops.enrichment'] = {
      status: 'red',
      as_of: '2026-07-09',
      blocking_gaps: [{ field: 'domain', coverage: 0.6, required: 0.9, remediation_credits: 4200 }],
    }
    const res = moduleRunnable(m, 'revops.enrichment')
    expect(res.runnable).toBe(false)
    expect(res.reason).toContain('domain at 60% (needs 90%)')
  })

  it('honors an attributed override', () => {
    const m = structuredClone(base)
    m.modules['revops.enrichment']!.enabled = true
    m.modules['revops.enrichment']!.override_mvd = { reason: 'client accepts risk for pilot', approved_by: 'GTME' }
    m.mvd['revops.enrichment'] = { status: 'yellow', as_of: '2026-07-09', blocking_gaps: [] }
    const res = moduleRunnable(m, 'revops.enrichment')
    expect(res.runnable).toBe(true)
    expect(res.reason).toContain('GTME')
  })

  it('never runs a module missing from the manifest', () => {
    expect(moduleRunnable(base, 'sales.outbound').runnable).toBe(false)
  })
})
