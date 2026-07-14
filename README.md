# Project Sartre

The Kiln's GTM Operating System — one platform, instanced per client. Repeatable, scalable, reliable; configurable and customizable per client; full GTM stack (sales, marketing, RevOps); connected to the modern AI + GTM tool ecosystem.

**Start here: [PLAN.md](PLAN.md)** — the master build plan (architecture, module map, phases, stack, risks, open items).

Status: the Phase 0–4 platform build is implemented. All 23 locked module IDs have dedicated registered pipelines, Postgres-backed runtime state, structural approval gates, client-scoped encrypted connections, a built-in deployment adapter, and a 40-provider integration catalog. Live provider/model verification still requires deployment-owned credentials; CI uses scripted fakes only.

Core commands:

```sh
npm run build
npm test
npm run typecheck
npm run shadow:fake
```

With deployment environment variables configured, `npm run preflight` validates active client manifests, approved runtime configuration, Brain dependencies, schedules, destinations, and active connection references without decrypting credentials or calling providers.

The ops portal does not require a connected tool. Each client adds only the credentials its enabled modules need; credentials remain tenant-scoped and encrypted. See [runner configuration](apps/runner/README.md), [live connectors](docs/architecture/live-connectors.md), the [production readiness checklist](docs/production-readiness.md), and the [client runtime template](clients/_template/brain/config/standard-runtime.yaml).
