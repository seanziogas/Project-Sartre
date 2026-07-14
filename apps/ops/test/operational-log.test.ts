import { describe, expect, it } from 'vitest'
import { logOpsEvent, safeOperationalMessage } from '../src/lib/operational-log.js'

describe('ops operational logging', () => {
  it('emits structured connector events and sanitizes error text', () => {
    const lines: string[] = []
    logOpsEvent('warn', 'connector_test_failed', { clientId: 'Acme', provider: 'hubspot' }, (line) => lines.push(line))
    expect(JSON.parse(lines[0]!)).toMatchObject({ service: 'ops', level: 'warn', event: 'connector_test_failed', fields: { clientId: 'Acme', provider: 'hubspot' } })
    expect(safeOperationalMessage(new Error('bad\nrequest\tsecret'))).toBe('bad request secret')
    expect(safeOperationalMessage(new Error('x'.repeat(500)))).toHaveLength(300)
  })
})
