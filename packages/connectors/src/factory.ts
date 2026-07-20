import { PROVIDER_CATALOG } from './catalog.js'
import type { SupportedProvider } from './catalog.js'
import type { ConnectionTester } from './contract.js'
import type { HttpTransport } from './http.js'
import { createProviderClient } from './providers.js'
import type { CrmWriteOptions } from './providers.js'
import { McpConnectorClient } from './mcp.js'
import type { McpBridgeCategory, McpBridgeOptions } from './mcp.js'

const MCP_BRIDGEABLE: Record<string, McpBridgeCategory> = { comms: 'comms', meetings: 'meetings', enrichment: 'enrichment' }

const CATEGORY_BY_PROVIDER = new Map<string, string>(PROVIDER_CATALOG.map((provider) => [provider.id, provider.category]))

/** True when this provider has an MCP bridge and the credentials opt into it. */
export function usesMcpTransport(provider: SupportedProvider, credentials: Record<string, string>): boolean {
  return credentials.transport === 'mcp' && MCP_BRIDGEABLE[CATEGORY_BY_PROVIDER.get(provider) ?? ''] !== undefined
}

/**
 * Single construction seam for tenant connections. A connection whose
 * credentials set `transport: 'mcp'` is served by the MCP bridge; every other
 * connection uses the native REST client. Both satisfy the same contract, so
 * pipelines and benchmarks treat them identically.
 */
export function createConnectorClient(
  provider: SupportedProvider,
  credentials: Record<string, string>,
  http: HttpTransport,
  writeOptions?: CrmWriteOptions,
  mcpOptions?: McpBridgeOptions,
): ConnectionTester {
  if (credentials.transport === 'mcp') {
    const category = MCP_BRIDGEABLE[CATEGORY_BY_PROVIDER.get(provider) ?? '']
    if (!category) throw new Error(`provider ${provider} has no MCP bridge; remove transport:mcp or use a comms/meetings/enrichment provider`)
    return new McpConnectorClient(category, credentials, mcpOptions)
  }
  return createProviderClient(provider, credentials, http, writeOptions)
}
