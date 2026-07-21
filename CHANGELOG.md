# Changelog

All notable changes to Project Sartre are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project is pre-1.0 and
versioned per `package.json`.

## [Unreleased]

_Nothing yet._

## [0.1.0] — 2026-07-21

The Phase 0–4 platform build. First complete, CI-green cut of the per-client GTM operating
system.

### Platform (Phases 0–4)
- Eight-layer architecture: Client Brain, Integration Hub, Skill Library, Pipeline Engine,
  Ops Surface, Memory Layer, Data Foundation, Learning Engine (see [PLAN.md](PLAN.md)).
- All 23 locked module IDs registered as production pipelines with structural human gates.
- Postgres runtime state with `FORCE ROW LEVEL SECURITY` tenant isolation (ADR 0002).
- Client-scoped tool connections with an AES-256-GCM versioned credential keyring and
  OAuth PKCE (ADR 0003).
- Operational control plane: governance lifecycle, immutable config releases, evaluation
  history, payload-free telemetry, checksum-verified credential-free portability (ADR 0004).
- Next.js ops portal with per-client tenancy: review queues, run/health monitoring,
  learning, governance, releases, connections.
- Data foundation (Day-1 audit, canonical model, entity resolution, MVD gates) and a
  three-speed learning engine.

### Post-audit hardening
- Real brain-grounded logic for the ABM, competitive-takeout, event-follow-up, and TAM
  modules via the GTM Strategist skill, with in-code grounding guards and per-item token
  budgets; built-in adapter is the default, `SARTRE_MODULE_DEPS` remains the override
  (ADR 0005).
- MCP connector transport alongside the native REST clients (comms/meetings/enrichment),
  selectable per connection, with an SSRF guard and a REST-vs-MCP benchmark harness.
- Ops auth middleware backstop; configurable production model via `SARTRE_LLM_MODEL`.
- Corrected the HubSpot OAuth token endpoint; flagged the unverified Fathom OAuth endpoint.
- Fixed a time-rotted portability test; added a local demo seeder (`npm run seed-demo`),
  `docker-compose.yml`, `scripts/verify-local.sh`, and the deployment runbook.

### Documentation
- Full README, CLAUDE.md/AGENTS.md agent guidance, SECURITY.md, and deployment/local-dev
  runbooks.
