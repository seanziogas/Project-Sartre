# Local click-through (ops portal)

This walks you from zero to a clickable review queue on `localhost`, so you can
see what a GTME sees when an ABM / competitive-takeout / event-follow-up / TAM
plan lands for approval. Everything runs against a local Postgres with seeded,
scripted-LLM data — no live model, provider, or client data is touched.

## What you'll see

The seeder parks four awaiting-approval runs — one per brain-grounded strategy
module — each carrying the plan its skill produced. The review page renders the
plan payload and the approve/reject controls. This is the surface to judge
whether the module output depth and the reviewer UX are right (remaining Step 3).

## Prerequisites

- A local Postgres reachable via `DATABASE_URL`. Any of:
  - **Homebrew:** `brew install postgresql@16 && brew services start postgresql@16 && createdb sartre`
  - **Docker:** `docker run -d --name sartre-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=sartre -p 5432:5432 postgres:16`
  - **No Postgres installed:** run PGlite over a socket with `@electric-sql/pglite-socket` (already a transitive dev dep) and point `DATABASE_URL` at it.
- `npm install && npm run build` at the repo root.

## Steps

```sh
# 1. Point at your local Postgres and a throwaway clients dir (gitignored).
export DATABASE_URL='postgres://postgres:dev@localhost:5432/sartre'
export SARTRE_CLIENTS_DIR="$PWD/.sartre-demo"

# 2. Seed: writes an active "Demo Co" manifest + parks 4 review-gate runs.
npm run seed-demo

# 3. Portal auth is proxy-delegated. For LOCAL DEV ONLY, point the access file
#    at the example grants and enable the trusted-proxy assertion.
export SARTRE_TRUSTED_AUTH_PROXY=true
export SARTRE_PORTAL_ACCESS_FILE="$PWD/docs/portal-access.example.json"

# 4. Start the ops app.
npm run dev --workspace @sartre/ops
```

Then open the portal. Because auth is delegated to a proxy that injects
`x-sartre-user-id`, in local dev you supply that header yourself — the example
access file grants `idp-subject-kiln-admin` full access:

- **curl a page:** `curl -H 'x-sartre-user-id: idp-subject-kiln-admin' 'http://localhost:3000/clients/Demo%20Co/review'`
- **browser:** use a request-header extension (e.g. ModHeader) to add
  `x-sartre-user-id: idp-subject-kiln-admin`, then visit
  `http://localhost:3000/clients/Demo%20Co/review`.

You'll see the four seeded plans in the review queue. `/health`, `/connections`,
`/governance`, `/learning`, and `/releases` are also reachable for the same
client. The copilot tab needs a live `ANTHROPIC_API_KEY` and won't work offline.

> The seeder uses a scripted LLM, so the plans are representative rather than
> freshly generated — exactly what you need to judge output shape and reviewer
> flow. `npm run seed-demo` is idempotent on run ids; re-run it to reset.

## Teardown

```sh
docker rm -f sartre-pg          # if you used Docker
rm -rf .sartre-demo             # throwaway manifest dir
```
