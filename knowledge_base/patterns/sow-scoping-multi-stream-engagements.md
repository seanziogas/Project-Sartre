> **Provenance:** imported 2026-07-09 from kiln-os read-only reference copy (`knowledge_base/patterns/sow-scoping-multi-stream-engagements.md`). Anonymized cross-client pattern; extraction rubric applies to all future additions.

---
type: pattern
date: 2026-02-27
source: client-engagement-extraction
tags: [sow, scoping, project-management, multi-stream]
---

# SOW Scoping for Multi-Stream Engagements

A framework for structuring statements of work when an engagement has multiple parallel workstreams with shared dependencies.

## Core Approach: Sequenced Phases with Staggered Streams

Instead of scoping everything as one flat deliverable list, structure the SOW around:
1. **Phases** (time-bounded chunks, typically 2–4 weeks each)
2. **Streams** (parallel workstreams that progress through phases independently)
3. **Dependencies** (where one stream blocks another)

## SOW Structure Template

### Engagement Overview
- Total duration and phase breakdown
- Stream definitions with ownership
- Dependency map between streams

### Per-Stream Scope
For each workstream:
- **Objective** — what this stream delivers
- **Phases** — week-by-week plan with specific deliverables
- **Dependencies** — what must happen before this stream can proceed
- **Client requirements** — what the client must provide, with deadlines
- **Success criteria** — how to measure completion

### Dependency Map
Visual or tabular mapping of:
- Which streams can run in parallel
- Where streams converge (shared dependencies)
- Client-side blockers that affect multiple streams

## Key Principles

### 1. Start with the blocker analysis
Before writing the SOW, identify every client-side dependency. These are the real timeline drivers — your team's capacity is rarely the bottleneck.

### 2. Stagger stream launches
Don't start all streams in Week 1. Launch the highest-priority stream first, then stagger others as dependencies resolve. This provides:
- Focus for the client team (fewer concurrent asks)
- Buffer for requirement gathering delays
- Natural checkpoints for scope validation

### 3. Build one, then scale
Within each stream, build the first instance (first signal, first enrichment workflow, first campaign) as a template, validate it, then replicate the pattern for subsequent instances.

### 4. Define "Week 1" relative to requirements
Don't anchor timelines to calendar dates — anchor them to "X weeks after requirements confirmed." This protects against client-side delays without renegotiating the SOW.

### 5. Separate the known from the TBD
Scope what you know concretely. For later phases where requirements are still forming, define the process (requirements gathering → design → build → validate) rather than specific deliverables.

## Common Scoping Mistakes

- Scoping all streams with the same start date (creates a requirements bottleneck for the client)
- Fixed calendar deadlines when client requirements aren't confirmed yet
- Not specifying who on the client side owns each dependency
- Combining "build" and "operate" in the same SOW without clear transition criteria
- Over-specifying later phases (requirements will evolve — keep Phase 3 lighter than Phase 1)

## Meeting Cadence Recommendation

| Meeting | Frequency | Purpose |
|---|---|---|
| Stream-level standup | Weekly | Progress, blockers, next steps per stream |
| Cross-stream sync | Bi-weekly | Dependency coordination, priority arbitration |
| Strategic review | Monthly/quarterly | Scope validation, phase transition, re-planning |
| Deep dives | As needed | Technical design sessions for specific deliverables |
