# ADR 0004 — Operational control plane and human-authorized lifecycle actions

**Date:** 2026-07-14 · **Status:** Accepted

## Context

Production operation needs service objectives, data lifecycle controls, environment promotion, visible eval history, and client handoff/restore. These capabilities are cross-cutting platform concerns, not GTM modules, and must not weaken tenant boundaries or human approval gates.

## Decisions

1. Cross-cutting types and deterministic policies live in `@sartre/operations`; locked module IDs remain unchanged.
2. The runner emits standard OTLP/HTTP telemetry and the portal calculates explicit SLOs from durable run state. Telemetry is payload-free and fails open.
3. Governance actions use durable request → human decision → explicit execution states. Deletion and config promotion require a different approver from requester.
4. Immutable configuration releases promote development → staging → production. The runner consumes the newest active production release when one exists.
5. Evaluation executions and draft learning artifacts are visible together, but evaluation success never activates a Brain change.
6. Portability bundles are checksummed and credential-free. Restore requires approval and an empty destination; connection secrets are always re-entered.

## Consequences

Operational automation is reviewable and tenant-scoped. Client lifecycle actions have attributable evidence, production configuration is reproducible, and a tenant can be backed up or moved without transferring deployment credentials.
