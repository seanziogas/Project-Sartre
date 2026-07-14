# Production readiness

The codebase is deployable; production activation still depends on deployment-owned infrastructure, identities, credentials, and operating decisions. No connector is required to access the portal, and each tenant supplies only the credentials for tools it elects to connect.

## Pre-deployment checklist

- Provision Postgres with backups, point-in-time recovery, encrypted transport, and restricted app credentials. Run both apps against the same `DATABASE_URL`.
- Mount the reviewed client directory read-only for the services. Keep portal access grants, secrets, and any client exports outside git.
- Put the ops app behind an identity-aware reverse proxy that strips inbound `x-sartre-user-id`, injects the verified subject, and terminates HTTPS. Set `SARTRE_TRUSTED_AUTH_PROXY=true` only behind that boundary.
- Generate a unique 32-byte `SARTRE_CREDENTIAL_ENCRYPTION_KEY`, base64-encode it, store it in the deployment secret manager, and establish a rotation/recovery procedure before accepting client credentials.
- Configure `SARTRE_PUBLIC_BASE_URL` and register the exact HTTPS OAuth callback with each client-owned provider app.
- Supply `ANTHROPIC_API_KEY` only to services that need live LLM execution. The production model remains `claude-opus-4-8`; CI and local tests use scripted fakes.
- Route runner `GET /healthz` for liveness and `GET /readyz` for readiness on `SARTRE_HEALTH_PORT` (default `3001`). Route ops `GET /api/health` as its database readiness probe.
- Alert on runner restarts, readiness failures, failed runs, unresolved gates, budget exhaustion, connector test failures, and quality/MVD regressions.
- Complete a restore drill, a credential-revocation drill, and a tenant-isolation review before onboarding real client data.

## Release checks

Run from the repository root:

```sh
npm run build
npm test
npm run typecheck
```

Then perform provider-specific connection tests using non-production test tenants where available. Warehouse connection tests may incur a small provider-side query charge. Live connector and model verification cannot be represented by CI because credentials and real client data must remain outside git.

## Operational invariants

- Ops records gate decisions; only the runner resumes runs.
- Outbound messages, CRM changes, audience mutations, warehouse effects, and Brain changes remain behind structural human gates.
- Brain changes remain evaluated drafts until an authorized human resolves `brain_change`; there is no auto-activation path.
- Revocation destroys the stored credential envelope and appends an audit event. Connection creation, testing, rotation, and revocation are tenant-scoped and audited.
- Machine-owned MVD and health state live in Postgres runtime artifacts. Git-backed client files remain the source for reviewed manifests and approved Brain documents.
