import { describe, expect, it } from 'vitest'
import { createOperationalLogger } from '../src/operational-log.js'

describe('operational logger', () => {
  it('emits machine-readable bounded event fields', () => {
    const lines: string[] = []
    const log = createOperationalLogger((line) => lines.push(line), () => new Date('2026-07-14T12:00:00Z'))
    log('error', 'tick_failed', { message: 'database unavailable', consecutiveFailures: 2 })
    expect(JSON.parse(lines[0]!)).toEqual({
      timestamp: '2026-07-14T12:00:00.000Z', service: 'runner', level: 'error', event: 'tick_failed',
      fields: { message: 'database unavailable', consecutiveFailures: 2 },
    })
  })
})
