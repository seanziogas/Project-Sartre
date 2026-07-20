// REST-vs-MCP connector benchmark CLI.
//
// Usage:
//   node tools/connector-bench/run.mjs tools/connector-bench/config.example.json
//
// The config names a provider (comms / meetings / enrichment category), a REST
// connection, and an MCP connection for the SAME provider, plus the operation to
// exercise. Both clients are built through the real connector factory, so this is
// the production code path — you just point it at your endpoints. Credentials are
// read from the config; keep real configs out of git.
import { readFileSync } from 'node:fs'
import {
  benchmarkConnectorOperation,
  createConnectorClient,
  formatComparison,
  productionHttpTransport,
} from '@sartre/connectors'

const configPath = process.argv[2]
if (!configPath) {
  console.error('usage: node tools/connector-bench/run.mjs <config.json>')
  process.exit(1)
}
const config = JSON.parse(readFileSync(configPath, 'utf8'))
const { provider, operation, iterations = 10, rest: restCreds, mcp: mcpCreds, args = {} } = config

const http = productionHttpTransport()
const restClient = createConnectorClient(provider, restCreds, http)
const mcpClient = createConnectorClient(provider, { transport: 'mcp', ...mcpCreds }, http)

// Map the requested operation to a call on whatever contract the client implements.
function op(client) {
  switch (operation) {
    case 'sendMessage': return () => client.sendMessage(args.destination, args.text)
    case 'listTranscripts': return () => client.listTranscripts(args.cursor)
    case 'enrich': return () => client.enrich(args.domain, args.fields ?? [])
    default: throw new Error(`unsupported operation: ${operation}`)
  }
}

const result = await benchmarkConnectorOperation({
  iterations,
  rest: op(restClient),
  mcp: op(mcpClient),
})

console.log(`provider=${provider} operation=${operation}`)
console.log(formatComparison(result))
if (result.parity.matched < result.parity.compared) {
  console.log('\n⚠️  transports produced diverging output — inspect the mismatched iterations above.')
}
