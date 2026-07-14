# ADR 0002 — Database tenant isolation and durable effects

**Date:** 2026-07-14 · **Status:** Accepted

## Context

Application predicates alone did not provide a database-enforced tenant boundary. The runner's accepted in-memory fired-slot ledger also did not protect multiple replicas, and a process failure around an external write could cause an unsafe replay.

## Decisions

1. Every tenant table enables and forces PostgreSQL row-level security. Tenant queries set a transaction-local `sartre.client_id`; the few fleet-wide runner queries explicitly set `sartre.system_access`.
2. Production uses a restricted non-owner role without `BYPASSRLS`.
3. Scheduled launches claim `(client_id, module_id, minute_slot)` in Postgres before starting.
4. Pipeline steps that perform external or durable effects are declared as effects and claim `(client_id, run_id:step_id)` with a payload hash. Completed claims return their stored receipt. A conflicting payload or an unresolved pending claim fails closed and requires operator review.

## Consequences

Horizontal runner replicas do not double-fire the same schedule slot. Effect replay is safe when completion was recorded, and ambiguous writes are never guessed or automatically repeated. Human gates remain mandatory and precede every operational effect.
