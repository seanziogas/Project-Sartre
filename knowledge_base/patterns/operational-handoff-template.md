> **Provenance:** imported 2026-07-09 from kiln-os read-only reference copy (`knowledge_base/patterns/operational-handoff-template.md`). Anonymized cross-client pattern; extraction rubric applies to all future additions.

---
type: pattern
date: 2026-02-27
source: client-engagement-extraction
tags: [handoff, documentation, knowledge-transfer]
---

# Operational Handoff Template

A framework for transferring campaign/workflow ownership from consulting team to client team at engagement close. Goal: the client can operate independently without re-teaching.

## Handoff Deliverables

### 1. Documentation Hub
A central index page linking to all operational documentation. Acts as the "start here" for anyone taking over.

**Contains:**
- Links to all workflow docs, campaign docs, and reference materials
- Quick-start guide for common tasks
- Contact information for tool vendors/support
- Glossary of terms and acronyms specific to the engagement

### 2. Operational Handbook
Comprehensive reference covering every system and process built during the engagement.

**Structure:**
- **Infrastructure overview** — what was built, where it lives, how systems connect
- **Workflow documentation** — step-by-step for each workflow/campaign (with screenshots where helpful)
- **Troubleshooting guide** — common issues and how to resolve them
- **Maintenance schedule** — what needs regular attention (inbox health, data quality, etc.)
- **Escalation paths** — when to contact tool support vs. handle internally

### 3. Training Session
Live walkthrough with the person taking ownership.

**Cover:**
- Day-to-day operations (what to check, what to do)
- How to pause/restart campaigns
- How to modify targeting or messaging
- Where to find documentation
- What NOT to change without understanding implications

## Handoff Checklist

- [ ] All workflow documentation is current and matches production state
- [ ] Hub page links are verified and working
- [ ] Handbook covers every active system/workflow
- [ ] Training session completed with designated owner
- [ ] Owner has admin access to all relevant tools
- [ ] Emergency contacts documented (tool support, previous consultants)
- [ ] Known issues and workarounds documented
- [ ] Post-handoff support window defined (e.g., 2 weeks of async Q&A)

## Principles

- **Document for the successor, not yourself** — assume they have zero context
- **Screenshots over text** — visual references reduce ambiguity
- **Version the documentation** — mark the handoff date so the client knows when docs were last verified
- **Include the "why"** — not just how to do something, but why it's set up that way (prevents well-intentioned breaking changes)
