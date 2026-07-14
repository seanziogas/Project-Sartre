import { describe, expect, it } from 'vitest'
import { requestJson, RetryingHttpTransport } from '../src/http.js'

describe('provider HTTP resilience', () => {
  it('retries throttles and transient failures with bounded backoff', async () => {
    const statuses = [429, 503, 200]
    const waits: number[] = []
    const transport = new RetryingHttpTransport({
      request: async () => ({ status: statuses.shift()!, body: {}, headers: {} }),
    }, { maxAttempts: 3, wait: async (milliseconds) => { waits.push(milliseconds) } })
    expect((await transport.request({ method: 'GET', url: 'https://provider.example' })).status).toBe(200)
    expect(waits).toEqual([250, 500])
  })

  it('does not retry permanent client errors', async () => {
    let calls = 0
    const transport = new RetryingHttpTransport({ request: async () => { calls++; return { status: 401, body: {}, headers: {} } } })
    expect((await transport.request({ method: 'GET', url: 'https://provider.example' })).status).toBe(401)
    expect(calls).toBe(1)
  })

  it('does not replay an ambiguous failed POST that could have caused an external effect', async () => {
    let calls = 0
    const transport = new RetryingHttpTransport({ request: async () => { calls++; return { status: 503, body: {}, headers: {} } } })
    expect((await transport.request({ method: 'POST', url: 'https://provider.example', body: '{}' })).status).toBe(503)
    expect(calls).toBe(1)
  })

  it('surfaces bounded provider detail without multiline log injection', async () => {
    const error = await requestJson<never>({ request: async () => ({ status: 400, body: { error: { message: `invalid\nrequest${'x'.repeat(500)}` } }, headers: {} }) }, {
      method: 'GET', url: 'https://provider.example',
    }).catch((value: unknown) => value as Error)
    expect(error.message).toMatch(/^provider request failed \(400\): invalid requestx+$/)
    expect(error.message).not.toContain('\n')
    expect(error.message.length).toBeLessThan(340)
  })
})
