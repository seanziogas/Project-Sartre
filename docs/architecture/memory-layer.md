# Memory Layer (Layer 6) — kiln-os Conventions, Imported

Phase 0 deliverable. Specifies what Sartre imports from kiln-os v1.4.1 (read-only reference copy surveyed 2026-07-09), what changes, and why. PLAN.md says "imported wholesale" — this doc is the receipt: near-wholesale, with deltas listed in §3.

## 1. Imported as-is

### Per-instance directory shape
Each Sartre instance gets the kiln-os client layout under `clients/<name>/`:

```
clients/<name>/
├── _lifecycle.yaml        # status source of truth (active | archived) + engagement metadata
├── client.yaml            # SARTRE ADDITION — instance manifest (Layer 1)
├── brain/                 # SARTRE ADDITION — structured Brain (Layer 1), schema-validated
├── context/               # raw background: slack-history/, call-transcripts/, notion-export/
├── meetings/              # internal/ + external/
├── insights/              # atomic knowledge nodes
├── deliverables/<project>/  # source-of-truth.md at root; docs/, pdfs/, html-pages/, data/, scripts/
├── notion/                # mirror registry (_index.yaml) + per-workstream context-brief.md
├── updates/meetings/      # meeting follow-up archive
├── skills/                # SARTRE ADDITION — client-scoped skills
└── _synthesis/            # engagement-summary.md (mandatory), current-status.md, call-prep.md
```

### Insight nodes + attribution
One markdown file per concept, kebab-case descriptive names. Frontmatter: `client`, `project_type`, `date`, `status`, `tags`, `source`, `source_file` (wiki-link back to raw material), optional `template`, `related_concepts`. Body: title → summary → Key Points → Context → Evidence → Next Steps → Related Concepts.

Attribution system, unchanged: `[VERIFIED: source]` (direct evidence, tag under the blockquoted quote), `[INFERRED: logic]`, `[UNVERIFIABLE]`. Rule: no client fact without a source. Honesty over confident guessing.

### Wiki-links
`[[target]]` in frontmatter and prose; forward references legal (placeholders, not breakage); pipe aliases and anchors resolve on target. The 8 resolution rules (bare-stem, client-prefix, internal-prefix, notion context-brief, notion group shortcut, path-style, alias/anchor, attachment extensions) import unchanged. Orphan = active node with <2 links; well-connected = 3+.

### Emergent taxonomy governance
Taxonomy is discovered, not designed. Terms validate at 3+ uses (threshold locked). Blessed status values (`backlog planned in-progress completed paused cancelled active` — `active` = evergreen, exempt from staleness). Emerging tags tracked with count/first_seen/last_seen/contexts. `max_tags_per_document: 7`; sprawl % is informational only. The `proprietary-ip` tag blocks extraction to shared space.

### Meeting ingestion
The `/ingest` router + `meeting-ingestion` skill flow: classify internal/external → save raw transcript with frontmatter → analyze (decisions, action items, insights, pain points, requests, strategic direction, questions) → present summary → extract team vs client to-dos → extract **1–5** insight nodes (never over-extract) → link, status, taxonomy-track → append summary back to the meeting file. Multi-client meetings use the primary + pointer convention; `proprietary-ip` content never cross-references.

### Graph health
The 11-section health check (insights inventory, taxonomy health, link health, lifecycle health with last-touched = max(git date, mtime), cross-client pattern detection, synthesis coverage, template health, ingestion registry, skill health, mirror sync, trends vs snapshots) with `Healthy | Warning | Needs Attention` rating, thresholds sourced from taxonomy config ("if the YAML drifts, the YAML wins"), snapshots saved as yaml + md + html. In Sartre this runs **scheduled per instance** (Layer 4) instead of on-demand, feeding the ops-surface data health dashboard.

### Notion mirror
One-way, markdown is source of truth. Per-client `notion/_index.yaml` registry (`os_path`, `notion_url`, `workflow`, `last_synced`, `sync_mode: static | frozen`). Engagement summary mirror mandatory for active clients. Generalized in Sartre to a **delivery-channel abstraction**: Notion is one target; the same registry pattern drives mirrors to whatever the manifest's delivery channels specify.

### Extraction rubric (cross-client boundary)
A pattern crosses to shared `knowledge_base/patterns/` only when ALL hold: used by 2+ clients; portable without original vocabulary/vendors; named trigger condition; real anonymization; no `proprietary-ip`. Pattern files: Problem / Approach / When to use / When NOT to use / one-way anchors. Extraction is proposed, never automatic. If no fresh client insight back-references the pattern within 30 days, reconsider it.

### Templates
The 12 validated kiln-os templates (issue, project, strategy, decision, meeting, internal-meeting, onboarding-assessment, crisis-assessment, engagement-alignment, synthesis-current-status, synthesis-engagement-summary, project-context) import as the instance template set. No-fit rule: generic insight + `template: emergent`, propose a new template after 3+ similar.

## 2. Why this matters to Sartre

The memory layer is what keeps an instance current between builds and makes GTME handoffs painless — and in Sartre it is also **substrate for Layers 7–8**: insight nodes and meeting ingestion feed the Brain Builder; graph health feeds the data health dashboard; the extraction rubric governs the library flywheel (Design Principle 9).

## 3. Deltas from kiln-os

| Change | Rationale |
|---|---|
| `brain/` + `client.yaml` + `skills/` added to the client dir | Layer 1 structure; kiln-os kept unstructured `context/` only |
| Graph health + mirror sync run scheduled, not on-demand | Sartre has a pipeline engine; kiln-os relied on someone remembering |
| Notion mirror generalized to delivery channels | Design Principle 6 — deliver where the client works (Slack, Teams, CRM, email) |
| Taxonomy/templates/skills registries become per-instance config with shared defaults | Multi-tenant: each instance evolves its own emergent taxonomy; kiln-os had one global set |
| Ingestion types beyond meetings (slack-history, email-thread, document) get built, not scaffolded | Connectors (Layer 2) make them cheap; kiln-os had them commented out |
| Typed link ontology (from the original-OS reference: `enables`, `supports`, `implements`, …) noted as an upgrade path, not imported | kiln-os dropped it for good reason (friction); revisit only if graph queries need it |

## 4. Cautionary tale, encoded

kiln-os's daily-todos cluster (~10 skills + a local web app) was deprecated wholesale in May 2026 because optional internal tooling didn't get adopted; meeting follow-ups remained the real cadence. Sartre's mitigation is structural (PLAN.md §8.1): the review queue sits inside work GTMEs must already do — nothing in the memory layer depends on a voluntary daily habit.
