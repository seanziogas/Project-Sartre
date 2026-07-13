# Ops app configuration

The ops surface reads git-backed manifests and file-backed health reports, but run state, gate decisions, and Layer-8 feedback live in Postgres.

Required environment:

- `DATABASE_URL` — the same Postgres database used by `apps/runner`.
- `SARTRE_CLIENTS_DIR` — optional path to client instances; defaults to `clients/`.
- `SARTRE_DATA_DIR` — optional path to health-report files; defaults to `.sartre-data/`.

Both apps run the idempotent `@sartre/db` migration at startup. The ops app records gate decisions; it never resumes runs. The runner polls the shared Postgres store and calls `engine.resume()` after all gates are resolved.
