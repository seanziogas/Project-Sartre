# Skill Execution Patterns — Extracted from Client Workspaces

Phase 0 extraction notes (surveyed 2026-07-09 from the Hologram, InEight, and Drata reference copies). These are the proven execution patterns the Layer-3 skill library generalizes in Phase 1. Recorded now so the build starts from evidence, not memory.

## Doctrine (repeated across engagements, verbatim lesson)

> **Template engine > LLM-per-row for campaigns over 100 accounts.** Deterministic, auditable, no hallucination risk, fast iteration.

The proven hybrid: **the LLM does one fuzzy synthesis step** (e.g. a per-row Account Summary), and **deterministic engines do everything else** — points-based priority scoring, template selection, slot-filling — mining the LLM's output with conservative regex extraction that falls back to template defaults. Priority scoring is points-based with explicit thresholds (Hologram closed-lost: High ≥65 / Medium ≥35), never "LLM vibes."

## Pattern 1 — Classifier + adversarial reviewer loop (Hologram `classify_accounts.py`)

The List Grader ancestor. Batch of 20 → classifier emits JSON (score 1–100, controlled vocabularies for industry/use-case) → a separate **reviewer** persona audits the whole batch → `batch_score >= 75` accepts, otherwise the reviewer's issues feed back as "ISSUES FROM PREVIOUS ATTEMPT TO FIX" and it retries (max 3). Checkpoint every 5 batches with resume; JSON parsed defensively (fence-stripping + regex fallback).

Reviewer enforcement is written as **rules, not preferences**: competitors must score 1–20; "a batch where everything is 55–65 is suspicious"; floor rules from the grading rulebook are re-asserted at review time. Brain grounding = concatenation of icp + use-case framework + industry index + grading rulebook + closed-won reference + case studies.

## Pattern 2 — Deterministic shortlist → scoped LLM → validation gates (Drata classification agent)

The more mature classifier; the high-precision upgrade path. Four-axis classification where:
1. Deterministic overrides fire first (known types lock the answer, skip the LLM).
2. Crosswalk lookups build a **shortlist**; shortlist of 0 → cold-record fallback path, 1 → write directly at confidence 1.0 (no LLM call), ≥2 → LLM chooses **only among shortlisted candidates** with their definitions.
3. **Validation gates** after: confidence < 0.65, taxonomy violations, invalid combos, `llm_off_shortlist` → human review queue; clean → write.

Portable-prompt convention worth adopting library-wide: every prompt file carries frontmatter (`version`, `inputs_required`, `output_schema`, `skip_condition`, `review_queue_condition`), `{{variable}}` placeholders, and an audit-trail field (`classification_reasoning`: "every label traces to a signal and a decisive test"). Taxonomy definitions follow a fixed rubric: Includes / Fits / Does-not-include / decisive test, grounded in the economic engine ("where does revenue come from?").

## Pattern 3 — Deterministic campaign factory (Hologram closed-lost `generate_emails.py`)

Email sequence selected on two axes (Email 1 by re-engagement play, Email 2 by use-case group, Email 3 rotating breakup). Merge tags (`{{first_name}}`, `{{company_name}}`) left for the sequencer; rich slots (`{opp_detail}`, `{blocker}`) filled deterministically from the LLM summary. Subject rotation by row index. DNC rows blank out. **Auto-generated review artifact**: a ~20-sample QA doc selected for play → use-case → tier coverage — the ancestor of the Campaign Factory's review deck.

## Pattern 4 — Codified routing (InEight routing skill)

Routing as a versioned rule document, not tribal knowledge: classification-first priority order (disqualified → named-owner classes → geography+revenue), revenue-threshold splits with **dual revenue** (subsidiary revenue for enrichment, parent revenue for routing), explicit territory tables, special cases ("Dubai → X, rest of UAE → Y"), manual-review flags. Output includes reasoning.

## Pattern 5 — Exclusion logic as credit-budget control (InEight)

Account-type is the primary deterministic filter (competitor/partner/university → skip; customer → always full enrich); re-enrichment window (`qualified_date < 90 days → skip`); field × account-type enrich matrix; sanctioned-country hard excludes. Exists because enrichment ≈ 20 credits/account against a finite budget — this is the ancestor of manifest credit budgets + the enrichment cache.

## Grading rulebook shape (Hologram, generalized into the Brain schema)

Posture first ("Grade generously, not strictly"), then hard disqualifiers (incl. named competitor auto-fail list), then floor rules ("confirmed cellular + relevant industry = 66 minimum"), then band↔grade mapping, then edge cases. InEight's exclusion logic is the same document type at the opposite posture — posture is a field, not folklore (see `schemas/brain/README.md`).
