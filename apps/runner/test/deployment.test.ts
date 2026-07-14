import { describe, expect, it } from 'vitest'
import { loadModuleDeps } from '../src/deployment.js'
import { buildRegistry } from '../src/registry.js'

describe('runner deployment loading', () => {
  it('starts with the first-party 23-module deployment bundle when no override is configured', async () => {
    const deps = await loadModuleDeps(undefined, { db: {}, brains: {}, connections: {}, tools: {} } as never)
    const registry = buildRegistry(deps, { complete: async () => '[]' })
    expect(registry.forModule('platform.learning')?.id).toBe('learning-loop@0.1.0')
    expect(Object.values(deps)).toHaveLength(23)
    expect(Object.values(deps).every((resolver) => typeof resolver === 'function')).toBe(true)
  })

  it('binds reviewed event delivery to the tenant email connection', async () => {
    const sent: unknown[] = []
    const deps = await loadModuleDeps(undefined, {
      db: {}, connections: {},
      brains: { loadApprovedConfig: async () => ({ connections: { email: 'gmail' }, destinations: {}, costs: {}, modules: {} }) },
      tools: { email: async (_clientId: string, provider: string) => ({
        sendEmail: async (message: unknown) => { sent.push({ provider, message }); return { provider, messageId: 'm1' } },
      }) },
    } as never)
    const events = await deps.events('Acme')
    expect(await events.send('Acme', [{ attendeeId: 'a1', email: 'buyer@example.com', event: 'Summit', play: 'attendee', draft: 'Thanks for joining.' }]))
      .toMatchObject({ affected: 1, detail: 'gmail event follow-up delivery' })
    expect(sent).toEqual([{ provider: 'gmail', message: { to: ['buyer@example.com'], subject: 'Following up on Summit', text: 'Thanks for joining.' } }])
  })
})
