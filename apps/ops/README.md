# Portal configuration

The Phase 4 portal serves pod members and explicitly granted client users. It reads git-backed manifests and approved Brain documents; run state, current MVD/health artifacts, gate decisions, and Layer-8 feedback live in Postgres. A file-backed health-report fallback remains only for upgraded v1 deployments.

Required environment:

- `DATABASE_URL` — the same Postgres database used by `apps/runner`.
- `SARTRE_CLIENTS_DIR` — optional path to client instances; defaults to `clients/`.
- `SARTRE_DATA_DIR` — optional path to health-report files; defaults to `.sartre-data/`.
- `SARTRE_TRUSTED_AUTH_PROXY=true` — explicit assertion that a deployment-owned identity proxy strips inbound `x-sartre-user-id` and injects a verified subject.
- `SARTRE_PORTAL_ACCESS_FILE` — absolute path to the access-grant JSON file matching `docs/portal-access.example.json`. Keep the real file outside git (for example `.sartre-data/portal-access.json`).
- `ANTHROPIC_API_KEY` — required only for Brain copilot requests. The copilot uses `AnthropicLlmClient` with `claude-opus-4-8` by default; override with `SARTRE_LLM_MODEL`.
- `SARTRE_CREDENTIAL_ENCRYPTION_KEYS` + `SARTRE_CREDENTIAL_CURRENT_KEY_ID` — the versioned credential keyring (32 random bytes per key, base64); required only to create, rotate, test, or use client-owned tool connections. The legacy single `SARTRE_CREDENTIAL_ENCRYPTION_KEY` remains readable during migration.
- `SARTRE_PUBLIC_BASE_URL` — public HTTPS origin used to construct provider OAuth callbacks.

`GET /api/health` is the deployment readiness probe and returns unavailable when Postgres cannot be reached.

Both apps run the idempotent `@sartre/db` migration at startup. The ops app records gate decisions; it never resumes runs. The runner polls the shared Postgres store and calls `engine.resume()` after all gates are resolved.

Authentication fails closed. `src/middleware.ts` is a backstop that rejects any request (except `/api/health`) lacking a proxy-asserted identity, so a page that forgets its own `getPortalIdentity` call can never ship unauthenticated; full grant checks still run per page and server action. Client grants are tenant-specific; `client_viewer` is read-only, `client_approver` may decide operational gates, and only `gtme`/`internal_admin` may decide `brain_change`. Reviewer attribution comes from the verified identity, never a form field. Subscription status is checked before approvals, copilot requests, new runs, and resumed runs.

Connections are optional and tenant-owned. Authorized operators can use API credentials or OAuth apps owned by their client, test and rotate credentials, and inspect an append-only activity trail. Secrets are encrypted with tenant-bound authenticated encryption, never returned after submission, and destroyed on revoke.

Additional client tabs provide:

- Operations: current SLO status derived from durable runs.
- Learning: review metrics, draft proposals, and evaluation regressions.
- Releases: immutable configuration capture and two-person environment promotion.
- Governance: residency/retention policy, lifecycle requests, decisions, and portability audit history.

Approving a governance request does not execute it. Execution remains an explicit runner-side operator command. Client approvers can view these controls; only internal admins and GTMEs can manage them.
