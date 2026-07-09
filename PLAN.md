# Project Sartre — Master Build Plan

**The Kiln's GTM Operating System: one platform, instanced per client.**

Every client The Kiln onboards gets a Sartre instance: their brain, their tool connections, their enabled modules, their thresholds, their learned behavior. The core is identical everywhere — that is what makes it repeatable, scalable, and reliable. The configuration and the learning are what make it theirs. The goal is continuous, visible value that makes clients renew: the system compounds on their own data and their own behavior, which makes it very hard to churn from.

**Status:** Final plan, pre-build.
**Decisions locked:** V1 is internal-first but portal-ready. Fresh canonical repo (this one). Built from scratch as a repeatable product — not a replication of any single client engagement. Full GTM stack coverage: sales, marketing, and RevOps.

---

## 1. What Sartre Is

A configurable, per-client GTM operating system that The Kiln deploys for every client at onboarding. It is simultaneously:

1. **The delivery platform** — pods (MD + GTME + TOS) run every engagement through it instead of rebuilding bespoke workspaces per client.
2. **The deliverable** — at engagement end, the instance *is* the working machine the client inherits: documented workflows, their brain, running automations, dashboards.
3. **The retention engine** — always-on modules (hygiene, signals, digests, quality monitoring, learning) keep producing value between and after build tracks, powering renewals and an eventual post-engagement subscription.

### Where it comes from

Sartre consolidates three proven-but-fragmented systems built by The Kiln:

| Source | What it proved | What Sartre takes from it |
|---|---|---|
| **cxt_hub** (internal knowledge base) | The methodology: 4 playbooks sharing a Discovery → Scope → Build → QA spine; ICP, sales process, pod delivery model | Playbooks become the module workflows; sales/delivery docs become the shared knowledge base |
| **kiln-os** (context operating system) | The memory conventions: ingestion, insight nodes, synthesis docs, lifecycle files, graph health, Notion mirrors, client-boundary rules | The memory layer, imported wholesale |
| **Client workspaces** (Hologram, InEight) | The execution machinery: client brains, grading rulebooks, Claude classifier + adversarial-reviewer loops, deterministic template engines, human QA gates, codified routing | The skill library, generalized and made client-agnostic |

---

## 2. Design Principles

Each of these was earned in real engagements, not invented:

1. **Context is the product.** Every client gets a structured Brain; every agent action is grounded in it.
2. **Deterministic where it matters, AI where it helps.** Template engines and rule logic for scale; LLMs for research, classification, and drafting — always with a reviewer loop. (Lesson: "Template engine > LLM-per-row for campaigns over 100 accounts.")
3. **Human gates are features, not friction.** Every outward-facing pipeline ends in a review queue before anything sends or writes.
4. **Non-destructive and auditable.** Flag-don't-delete, namespaced CRM fields, snapshot before write, full run journal, per-field provenance.
5. **Config over code.** Client differences live in a manifest, not forks. Custom work becomes a client-scoped skill with a promotion path to core — never a core patch.
6. **Deliver where the client works.** Slack, Teams, CRM, email — outputs land in their tools.
7. **Never blocked by bad data.** Bad data becomes a scored, priced remediation workstream — not an excuse. (Layer 7.)
8. **Learn from every human action.** Corrections, edits, and outcomes continuously improve the instance — visibly, auditably, and per client. (Layer 8.)
9. **Compound the library.** Anonymized patterns from every engagement flow back into the shared knowledge base under a strict extraction rubric.

---

## 3. Architecture — Eight Layers

### Layer 1: Client Brain
Git-backed, schema-validated markdown per client:

- ICP + fit tiers, firmographics, disqualifiers
- Brand voice (traits, do/don't, rewrite examples, hard constraints)
- Use-case taxonomy and industry map
- Competitors + battlecards + auto-fail lists
- Case studies tagged "use this when" (pain × persona × vertical)
- Buying signals (observable triggers → filters → messaging angle → proof points)
- Grading rulebook (the grading constitution: generous/strict posture, hard disqualifiers, edge cases)
- Routing rules (territories, thresholds, special cases)
- Engagement log (key contacts, decisions, sync notes)
- **Learned artifacts** (Layer 8 writes here): exemplar corrections, tuned thresholds, style examples

Plus **`client.yaml`** — the instance manifest: tools in their stack, modules enabled, thresholds, approval policies, delivery channels, credit budgets, minimum-viable-data status per module.

### Layer 2: Integration Hub
MCP-based connectors, built in order of portfolio frequency — never speculatively:

- **CRM:** Salesforce, HubSpot, Attio
- **Data/orchestration:** Clay (tables, waterfalls, credits)
- **Sequencers:** SmartLead, Instantly, Outreach, SalesLoft, HeyReach, Gong Engage
- **Comms:** Slack, Microsoft Teams, email
- **Meetings:** Fathom, Gong
- **Intent/ABM:** 6sense, G2, Koala/Clearbit Reveal
- **Warehouse:** Snowflake, BigQuery
- **Forms/chat/inbound:** Qualified, HubSpot forms, LinkedIn Lead Gen, generic webhooks

Includes a **portfolio-wide enrichment cache**: no company is ever enriched twice across the portfolio. Direct margin on Clay credits; provenance-aware (source, date, confidence per field).

### Layer 3: Agent Skill Library
Versioned, client-agnostic, brain-grounded skills — each ships with a known-answer eval set that runs in CI:

| Skill | What it does |
|---|---|
| **Brain Builder** | Onboarding pipeline: website scrape + closed-won/lost CRM analysis + transcript mining + stakeholder interviews → draft brain in days; GTME approves |
| **List Grader** | Classify → adversarial-review → retry-until-quality harness, generalized from the proven batch pipeline |
| **List Enricher** | CSV/CRM in → enriched, confidence-flagged records out; web-fetch fallback for thin data |
| **Campaign Factory** | Prioritize → play assignment → deterministic copy engine (selectable methodologies) → auto-generated review deck |
| **Router** | Codified territory/threshold rules with reasoning output |
| **Copilot Briefs** | Pre-meeting intelligence briefs + weekly named-account digests (CRM + conversation + external + intent context) |
| **CRM Hygiene** | Standardize / dedup-flag / maintain, on schedule |
| **Reply Handler** | Triage and draft responses to sequence replies |
| **Signal Watcher** | Monitor buying signals → trigger plays |
| **SOW/QBR Generator** | Engagement documents from transcripts + CRM state |

### Layer 4: Pipeline Engine
Deterministic orchestration of skills into module workflows: resumable runs, checkpointing, per-run token/credit budgets, run journaling, scheduled triggers (signal scans, refresh cycles, digest sends). Pipelines declare their required data coverage (see Layer 7 MVD gates) and their human gates (see Layer 5).

### Layer 5: Ops Surface (internal v1 → client portal in Phase 4)
Web app with per-client tenancy from day one, so flipping it client-facing is a permissions change, not a rebuild:

- **Review/approval queues** — every outward-facing output stops here; every action captured as a feedback event (Layer 8)
- **Run monitoring** — pipeline status, failures, journals
- **Budget tracking** — Clay credits and token spend vs. manifest budgets
- **Baseline → delta metrics reports** — auto-generated per module; this is the renewal artifact
- **Data health dashboard** (Layer 7 output)
- Phase 4 adds: client-facing dashboards, client approval flows, copilot chat over their brain

### Layer 6: Memory Layer
kiln-os conventions imported wholesale: meeting ingestion, insight nodes with attribution ([VERIFIED]/[INFERRED]/[UNVERIFIABLE]), wiki-links, synthesis docs, lifecycle files, graph health, Notion mirrors, emergent taxonomy. This keeps the instance current and makes GTME handoffs painless.

### Layer 7: Data Foundation
**Principle: the system never operates directly on the client's mess, and bad data becomes a workstream instead of a blocker.**

- **Day-1 Data Audit** — automated diagnostic before any module turns on: field fill rates, identifier coverage (domain, email, LinkedIn), duplicate density, staleness, orphan leads, ownership integrity, schema oddities. Output: scored Data Health Report. Doubles as sales collateral (the productized GTM Diagnostic).
- **Canonical data model** — every instance maintains a normalized store (accounts, contacts, opportunities, activities, signals) mapped from whatever shape the client's CRM is in. All skills read/write the canonical layer; a mapping layer translates back through namespaced CRM fields.
- **Ingestion → normalization → entity resolution** — raw connector data lands in staging → standardization rules (the proven dedup standards as default ruleset) → identity resolution: deterministic waterfall first (domain, email, LinkedIn exact), fuzzy fallback, ML-based matching (Zingg pattern) as the enterprise-scale upgrade path. Output: golden records with per-field provenance.
- **Minimum Viable Data (MVD) gates** — every module declares required fields and coverage thresholds (the Field Priority Matrix, formalized). The manifest shows green/yellow/red per module: what can run today, what's blocked, and exactly which gaps block it — with the remediation pipeline and its credit cost attached. **Remediation is a module** — often the first billable track.
- **Continuous quality monitoring** — data contracts on critical fields, drift alerts when fill or match rates decay, scheduled hygiene runs. Standing client-visible value between campaign launches.

### Layer 8: Learning Engine
**Principle: every human action inside the system is a labeled training example, and the system visibly improves the longer a client uses it — which is itself the retention mechanism.**

- **Capture everything as structured feedback events** (from day one — nearly free): approve/reject/edit with diffs, grade overrides, routing corrections, list removals, play reassignments — plus downstream outcomes: replies, meetings booked, opportunities created, closed-won/lost. Each event stores context, machine output, human action, delta, outcome.
- **Learn at three speeds:**
  1. **Instant — exemplar memory.** A corrected grade or edited email becomes a worked example in the client's brain: the grading rulebook grows an edge-case entry; the copy engine gains a style exemplar. (The hand-maintained grading rulebook pattern, automated.)
  2. **Weekly — rule and threshold tuning.** A batch job analyzes override patterns and *proposes diffs to the brain* ("14 routing overrides near the $100M threshold — proposed rule change attached"). GTME approves or rejects. Learning lands as reviewable, git-versioned changes — never silent self-modification.
  3. **Statistical — outcome optimization.** Plays, subject lines, send timing, and channel mix get bandit-style allocation driven by reply/meeting outcomes. ICP scoring recalibrates against deals as they actually close.
- **Guardrails:** every proposed change must pass the skill's eval set before it can be proposed (no regressions on known-answer tests). Learning is client-scoped by default; only anonymized cross-client patterns promote to the shared library through the extraction rubric.
- **Why brains-as-learned-artifacts, not fine-tuning:** exemplars + rules + thresholds in versioned markdown/config get most of the adaptation benefit while staying inspectable, portable across model upgrades, and ownable by the client as part of the machine they inherit.
- **Metrics as product:** override rate, edit distance, and approve-without-edit rate tracked first-class. Declining human correction over time is both proof the learning works and the QBR slide that renews the contract.

---

## 4. Module Map — Full GTM Stack

Every module is on/off per client in the manifest, gated by MVD status.

| Function | Modules |
|---|---|
| **Sales** | Outbound engine (lookalikes, signal-triggered, list-based), ABM plays, closed-lost reactivation, competitive takeout, copilot briefs, rep workflows |
| **Marketing** | Inbound aggregation/scoring/routing, website de-anonymization, event/webinar follow-up, campaign copy factory, ads audience sync |
| **RevOps** | CRM enrichment + hygiene, dedup flagging, lead-to-contact conversion, routing, TAM mapping, reporting + reverse ETL, **data remediation** |
| **Always-on** (the renewal engine) | Hygiene runs, signal watching, weekly digests, quality monitoring, learning loops, metrics reporting |

A typical 3-month engagement turns on two or three build modules; the always-on set keeps the instance valuable after tracks ship.

### Per-client configurability model

1. **Manifest** (`client.yaml`) — tools, modules, thresholds, channels, policies. Handles day-one differences.
2. **Brain** — their ICP, voice, rules, exemplars. Handles what makes their GTM theirs.
3. **Learning** — accumulated corrections and outcomes. Handles everything after day one.
4. **Client-scoped skills** — the escape hatch for genuinely bespoke work, with a promotion path to core when a pattern repeats across 2+ clients.

---

## 5. Build Phases (~16 weeks to Phase 4)

### Phase 0 — Foundation (weeks 1–2)
- This repo becomes the canonical monorepo; define layout.
- **Re-acquire source repos** (local copies were deleted): cxt_hub, kiln-os, client workspaces. ⚠️ Open item — need the canonical remotes.
- Define the Brain schema and `client.yaml` manifest.
- Resolve the canonical module/track taxonomy (merge the three competing taxonomies from cxt_hub into the module map above).
- Import kiln-os conventions and cxt_hub playbooks into the shared knowledge base.

### Phase 1 — Engine core (weeks 2–7)
- Integration hub for the big four: CRM (Salesforce + HubSpot), Clay, Slack/Teams, Fathom. Enrichment cache.
- **Data Foundation core:** Day-1 Data Audit, canonical data model, standardization + entity resolution v1 (deterministic waterfall + fuzzy fallback).
- First three skills extracted and generalized from client-workspace code: **List Grader, List Enricher, Campaign Factory** — each with eval sets in CI.
- Brain Builder v1.
- Feedback-event capture schema defined and wired into everything from the start.

### Phase 2 — Pipelines + review (weeks 7–11)
- Pipeline engine: resumable runs, budgets, journaling, schedules.
- Ops surface v1: review queues (capturing feedback events), run monitoring, budget tracking, metrics reports, data health dashboard.
- **MVD gates** ship with the pipeline engine.
- **Shadow-run two live engagements** through the system in parallel with the current manual motion — same inputs, compare outputs. Validation without a pilot-client dependency.

### Phase 3 — Full stack + standard onboarding (weeks 11–15)
- Remaining modules: inbound routing/scoring, de-anonymization, copilot briefs, CRM hygiene, lead-to-contact, remediation.
- **Learning Engine speeds 1–2:** exemplar memory + weekly tuning-diff jobs.
- Continuous quality monitoring in standard onboarding.
- Codify **Onboarding Week**: new client → Data Audit → Brain Builder → manifest → connectors → first module live. Target: first shipped track in under 2 weeks.
- Train GTMEs. From here, **every new client onboards onto Sartre by default.**

### Phase 4 — Portal + learning at full speed (weeks 15+)
- Flip the ops surface client-facing: approval queues, health dashboards, copilot chat over their brain.
- **Learning Engine speed 3:** outcome optimization (bandits, score recalibration) — clients can watch their system learn.
- Commercial layer: the instance as the machine the client keeps; month-to-month platform subscription post-engagement; the workbench for any placed in-house GTM Engineer.

---

## 6. Technical Stack

- **TypeScript monorepo.** Claude Agent SDK for the agent runtime (newest Claude models by default); MCP for every connector.
- **Postgres** for run state, canonical data model, feedback events, tenancy. Job queue for pipelines.
- **Next.js** for the ops surface (portal-ready tenancy from day one).
- **Brains stay git-backed markdown** — deliberately, so Claude Code remains a first-class *second* runtime: GTMEs drop into any client instance interactively (the proven workspace pattern) while the service runs scheduled/scaled work headlessly.
- Existing Python harnesses ported into skills rather than rewritten from scratch.
- **Licensing note:** do not embed n8n (Sustainable Use License restricts embedding in a commercial product). Use Activepieces (MIT core) or native pipeline code where embedded automation is needed.
- **OSS shortlist to evaluate** (from open-source-gtm review): Stockpile (enrichment cache pattern), Greenware (form → Clay routing), Mold (Clay table chaining), Zingg (ML entity resolution, later), Metabase/Superset (fast dashboard v1 option), Multiwoven (reverse ETL). Zapier's GTM Cheat Codes as a skill-packaging reference.

---

## 7. Reliability, Repeatability, Scale

- **Repeatable:** one schema, one skill library, one onboarding motion; per-client variation confined to manifest + brain + learned artifacts + client-scoped skills.
- **Reliable:** eval sets per skill in CI; adversarial reviewer loops on all classification; snapshot-before-write; human gate on anything outbound; run journal on every pipeline; data contracts + drift alerts; learned changes gated by evals and GTME approval.
- **Scalable:** enrichment cache and tiered enrichment control unit cost; pods run more clients because activation and builds start from the library, not from zero; MVD gates prevent engagements from stalling on bad data; pattern feedback makes client #20 cheaper than client #5.

---

## 8. Risks

1. **Adoption** — internal-tool adoption has failed at The Kiln before (the deprecated daily-todos workflow group). Mitigation: Sartre is the delivery path, not a sidecar; review queues sit inside work GTMEs must do anyway.
2. **Connector sprawl** — build by portfolio frequency, never speculatively.
3. **Custom-work gravity** — bespoke asks become client-scoped skills with a promotion path, never core forks.
4. **Data isolation** — hard tenancy at the storage layer; the anonymization rubric governs anything crossing into the shared library; learning is client-scoped by default.
5. **Learning trust** — silent self-modification would destroy confidence; all learned changes are reviewable diffs gated by evals.
6. **Bad-data engagements** — MVD gates + remediation-as-a-module turn the risk into revenue.

---

## 9. Success Metrics

| Metric | Target / direction |
|---|---|
| Time to first shipped track per new client | < 2 weeks |
| Clients per pod | Up from 3 |
| QA pass rate at review gates (approve-without-edit) | Climbing per client over time |
| Override/edit rate on grading, routing, copy | Declining per client over time |
| Enrichment cost per account (cache hit rate) | Declining portfolio-wide |
| Data health delta per engagement | Reported every engagement, automatically |
| NRR / renewal rate | The numbers the business runs on |

---

## 10. Open Items Before Phase 0

1. **Source repo access** — cxt_hub and kiln-os local copies were deleted; need the canonical GitHub remotes (or re-downloaded archives) plus the Hologram/InEight workspaces for skill extraction.
2. **Naming** — "Project Sartre" is the codename; decide the client-facing product name before Phase 4.
3. **Resourcing** — who builds (Sean + Claude Code, plus which internal engineers), and what the weekly build cadence is.
4. **Taxonomy sign-off** — the merged module map (§4) needs a yes from Services leadership since it replaces three existing track taxonomies.
