> **Provenance:** imported 2026-07-09 from kiln-os read-only reference copy (`knowledge_base/README.md`). This rubric governs everything in this directory.

# knowledge_base/

Cross-client reusable knowledge. Three sub-directories:

- **`patterns/`** — Recurring approaches that have worked across 2+ engagements (workflow architectures, scoping conventions, integration shapes). Anonymized.
- **`frameworks/`** — Methodologies (e.g., scoping cascades, evaluation rubrics). Anonymized.
- **`templates/`** — Reusable starting points for client artifacts.

Client-specific implementation details stay in `clients/<Client>/`. This directory holds the abstracted, portable distillation.

---

## Extraction rubric (for `patterns/`)

A pattern earns its place here when **all five** apply:

1. **Two or more clients** have used the same approach (not just been pitched it).
2. The pattern is **portable**: another client could adopt the shape without inheriting the original's vocabulary, vendor choices, or proprietary internals.
3. There's a **named trigger condition** — i.e., you can articulate when this pattern is the right call vs. when it isn't.
4. **Anonymization is real**, not cosmetic. Replace client names with generic terms; replace proprietary tools with role-based descriptions ("an event-driven enrichment provider" not "Sixth Sense"). If anonymization makes the pattern useless, it isn't a pattern yet — keep it client-specific.
5. No `proprietary-ip`-flagged content (see `taxonomy.yaml` for tags marked confidential).

### Required sections in a pattern file

Keep these short. A pattern is a navigation aid, not a tutorial.

- **Problem** — the recurring situation that calls for this approach.
- **Approach** — the shape of the solution at concept level. Diagrams welcome; vendor names not.
- **When to use** — explicit trigger conditions.
- **When NOT to use** — common misapplications.
- **Anchors** — list of `related_concepts` pointing to the client-specific source insights. One-way reference: pattern points to clients, never the reverse (so the pattern stays decoupled from any one client's lifecycle).

### Verification expectation

If a newly-extracted pattern hasn't been **back-referenced** from a fresh client insight within 30 days of creation, revisit whether it's a real pattern or whether it was extracted prematurely. Better to retract than to leave dead patterns lingering.

---

## When to extract

`/graph-health` Section 5 (Cross-Client Patterns) flags candidates when a tag appears across 2+ active clients. That's a *prompt*, not a *trigger*. Extraction is a deliberate, judgment-heavy step — never automatic.

The asking-permission rule from `CLAUDE.md` stays in force: Claude must ask before extracting, even when candidates are obvious.

---

**Created:** 2026-05-26
