# Connector benchmark (REST vs MCP)

Runs the same connector operation through the native REST client and the MCP
bridge and reports latency (p50/p95/mean) and output parity, so the two
transports can be compared head to head against the shared connector contract.

Applies to the MCP-bridgeable categories: **comms**, **meetings**, **enrichment**.

## Run

```sh
npm run build   # once, to compile @sartre/connectors
cp tools/connector-bench/config.example.json my-bench.json   # fill in real values; keep out of git
node tools/connector-bench/run.mjs my-bench.json
```

## Config

| Field | Meaning |
|---|---|
| `provider` | A comms/meetings/enrichment provider id from the catalog (e.g. `slack`, `fathom`, `clay`). |
| `operation` | `sendMessage` (comms), `listTranscripts` (meetings), or `enrich` (enrichment). |
| `iterations` | How many times to run each transport (default 10). |
| `args` | Operation args — `{destination,text}` / `{cursor?}` / `{domain,fields}`. |
| `rest` | Credentials for the native REST client (e.g. `{accessToken}` / `{apiKey}`). |
| `mcp` | `{serverUrl, accessToken?, toolMap?}` — the MCP server exposing equivalent tools. |

To reach a local MCP server over plain HTTP, set `SARTRE_MCP_ALLOW_PRIVATE_HOSTS=true`
(the bridge blocks private/loopback hosts by default as an SSRF guard).

## What's verified in CI

The benchmark engine (`benchmarkConnectorOperation` in `@sartre/connectors`) is
covered by `packages/connectors/test/benchmark.test.ts`, which drives it against a
mock MCP server and a fake REST client and asserts latency stats, parity matching,
mismatch detection, and error handling. This CLI is the thin wrapper that points
that verified engine at real endpoints.
