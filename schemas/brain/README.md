# Brain Schema v0.1

Phase 0 deliverable. Defines the file set and frontmatter contract for a client Brain (`clients/<name>/brain/`). Derived from PLAN.md Layer 1 and the common brain surface observed across the Hologram and InEight workspaces (both converged on the same ~8 document types independently — that convergence is the schema).

Brains are git-backed markdown. Every brain file carries YAML frontmatter validated against the schemas in this directory; bodies are free-form markdown following the section conventions below. Skills load brain files as grounding context (the Hologram classifier's `load_context` pattern: icp + use-case framework + industry index + grading rulebook + closed-won reference + case studies concatenated into the system prompt).

## File inventory

| Path | Req | Content contract |
|---|---|---|
| `company.md` | ✅ | Company profile: products, pricing, value props, buying motion, key customers, market context, engagement contacts |
| `icp.md` | ✅ | Minimum qualifications; firmographic bands; verticals ranked by tier; **disqualifiers in three severity levels** (immediate / careful-qualification / walk-away); deal-size distribution; sales motion by segment |
| `voice.md` | ✅ | Brand voice: personality traits ("what it means" + "in practice"), tone by context, language do/don't, **generic→branded rewrite examples**, hard constraints (e.g. "no em dashes", word limits) |
| `grading.md` | ✅ | The grading constitution: **posture** (generous vs strict, stated first), hard disqualifiers (incl. competitor auto-fail list), **floor rules** ("confirmed X + relevant industry = B minimum"), score-band ↔ letter-grade mapping, edge cases. Layer 8 speed-1 appends worked examples here |
| `use-cases.md` (+ `use-cases/*.md`) | ✅ | Controlled use-case vocabulary: per entry Definition / Keywords-signals / Data profile / Examples; industry mapping; deep-dive file per use case as needed |
| `industries/_index.md` (+ `industries/*.md`) | ○ | Battlecard per vertical: priority tier, customers, pain points, key message, proof stat/quote, CRM picklist value |
| `competitors/*.md` | ○ | Battlecards + the competitor auto-fail list (referenced by `grading.md`) |
| `case-studies/*.md` | ○ | Fixed schema: Challenge / Solution / Results (with quotes) / Technical Requirements / Why We Won — frontmatter tags `use_when` (pain × persona × vertical) |
| `signals.md` | ○ | Buying signals: observable trigger → tool filters (e.g. Clay) → messaging angle → proof points → verticals where it hits hardest |
| `routing.md` | ○ | Territory tables, revenue/threshold splits, **classification-first priority order**, special cases, manual-review flags |
| `data-conventions.md` | ✅ | Namespaced CRM field map (`<Prefix>_*__c` / "(Clay)" columns), controlled picklists, enrichment output columns, sentinels (`NEEDS REVIEW`, `NOT APPLICABLE - {reason}`), re-enrichment window (e.g. qualified-date < 90d → skip), exclusion rules by account type |
| `engagement-log.md` | ✅ | Key contacts, decisions, sync notes — append-only |
| `learned/` | ✅ (dir) | **Layer 8 writes here, humans approve:** `exemplars/` (corrected grades, edited copy as worked examples), `thresholds.yaml` (tuned values with provenance), `style/` (approved copy exemplars) |

✅ = required for MVD "brain-ready"; ○ = module-dependent (e.g. `routing.md` required only when `revops.routing` or `marketing.inbound` is enabled — modules declare brain-file requirements the same way they declare data MVD).

## Frontmatter contract (all brain files)

```yaml
---
brain_doc: icp            # one of the inventory types above
client: <Client Name>
status: active            # active | draft | superseded
updated: YYYY-MM-DD
sources:                  # provenance — where this content came from
  - "[[2026-07-01-kickoff-call]]"
approved_by: <GTME>       # human gate: brains are approved artifacts
---
```

Attribution inside bodies follows memory-layer conventions: client facts carry `[VERIFIED: source]` / `[INFERRED: logic]` / `[UNVERIFIABLE]` tags, especially in `icp.md` and `grading.md` where a wrong "fact" silently poisons every downstream grade.

## Design notes

- **Grading posture is a first-class field, not folklore.** Hologram's rulebook opens with "Grade generously, not strictly"; InEight's exclusion logic is the opposite posture (credit conservation). Both are the same document type with a different `posture:`.
- **Floor rules beat weights.** The proven rulebooks express quality as floors ("confirmed cellular + relevant industry = 66 minimum") and hard fails, not weighted averages. The schema keeps them as explicit rules the reviewer loop can enforce ("a batch where everything is 55–65 is suspicious").
- **Machine-readable where machines consume it.** Controlled vocabularies (use cases, industries, picklists) are enumerated in frontmatter lists so classifiers can validate output against them; prose stays for humans and prompts.
