> **Provenance:** imported 2026-07-09 from kiln-os read-only reference copy (`knowledge_base/patterns/cold-outbound-infrastructure-playbook.md`). Anonymized cross-client pattern; extraction rubric applies to all future additions.

---
type: pattern
date: 2026-02-27
source: client-engagement-extraction
tags: [cold-outbound, email-infrastructure, deliverability]
---

# Cold Outbound Infrastructure Playbook

A repeatable setup framework for standing up cold email infrastructure from scratch. Covers domain strategy through first sends.

## Infrastructure Stack

1. **Domain acquisition** — Purchase 3–5 sending domains per inbox rotation strategy. Use variations of the brand domain (not the primary domain) to protect sender reputation.

2. **Inbox provisioning** — Create dedicated sending inboxes across domains. Distribute volume across inboxes to stay under provider sending limits.

3. **Authentication (SPF/DKIM/DMARC)** — Configure all three for every sending domain before any warm-up begins. Verify with MXToolbox or equivalent. This is non-negotiable for deliverability.

4. **Warm-up period** — Gradually increase send volume over 2–4 weeks. Use a warm-up service (e.g., Instantly's built-in warm-up) to build sender reputation with natural reply patterns.

5. **Sending tool configuration** — Configure campaign sequences, daily send limits per inbox, sending windows, and throttling. Set up reply detection and auto-pause on bounces.

6. **LinkedIn parallel track** — Stand up LinkedIn outreach via automation tool (e.g., HeyReach). Sync with email sequences for multi-channel touches.

## Key Principles

- **Protect the primary domain** — Never send cold email from the client's main domain. Always use purpose-built sending domains.
- **Inbox health monitoring** — Check deliverability scores weekly. Rotate or rest inboxes that show degradation.
- **Volume discipline** — Stay under 50 emails/day/inbox during early stages. Scale gradually based on deliverability metrics.
- **Authentication first** — No emails go out until SPF/DKIM/DMARC are verified and propagated.

## Domain Isolation & Reserve Capacity

### Dedicate Domains Per Campaign

When running multiple campaigns (e.g., different audiences or messaging), assign domains exclusively to one campaign rather than sharing across campaigns.

**Why:**
- **Risk isolation** — a bad campaign only burns its own domains, not the entire infrastructure
- **Diagnostic clarity** — deliverability drops trace directly to the campaign that caused them
- **Clean rotation** — reserve domains swap into a specific campaign without disrupting others
- **No throughput benefit to sharing** — most ESPs (Instantly, Smartlead) share daily caps globally per account regardless of how many campaigns it's in

**When sharing is acceptable:** All campaigns have identical engagement profiles and you have enough domains that per-domain volume stays low regardless.

### Maintain 30-40% Reserve Capacity

Always keep 30-40% of total inbox capacity as warm-but-not-sending backup. This is not optional — it's the difference between a deliverability crisis being a 2-day swap vs. a 2-week rebuild.

**Reserve pool rules:**
- Keep warmup running on all reserve accounts
- Don't assign reserve accounts to any active campaign
- Maintain the same Google:Outlook ratio in reserve as in active pools
- Rotate fatigued active domains into reserve; promote rested reserves to active
- Review domain health monthly

### Domain Fatigue & Rotation

Domains degrade with sustained cold outbound volume. Plan for rotation:
- Monitor spam rates per domain weekly
- If any domain exceeds 20% spam rate, pause and move to reserve
- Rest period: minimum 2-3 weeks before reactivating
- New replacement domains need 2-4 weeks warmup before production sends

## Common Failure Modes

- Skipping warm-up or rushing the ramp (kills deliverability for weeks)
- Sending from too few inboxes (volume concentration = spam flags)
- Not monitoring inbox health post-launch (reputation degrades silently)
- Forgetting DMARC alignment (SPF + DKIM pass but DMARC fails)
- Sharing domains across campaigns with different engagement profiles (one bad campaign poisons all)
- No reserve capacity (deliverability crisis = full stop instead of quick swap)
- Not rotating fatigued domains (reputation degrades silently over months)

## Typical Timeline

| Phase | Duration | Output |
|---|---|---|
| Domain acquisition + DNS | 1–2 days | Domains live, DNS propagated |
| Inbox provisioning + auth | 1–2 days | Inboxes created, SPF/DKIM/DMARC verified |
| Warm-up | 2–4 weeks | Sender reputation established |
| First campaign sends | Week 3–5 | Live outbound at controlled volume |
| Scale-up | Weeks 5–8+ | Full campaign velocity |
