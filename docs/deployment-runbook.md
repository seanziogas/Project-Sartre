# Deployment runbook

Executable companion to [production-readiness.md](production-readiness.md): it maps
each readiness item to the exact command or the concrete action. Items marked
**[you]** are irreducibly deployment-owned — they require your cloud accounts,
provider apps, or a human decision, and cannot be scripted from this repo.

## 0. Local pre-flight (before any deploy)

```sh
docker compose up -d
export DATABASE_URL='postgres://sartre:dev@localhost:5432/sartre'
scripts/verify-local.sh
```

Runs the four CI gates (build, test, typecheck, shadow:fake) and exercises the
Postgres write path via `seed-demo`. To click through the ops portal locally, see
[local-dev.md](local-dev.md).

## 1. Provision infrastructure — **[you]**

- **Postgres:** managed instance with backups, PITR, encrypted transport. Create a
  restricted, non-owner application role (no superuser, no `BYPASSRLS`) — ADR 0002
  requires forced RLS, which a table owner or `BYPASSRLS` role would defeat. Put its
  DSN in `DATABASE_URL`.
- **Identity proxy:** front the ops app with an identity-aware reverse proxy that
  strips inbound `x-sartre-user-id` and injects the verified subject. Only then set
  `SARTRE_TRUSTED_AUTH_PROXY=true`. Point `SARTRE_PORTAL_ACCESS_FILE` at your real
  grants file (shape: [portal-access.example.json](portal-access.example.json)), kept
  outside git.
- **Credential keyring:** generate 32 random bytes per key; set
  `SARTRE_CREDENTIAL_ENCRYPTION_KEYS` (JSON keyID→base64) and
  `SARTRE_CREDENTIAL_CURRENT_KEY_ID`. Retain any prior key until rotation reports all
  envelopes migrated (step 4).
- **OAuth callbacks:** set `SARTRE_PUBLIC_BASE_URL` and register the HTTPS callback
  with each provider app you enable.
- **LLM:** supply `ANTHROPIC_API_KEY` only to services doing live execution/copilot.
  Optionally set `SARTRE_LLM_MODEL` (default `claude-opus-4-8`).
- **Telemetry:** set `OTEL_EXPORTER_OTLP_ENDPOINT`/`_HEADERS`; wire liveness/readiness
  probes to the runner's `SARTRE_HEALTH_PORT` (`/healthz`, `/readyz`) and the ops
  `/api/health`.

## 2. Pre-traffic validation

Once a tenant has an approved `brain/config/standard-runtime.yaml` and active manifest:

```sh
npm run preflight   # validates manifests, approved runtime config, brain deps,
                    # schedules, destinations, and connection references — no
                    # credentials decrypted, no providers called
npm run simulate    # dry-run gate/effect/connection map per active module
```

`preflight` exits non-zero if any active tenant is misconfigured. A freshly seeded
demo tenant will report its missing `standard-runtime.yaml` here — that is preflight
working, not a bug.

## 3. Provider connection tests — **[you]**

Add each tenant's credentials through the ops connections page, then use its
"Test connection" action against a non-prod tenant. Warehouse tests may incur a
small provider-side query charge. This is the only step that touches live providers.

## 4. Credential rotation drill

```sh
# With the new key present in SARTRE_CREDENTIAL_ENCRYPTION_KEYS and CURRENT_KEY_ID set:
npm run rotate-credentials    # re-wraps every envelope to the current key; audited count
# Verify the reported migrated count equals your active connection count, then
# remove the old key from the keyring.
```

## 5. Restore + revocation drills (before real client data) — hard gate

- **Credential revocation:** revoke a test tenant's connection via the ops
  connections page; confirm the stored ciphertext is blanked and an audit event is
  written. (Revocation blanking is covered by `packages/db` tests.)
- **Restore drill:** the governance-gated sequence is:
  1. Export a test tenant's portability bundle (checksummed, credential-free).
  2. `npm run governance-request -- <clientId> restore <requestedBy> "<detail>"`
  3. `npm run governance-decide -- <clientId> <requestId> approved <approver>`
     (approver must differ from requester — ADR 0004).
  4. Clear the tenant, then `npm run restore-tenant -- <bundle-path> <requestId> <actor>`
     into the now-empty target; confirm record counts and the audit trail.

  The restore core (export → purge → restore into an empty target) is verified by
  the `PostgresPortabilityStore` test in `packages/db/test/db.test.ts`; this drill
  exercises the same path against live Postgres before onboarding real data.

## 6. Governance policy per tenant — **[you]**

Set a residency/retention policy for every production tenant; treat exported
portability bundles as encrypted managed storage.

## 7. Ship

```sh
npm run build && npm test && npm run typecheck && npm run shadow:fake
```

Then start the runner (`npm run start --workspace @sartre/runner`) and the ops app
behind the proxy.

## Standing organizational item — **[you]**

Communicate the locked module taxonomy to Services leadership ([taxonomy.md](taxonomy.md) §note).
