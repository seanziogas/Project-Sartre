import { describe, expect, it } from 'vitest'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { McpConnectorClient } from '../src/mcp.js'
import { createConnectorClient, usesMcpTransport } from '../src/factory.js'
import { validateProviderCredentials } from '../src/catalog.js'
import type { MessageSender, TranscriptReader } from '../src/contract.js'

/** Minimal MCP server exposing the tools the bridge expects, over a linked in-memory transport. */
function mockMcpServer(handlers: Record<string, (args: Record<string, unknown>) => unknown>, toolNames: string[]) {
  const server = new Server({ name: 'mock', version: '0.0.1' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolNames.map((name) => ({ name, description: name, inputSchema: { type: 'object' } })),
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const handler = handlers[request.params.name]
    if (!handler) return { isError: true, content: [{ type: 'text', text: `no handler for ${request.params.name}` }] }
    return { content: [{ type: 'text', text: JSON.stringify(handler(request.params.arguments ?? {})) }] }
  })
  return server
}

function linkedBridge<T>(category: 'comms' | 'meetings' | 'enrichment', server: Server): T {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  void server.connect(serverTransport)
  return new McpConnectorClient(category, { transport: 'mcp', serverUrl: 'https://ignored.example' }, {
    transport: () => clientTransport,
  }) as T
}

describe('MCP connector bridge', () => {
  it('sends comms messages through an MCP tool call and returns the receipt', async () => {
    const calls: Array<Record<string, unknown>> = []
    const server = mockMcpServer({ send_message: (args) => { calls.push(args); return { externalId: 'ts-1' } } }, ['send_message'])
    const client = linkedBridge<MessageSender>('comms', server)
    const receipt = await client.sendMessage('C123', 'hello')
    expect(receipt).toMatchObject({ provider: 'mcp-comms', destination: 'C123', externalId: 'ts-1' })
    expect(calls).toEqual([{ destination: 'C123', text: 'hello' }])
  })

  it('reads transcripts through an MCP tool call', async () => {
    const server = mockMcpServer({
      list_transcripts: () => ({ records: [{ externalId: 'm1', title: 'Kickoff', occurredAt: '2026-07-14T00:00:00Z', transcript: 'hi', participants: ['a@x.com'] }], cursor: null }),
    }, ['list_transcripts'])
    const client = linkedBridge<TranscriptReader>('meetings', server)
    const page = await client.listTranscripts()
    expect(page.records).toEqual([{ externalId: 'm1', title: 'Kickoff', occurredAt: '2026-07-14T00:00:00Z', transcript: 'hi', participants: ['a@x.com'] }])
  })

  it('surfaces MCP tool errors instead of silently succeeding', async () => {
    const server = mockMcpServer({}, ['send_message'])
    const client = linkedBridge<MessageSender>('comms', server)
    await expect(client.sendMessage('C1', 'x')).rejects.toThrow(/MCP tool send_message failed/)
  })

  it('testConnection fails closed when a required tool is missing', async () => {
    const server = mockMcpServer({}, ['unrelated_tool'])
    const client = linkedBridge<McpConnectorClient>('comms', server)
    await expect(client.testConnection()).rejects.toThrow(/does not expose required tool/)
  })

  it('honors a per-connection toolMap override', async () => {
    const server = mockMcpServer({ 'slack.post': () => ({ externalId: 'ts-9' }) }, ['slack.post'])
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    void server.connect(serverTransport)
    const client = new McpConnectorClient('comms', {
      transport: 'mcp', serverUrl: 'https://ignored.example', toolMap: JSON.stringify({ sendMessage: 'slack.post' }),
    }, { transport: () => clientTransport })
    expect(await client.sendMessage('C1', 'hi')).toMatchObject({ externalId: 'ts-9' })
  })

  it('rejects a non-HTTPS server URL that is not a private host', () => {
    expect(() => new McpConnectorClient('comms', { transport: 'mcp', serverUrl: 'http://evil.example/mcp' })).toThrow(/must be HTTPS/)
  })

  it('rejects the cloud metadata / link-local address even over HTTPS', () => {
    expect(() => new McpConnectorClient('comms', { transport: 'mcp', serverUrl: 'https://169.254.169.254/latest/meta-data' })).toThrow(/link-local or metadata/)
  })

  it('rejects private and loopback hosts by default (SSRF guard)', () => {
    expect(() => new McpConnectorClient('comms', { transport: 'mcp', serverUrl: 'https://10.0.0.5/mcp' })).toThrow(/public HTTPS endpoint/)
    expect(() => new McpConnectorClient('comms', { transport: 'mcp', serverUrl: 'http://localhost:9200/mcp' })).toThrow(/public HTTPS endpoint/)
  })
})

describe('connector factory transport selection', () => {
  it('routes transport:mcp comms connections to the bridge and native ones to REST', () => {
    expect(usesMcpTransport('slack', { transport: 'mcp', serverUrl: 'https://x.example' })).toBe(true)
    expect(usesMcpTransport('slack', { accessToken: 'xoxb' })).toBe(false)
    // CRM has no bridge, so transport:mcp is not honored as MCP by the guard...
    expect(usesMcpTransport('salesforce', { transport: 'mcp', serverUrl: 'https://x.example' })).toBe(false)
    const bridged = createConnectorClient('fathom', { transport: 'mcp', serverUrl: 'https://x.example' }, { fetch: async () => new Response('{}') } as never)
    expect(bridged.info.id).toBe('mcp-meetings')
  })

  it('refuses transport:mcp for a provider category without a bridge', () => {
    expect(() => createConnectorClient('salesforce', { transport: 'mcp', serverUrl: 'https://x.example' }, {} as never)).toThrow(/no MCP bridge/)
  })
})

describe('MCP credential validation', () => {
  it('accepts an MCP comms connection needing only serverUrl', () => {
    expect(validateProviderCredentials('slack', { transport: 'mcp', serverUrl: 'https://x.example' })).toBe('slack')
  })

  it('rejects an MCP connection without serverUrl', () => {
    expect(() => validateProviderCredentials('slack', { transport: 'mcp' })).toThrow(/serverUrl/)
  })

  it('rejects transport:mcp for a non-bridgeable provider category', () => {
    expect(() => validateProviderCredentials('salesforce', { transport: 'mcp', serverUrl: 'https://x.example' })).toThrow(/no MCP bridge/)
  })
})
