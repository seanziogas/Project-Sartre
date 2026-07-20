import { z } from 'zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type {
  ConnectionHealth,
  ConnectionTester,
  ConnectorInfo,
  EnrichmentProvider,
  MessageReceipt,
  MessageSender,
  TranscriptReader,
  TranscriptRecord,
} from './contract.js'

/**
 * MCP bridge connectors. These implement the same connector contracts as the
 * built-in REST clients, so a tenant can point a connection at an MCP server
 * instead of (or side by side with) the direct provider client and the two
 * paths stay interchangeable and benchmarkable. Writes with snapshot
 * invariants (CRM) intentionally stay on the native clients for now.
 */

export type McpBridgeCategory = 'comms' | 'meetings' | 'enrichment'

/** Contract operation → MCP tool name. Overridable per connection via the toolMap credential (JSON). */
const DEFAULT_TOOL_NAMES: Record<McpBridgeCategory, Record<string, string>> = {
  comms: { sendMessage: 'send_message' },
  meetings: { listTranscripts: 'list_transcripts' },
  enrichment: { enrich: 'enrich' },
}

const CAPABILITIES = {
  comms: ['send_message', 'test_connection'],
  meetings: ['read_transcripts', 'test_connection'],
  enrichment: ['enrich', 'test_connection'],
} as const

const MessageResult = z.object({ externalId: z.string().min(1) })
const TranscriptsResult = z.object({
  records: z.array(z.object({
    externalId: z.string().min(1),
    title: z.string().min(1),
    occurredAt: z.string().min(1),
    transcript: z.string(),
    participants: z.array(z.string()),
  })),
  cursor: z.string().nullable().default(null),
})
const EnrichmentResult = z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))

export interface McpBridgeOptions {
  /** Test seam: a pre-linked transport (e.g. the SDK's InMemoryTransport) instead of Streamable HTTP. */
  transport?: () => Transport
}

interface ToolCallResult {
  isError?: boolean
  structuredContent?: unknown
  content?: Array<{ type: string; text?: string }>
}

export class McpConnectorClient implements ConnectionTester, MessageSender, TranscriptReader, EnrichmentProvider {
  readonly info: ConnectorInfo
  private readonly serverUrl: string | null
  private readonly headers: Record<string, string>
  private readonly tools: Record<string, string>
  private client: Client | null = null

  constructor(
    private readonly category: McpBridgeCategory,
    credentials: Record<string, string>,
    private readonly options: McpBridgeOptions = {},
  ) {
    this.serverUrl = options.transport ? null : validatedServerUrl(credentials.serverUrl)
    this.headers = credentials.accessToken ? { Authorization: `Bearer ${credentials.accessToken}` } : {}
    this.tools = { ...DEFAULT_TOOL_NAMES[category], ...parseToolMap(credentials.toolMap) }
    this.info = { id: `mcp-${category}`, kind: category, capabilities: CAPABILITIES[category] }
  }

  async testConnection(): Promise<ConnectionHealth> {
    const client = await this.connected()
    const { tools } = await client.listTools()
    const available = new Set(tools.map((tool) => tool.name))
    const missing = Object.values(this.tools).filter((name) => !available.has(name))
    if (missing.length) throw new Error(`MCP server does not expose required tool(s): ${missing.join(', ')}`)
    return { ok: true, provider: this.info.id, accountRef: null, detail: `MCP server reachable (${tools.length} tools)` }
  }

  async sendMessage(destination: string, text: string): Promise<MessageReceipt> {
    const value = MessageResult.parse(await this.call('sendMessage', { destination, text }))
    return { provider: this.info.id, destination, externalId: value.externalId }
  }

  async listTranscripts(cursor?: string): Promise<{ records: TranscriptRecord[]; cursor: string | null }> {
    const value = TranscriptsResult.parse(await this.call('listTranscripts', cursor ? { cursor } : {}))
    return { records: value.records, cursor: value.cursor }
  }

  async enrich(domain: string, fields: string[]): Promise<Record<string, string | number | boolean | null>> {
    return EnrichmentResult.parse(await this.call('enrich', { domain, fields }))
  }

  async close(): Promise<void> {
    await this.client?.close()
    this.client = null
  }

  private async connected(): Promise<Client> {
    if (this.client) return this.client
    const client = new Client({ name: 'sartre-connector-bridge', version: '0.1.0' })
    const transport: Transport = this.options.transport
      ? this.options.transport()
      : new StreamableHTTPClientTransport(new URL(this.serverUrl!), { requestInit: { headers: this.headers } }) as Transport
    await client.connect(transport)
    this.client = client
    return client
  }

  private async call(operation: string, args: Record<string, unknown>): Promise<unknown> {
    const name = this.tools[operation]
    if (!name) throw new Error(`mcp-${this.category} has no tool bound for ${operation}`)
    const client = await this.connected()
    let result: ToolCallResult
    try {
      result = await client.callTool({ name, arguments: args }) as ToolCallResult
    } catch (error) {
      await this.close()
      throw error
    }
    if (result.isError) throw new Error(`MCP tool ${name} failed: ${textContent(result)}`)
    if (result.structuredContent !== undefined) return result.structuredContent
    const text = textContent(result)
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`MCP tool ${name} returned non-JSON content`)
    }
  }
}

function textContent(result: ToolCallResult): string {
  return (result.content ?? []).filter((block) => block.type === 'text').map((block) => block.text ?? '').join('')
}

function validatedServerUrl(value: string | undefined): string {
  if (!value?.trim()) throw new Error('MCP serverUrl is required')
  const url = new URL(value)
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  // Link-local (incl. the cloud metadata endpoint) is never reachable — SSRF pivot risk.
  if (isLinkLocalHost(host)) throw new Error('MCP serverUrl must not target a link-local or metadata address')
  const privateHost = isPrivateHost(host)
  // Private/loopback targets are refused unless the deployment explicitly opts in (local dev, self-hosted MCP).
  const allowPrivate = process.env.SARTRE_MCP_ALLOW_PRIVATE_HOSTS === 'true'
  if (privateHost && !allowPrivate) {
    throw new Error('MCP serverUrl must be a public HTTPS endpoint; set SARTRE_MCP_ALLOW_PRIVATE_HOSTS=true to allow private/loopback hosts')
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && privateHost && allowPrivate)) {
    throw new Error('MCP serverUrl must be HTTPS (plain HTTP is allowed only for opted-in private/loopback hosts)')
  }
  return url.toString()
}

function isLinkLocalHost(host: string): boolean {
  if (host.startsWith('169.254.')) return true
  if (host.startsWith('fe80:') || host.startsWith('fe80')) return true
  return false
}

function isPrivateHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
    if (a === 127 || a === 10 || a === 0) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    return false
  }
  if (host === '::1' || host === '::') return true
  if (host.startsWith('fc') || host.startsWith('fd')) return true // IPv6 unique-local
  return false
}

function parseToolMap(value: string | undefined): Record<string, string> {
  if (!value?.trim()) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('MCP toolMap must be a JSON object of {operation: toolName}')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('MCP toolMap must be a JSON object of {operation: toolName}')
  const entries = Object.entries(parsed as Record<string, unknown>)
  if (entries.some(([, name]) => typeof name !== 'string' || !name.trim())) throw new Error('MCP toolMap values must be nonempty tool names')
  return Object.fromEntries(entries) as Record<string, string>
}
