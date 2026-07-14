# Production readiness

The codebase is deployable; production activation still depends on deployment-owned infrastructure, identities, credentials, and operating decisions. No connector is required to access the portal, and each tenant supplies only the credentials for tools it elects to connect.

## Pre-deployment checklist

- Provision Postgres with backups, point-in-time recovery, encrypted transport, and a restricted non-owner application role. Run both apps against the same `DATABASE_URL`. Migrations force row-level security on every tenant table; production traffic must not use a table owner, superuser, or role with `BYPASSRLS`.
- Mount the reviewed client directory read-only for the services. Keep portal access grants, secrets, and any client exports outside git.
- Put the ops app behind an identity-aware reverse proxy that strips inbound `x-sartre-user-id`, injects the verified subject, and terminates HTTPS. Set `SARTRE_TRUSTED_AUTH_PROXY=true` only behind that boundary.
- Configure `SARTRE_CREDENTIAL_ENCRYPTION_KEYS` as a JSON key-ID-to-base64-key map and set `SARTRE_CREDENTIAL_CURRENT_KEY_ID`. Store the keyring in the deployment secret manager. Keep the previous key until `npm run rotate-credentials` succeeds, verify its audited count, then remove it. The single-key variable is retained only for legacy migration.
- Configure `SARTRE_PUBLIC_BASE_URL` and register the exact HTTPS OAuth callback with each client-owned provider app.
- Supply `ANTHROPIC_API_KEY` only to services that need live LLM execution. The production model remains `claude-opus-4-8`; CI and local tests use scripted fakes.
- Route runner `GET /healthz` for liveness and `GET /readyz` for readiness on `SARTRE_HEALTH_PORT` (default `3001`). Route ops `GET /api/health` as its database readiness probe.
- Run `npm run preflight` with deployment configuration before starting traffic. It performs metadata-only validation and never decrypts or tests provider credentials.
- Run `npm run simulate` before activation. It reports enabled-module blockers, human gates, proposed effects, destinations, fields, audiences/statements, connection readiness, costs, and budget caps without constructing provider clients or executing effects.
- Alert on runner restarts, readiness failures, failed runs, unresolved gates, budget exhaustion, connector test failures, and quality/MVD regressions.
- Complete a restore drill, a credential-revocation drill, and a tenant-isolation review before onboarding real client data.

## Release checks

Run from the repository root:

```sh
npm run build
npm test
npm run typecheck
npm run shadow:fake
```

The CI workflow runs the same four gates. Its shadow check always uses three synthetic, non-client rows.

Then perform provider-specific connection tests using non-production test tenants where available. Warehouse connection tests may incur a small provider-side query charge. Live connector and model verification cannot be represented by CI because credentials and real client data must remain outside git.

## Operational invariants

- Ops records gate decisions; only the runner resumes runs.
- Schedule firing is claimed durably per tenant/module/minute. Declared external effects are claimed by run/step idempotency key; a completed claim reuses its receipt, while an ambiguous pending claim stops for operator review instead of replaying.
- Outbound messages, CRM changes, audience mutations, warehouse effects, and Brain changes remain behind structural human gates.
- Brain changes remain evaluated drafts until an authorized human resolves `brain_change`; there is no auto-activation path.
- Revocation destroys the stored credential envelope and appends an audit event. Connection creation, testing, rotation, and revocation are tenant-scoped and audited.
- Machine-owned MVD and health state live in Postgres runtime artifacts. Git-backed client files remain the source for reviewed manifests and approved Brain documents.
