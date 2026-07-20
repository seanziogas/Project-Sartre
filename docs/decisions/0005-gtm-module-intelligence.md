# ADR 0005 — GTM module intelligence: built-in LLM adapter as default

**Date:** 2026-07-20 · **Status:** Accepted

## Context

The ABM, competitive-takeout, event-follow-up, and TAM modules originally shipped
their strategy step as a pass-through in the built-in deployment adapter: it echoed
pre-approved fields from tenant runtime artifacts (`account.fields.play`,
`account.fields.score`, `candidate.evidence[0]`) rather than generating anything.
The pipelines were structurally gated but produced no grounded intelligence. The
open question was whether the real logic should live in the shipped built-in
adapter or be deferred entirely to a deployment-owned `SARTRE_MODULE_DEPS` override.

## Decisions

1. **The built-in adapter is the default source of module intelligence.** These
   four modules now use the brain-grounded `gtmStrategist` skill (LLM planning,
   drafting, scoring) with the runner-injected production model. A fresh
   deployment gets working modules out of the box with no override required.
2. **`SARTRE_MODULE_DEPS` remains the escape hatch, not the requirement.** A
   deployment can still replace any resolver wholesale; the built-in adapter is
   the reference implementation, consistent with "config over code" (PLAN §5).
3. **The runner owns the LLM.** These resolvers expose `Omit<…Deps, 'llm'>`; the
   registry injects the production `AnthropicLlmClient` so a deployment override
   cannot substitute an unreviewed model. Model id is configurable via
   `SARTRE_LLM_MODEL` (default `claude-opus-4-8`).
4. **Grounding is enforced in code, not just prompts.** Takeout proof must quote
   provided evidence (normalized match); ABM contacts must exist on the account
   record; TAM scores are schema-bounded 0–100; evidence-free takeout candidates
   and non-ICP ABM accounts are skipped, never fabricated.
5. **Per-item drafting is fault-tolerant.** One malformed model response drops
   that single item (surfaced in the review summary), never the whole batch, so a
   flaky row cannot strand an entire tenant run.
6. **Per-item token budgets are ceilings.** Each call debits a conservative USD
   estimate via `ctx.spendTokensUsd`; defaults are grounded in Opus 4.8 pricing
   and tuned per client against observed spend.

## Consequences

The four modules generate reviewable, brain-grounded output on a default install;
every effect still stops at its human gate. The deployment-owned adapter path is
preserved for genuinely bespoke logic, and the grounding guards make "grounded
only in the approved Brain" a structural property rather than a prompt request.
