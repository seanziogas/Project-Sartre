import { describe, expect, it } from 'vitest'
import { buildLearningControlCenter, createConfigRelease, createPortabilityBundle, decideGovernanceRequest, decidePromotion, evaluateSlos, OtlpTelemetry, requestPromotion, ResilientTelemetry, verifyPortabilityBundle } from '../src/index.js'

describe('operations hardening', () => {
  it('exports OTLP spans and metrics with service identity', async () => {
    const sent: Array<{ path: string; body: unknown }> = []
    const telemetry = new OtlpTelemetry({ send: async (path, body) => { sent.push({ path, body }) } }, 'runner', () => new Date('2026-07-14T12:00:00Z'))
    await telemetry.span('runner.tick', { client: 'Acme' }, async () => 'ok')
    await telemetry.counter('sartre.runs', 1, { status: 'completed' })
    expect(sent.map((item) => item.path)).toEqual(['/v1/traces', '/v1/metrics'])
    expect(JSON.stringify(sent)).toContain('service.name')
  })

  it('fails open on exporter errors without repeating the operation', async () => {
    let executions = 0
    const telemetry = new ResilientTelemetry(new OtlpTelemetry({ send: async () => { throw new Error('collector unavailable') } }, 'runner'))
    expect(await telemetry.span('work', {}, async () => { executions++; return 'done' })).toBe('done')
    expect(executions).toBe(1)
  })

  it('evaluates defined service objectives', () => {
    const results = evaluateSlos([
      { status: 'completed', createdAt: '2026-07-14T10:00:00Z', updatedAt: '2026-07-14T10:05:00Z' },
      { status: 'failed', createdAt: '2026-07-14T11:00:00Z', updatedAt: '2026-07-14T11:05:00Z' },
    ], undefined, new Date('2026-07-14T12:00:00Z'))
    expect(results.find((item) => item.id === 'run-success')).toMatchObject({ value: 0.5, passing: false })
  })

  it('requires a second actor for deletion and production promotion', () => {
    const request = {
      requestId: 'a892dbe8-7ee2-4e03-b239-e2a9929fc989', clientId: 'Acme', kind: 'deletion' as const, status: 'pending' as const,
      scope: ['canonical' as const], reason: 'contract ended', requestedBy: 'requester', requestedAt: '2026-07-14T12:00:00Z',
      decidedBy: null, decidedAt: null, executedBy: null, executedAt: null,
    }
    expect(() => decideGovernanceRequest(request, 'approved', 'requester', '2026-07-14T13:00:00Z')).toThrow('separation')
    expect(decideGovernanceRequest(request, 'approved', 'approver', '2026-07-14T13:00:00Z').status).toBe('approved')

    const release = createConfigRelease('Acme', 1, { 'client.yaml': 'status: active' }, 'requester', '2026-07-14T12:00:00Z')
    const pending = requestPromotion(release, 'staging', 'requester', '2026-07-14T12:30:00Z')
    expect(() => decidePromotion(pending, 'approved', 'requester')).toThrow('separation')
    expect(decidePromotion(pending, 'approved', 'approver').stage).toBe('staging')
  })

  it('creates checksummed credential-free portability bundles', () => {
    const bundle = createPortabilityBundle('Acme', { 'client.yaml': 'client: Acme' }, [{ category: 'runs', rows: [{ id: 'r1' }] }], '2026-07-14T12:00:00Z')
    expect(verifyPortabilityBundle(bundle)).toEqual(bundle)
    expect(bundle.includesCredentials).toBe(false)
    expect(() => verifyPortabilityBundle({ ...bundle, clientId: 'Other' })).toThrow('checksum')
    expect(() => createPortabilityBundle('../escape', {}, [])).toThrow('unsafe tenant id')
  })

  it('combines evaluation regressions and draft learning artifacts for review', () => {
    const center = buildLearningControlCenter([{
      evaluationId: 'bc51cff5-917a-4bd5-8db6-5a46ddc1841c', clientId: 'Acme', skillId: 'grader', version: '1', status: 'failed',
      passed: 9, failed: 1, detail: 'regression', source: 'learning', createdAt: '2026-07-14T12:00:00Z',
    }], [{ key: 'learning:proposal:1', value: { kind: 'routing_rule', status: 'draft' }, updatedAt: '2026-07-14T12:00:00Z' }])
    expect(center.totals).toMatchObject({ evaluations: 1, regressions: 1, failed: 1 })
    expect(center.proposals).toMatchObject([{ kind: 'routing_rule', status: 'draft' }])
  })
})
