import { describe, expect, it } from 'vitest'
import { healthStatus, ReadinessState } from '../src/health.js'

describe('runner health server', () => {
  it('separates liveness from readiness', () => {
    expect(healthStatus('/healthz', false)).toMatchObject({ status: 200, body: { status: 'ok' } })
    expect(healthStatus('/readyz', false)).toMatchObject({ status: 503, body: { status: 'starting' } })
    expect(healthStatus('/readyz', true)).toMatchObject({ status: 200, body: { status: 'ok' } })
    expect(healthStatus('/other', true)).toMatchObject({ status: 404, body: { status: 'not_found' } })
  })

  it('transitions unhealthy on failure and recovers on success', () => {
    const readiness = new ReadinessState()
    expect(readiness.isReady()).toBe(false)
    expect(readiness.succeeded()).toBe(true)
    expect(readiness.isReady()).toBe(true)
    expect(readiness.failed()).toBe(true)
    expect(readiness.failed()).toBe(false)
    expect(readiness.succeeded()).toBe(true)
  })
})
