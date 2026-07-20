import { describe, expect, it } from 'vitest'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { benchmarkConnectorOperation, formatComparison } from '../src/benchmark.js'
import { McpConnectorClient } from '../src/mcp.js'
import type { MessageSender } from '../src/contract.js'

function mockCommsServer(externalId: string) {
  const server = new Server({ name: 'mock', version: '0.0.1' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'send_message', description: 'send', inputSchema: { type: 'object' } }] }))
  server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: JSON.stringify({ externalId }) }] }))
  return server
}

function mcpBridge(server: Server): MessageSender {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  void server.connect(serverTransport)
  return new McpConnectorClient('comms', { transport: 'mcp', serverUrl: 'https://ignored.example' }, { transport: () => clientTransport }) as MessageSender
}

describe('connector benchmark harness', () => {
  it('times both transports and reports parity when outputs agree', async () => {
    // Both transports return the same externalId → full parity.
    const restClient: MessageSender = {
      info: { id: 'rest-comms', kind: 'comms', capabilities: ['send_message'] },
      sendMessage: async (destination) => ({ provider: 'mcp-comms', destination, externalId: 'ts-1' }),
    }
    const mcp = mcpBridge(mockCommsServer('ts-1'))

    // Deterministic clock: +1ms per read.
    let t = 0
    const clock = () => (t += 1)

    const result = await benchmarkConnectorOperation({
      iterations: 5,
      rest: () => restClient.sendMessage('C1', 'hi'),
      mcp: () => mcp.sendMessage('C1', 'hi'),
      equals: (a, b) => a.externalId === b.externalId,
      clock,
    })

    expect(result.rest.runs).toBe(5)
    expect(result.mcp.runs).toBe(5)
    expect(result.rest.errors).toBe(0)
    expect(result.parity).toMatchObject({ compared: 5, matched: 5, mismatches: [] })
    expect(result.rest.p50Ms).toBeGreaterThan(0)
    expect(formatComparison(result)).toContain('parity: 5/5 matched')
  })

  it('flags parity mismatches when the transports diverge', async () => {
    const restClient: MessageSender = {
      info: { id: 'rest-comms', kind: 'comms', capabilities: ['send_message'] },
      sendMessage: async (destination) => ({ provider: 'rest', destination, externalId: 'rest-id' }),
    }
    const mcp = mcpBridge(mockCommsServer('mcp-id'))

    const result = await benchmarkConnectorOperation({
      iterations: 3,
      rest: () => restClient.sendMessage('C1', 'hi'),
      mcp: () => mcp.sendMessage('C1', 'hi'),
      equals: (a, b) => a.externalId === b.externalId,
      clock: (() => { let t = 0; return () => (t += 1) })(),
    })

    expect(result.parity.matched).toBe(0)
    expect(result.parity.mismatches).toEqual([0, 1, 2])
  })

  it('counts errors without aborting the run and excludes them from parity', async () => {
    let calls = 0
    const result = await benchmarkConnectorOperation({
      iterations: 4,
      rest: async () => ({ externalId: 'ok' }),
      mcp: async () => { calls++; if (calls === 2) throw new Error('mcp transport blip'); return { externalId: 'ok' } },
      clock: (() => { let t = 0; return () => (t += 1) })(),
    })
    expect(result.mcp.errors).toBe(1)
    expect(result.mcp.runs).toBe(3)
    expect(result.parity.compared).toBe(3) // the errored iteration is not compared
    expect(result.parity.matched).toBe(3)
  })

  it('rejects a non-positive iteration count', async () => {
    await expect(benchmarkConnectorOperation({ iterations: 0, rest: async () => 1, mcp: async () => 1 })).rejects.toThrow(/positive integer/)
  })
})
