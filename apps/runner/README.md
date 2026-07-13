# Runner configuration

The runner polls the same Postgres database as the ops app and registers all three production pipelines from `@sartre/modules`.

Required environment:

- `DATABASE_URL` — shared Postgres connection string.
- `ANTHROPIC_API_KEY` — used only through `AnthropicLlmClient` with `claude-opus-4-8`.
- `SARTRE_MODULE_DEPS` — path to a deployment-owned ESM module exporting `createModuleDeps(context)`.
- `SARTRE_CLIENTS_DIR` — optional client-instance path; defaults to `clients/`.
- `SARTRE_TICK_MS` — optional polling interval; defaults to 30 seconds.

The deployment module keeps credential-bearing connector construction and client-specific brain configuration outside the platform registry. It receives `{ db }`; the runner owns and injects the locked production model adapter separately. It must return:

```ts
{
  enrichment: EnrichmentRefreshDeps,
  reactivation: Omit<ReactivationDeps, 'llm'>,
  inbound: InboundRoutingDeps,
}
```

Startup fails when the module is absent or incomplete. The runner never falls back to an empty registry, scripted connector, or alternate model, and deployment code cannot replace the reactivation pipeline's LLM client.
