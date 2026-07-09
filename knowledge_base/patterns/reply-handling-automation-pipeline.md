> **Provenance:** imported 2026-07-09 from kiln-os read-only reference copy (`knowledge_base/patterns/reply-handling-automation-pipeline.md`). Anonymized cross-client pattern; extraction rubric applies to all future additions.

---
type: pattern
date: 2026-02-27
source: client-engagement-extraction
tags: [automation, replies, crm, sentiment-analysis]
---

# Reply Handling Automation Pipeline

A framework for automatically processing inbound replies from outbound campaigns — classifying sentiment, updating CRM, and routing to the right team member.

## Pipeline Architecture

```
[Reply Detected] → [Webhook Trigger] → [Enrichment Layer]
                                              ↓
                                    [AI Sentiment Classification]
                                              ↓
                                    [CRM Record Update]
                                              ↓
                                    [Team Notification (Slack/Email)]
```

## Pipeline Stages

### 1. Reply Detection
Sending tool (e.g., Instantly) detects a reply to an outbound sequence.
- Auto-pause the prospect's sequence to prevent follow-ups while processing
- Capture: reply body, original message context, prospect metadata

### 2. Webhook Trigger
Reply data fires to an enrichment tool (e.g., Clay) via webhook.
- Include: sender email, reply content, campaign ID, sequence step

### 3. AI Sentiment Classification
LLM classifies the reply into actionable categories:
- **Interested** — wants to learn more, book a meeting
- **Not interested** — polite decline, not a fit
- **Out of office** — auto-reply, reschedule follow-up
- **Wrong person** — refers to someone else (extract referral if possible)
- **Unsubscribe** — remove from all sequences immediately
- **Needs context** — asking a question, needs human response

### 4. CRM Update
Based on classification:
- Update contact/lead status in CRM
- Log the reply as an activity
- Create a task for the account owner if human action needed
- Update campaign member status

### 5. Team Notification
Route to the right person:
- **Interested** → SDR/AE via Slack with priority flag
- **Referral** → SDR with referral context
- **Unsubscribe** → Auto-handled, no notification needed
- **Needs context** → SDR for manual follow-up

## Design Considerations

- **Speed matters for interested replies** — minimize latency between reply and seller notification
- **Sentiment accuracy** — test classification on real replies before production; edge cases (sarcasm, conditional interest) need human review
- **CRM hygiene** — every reply should result in a CRM status change (prevents re-contacting people who already replied)
- **Unsubscribe compliance** — immediate, automatic, no exceptions
- **Duplicate handling** — same person replying to multiple sequences should be deduplicated
