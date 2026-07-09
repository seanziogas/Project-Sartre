> **Provenance:** imported 2026-07-09 from kiln-os read-only reference copy (`knowledge_base/patterns/signal-based-campaign-architecture.md`). Anonymized cross-client pattern; extraction rubric applies to all future additions.

---
type: pattern
date: 2026-02-27
source: client-engagement-extraction
tags: [signals, campaigns, outbound, clay]
---

# Signal-Based Campaign Architecture

A framework for using intent/trigger signals to drive timely, personalized outbound outreach. Instead of static list-based campaigns, signals detect real-time buying indicators and route qualified prospects into sequences.

## Core Concept

**Signal → Enrichment → Personalization → Sequence**

Each signal source monitors for a specific buying indicator. When triggered, the prospect flows through enrichment (company + contact data), AI personalization (contextual messaging), and into the appropriate outreach sequence.

## Signal Categories

### Hiring Signals
- **Job postings** — Company hiring for roles that indicate need for your product (e.g., hiring SDRs = growing outbound = need outbound tooling)
- **Job changes** — Key personas changing companies (warm re-engagement opportunity)
- **Role promotions** — Champions promoted to decision-maker roles

### Company Signals
- **Funding rounds** — New capital = new budget for tools and services
- **Company news / press** — M&A, product launches, strategic shifts
- **Technology adoption** — New tech stack additions detected via technographic data

### Engagement Signals
- **LinkedIn engagement** — Prospects engaging with relevant content
- **Website visits** — Intent data from web tracking (requires compliance consideration)
- **Event attendance** — Conference or webinar participation

## Architecture Pattern

```
[Signal Source] → [Clay Workflow] → [Enrichment + Validation]
                                          ↓
                               [AI Personalization Layer]
                                          ↓
                               [CRM Sync + Sequence Enrollment]
                                          ↓
                               [Notification to Sales Team]
```

## Implementation Approach

1. **Start with 1 signal** — Build, launch, validate, iterate before adding complexity
2. **Daily polling cadence** — True real-time is rarely needed; daily detection is sufficient for most signals
3. **Individual-based output** — Provide specific contacts, not just company-level signals (sellers need people to reach out to)
4. **Stagger signal launches** — Add 1 new signal every 1–2 weeks after the previous one stabilizes
5. **Monitor signal quality** — Track conversion rates per signal to identify which ones actually drive pipeline

## Key Design Decisions

- **Detection scope:** Target account list vs. open market monitoring (tradeoff: precision vs. volume)
- **Output destination:** CRM enrichment vs. dedicated signal tool vs. Slack notification
- **Deduplication:** What happens when the same prospect triggers multiple signals?
- **Compliance:** Some signal sources (LinkedIn scraping, website tracking) have ToS/legal implications

## Common Failure Modes

- Launching too many signals at once (can't debug quality issues)
- Company-level signals without contact routing (sellers don't act on abstract company alerts)
- No feedback loop on signal quality (sends keep going even when a signal is noisy)
- Over-engineering before validating that a signal actually drives meetings
