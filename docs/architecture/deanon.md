# Website de-anonymization

`marketing.deanon` turns provider-observed company web activity into reviewed canonical signals. A deployment adapter pulls raw provider rows into a `signal` staging batch before mapping them to tenant-tagged `IntentEvent` values.

Resolution is deliberately narrow: an event must carry an explicit valid company domain, and that normalized domain must match exactly one active canonical account. Consumer domains, duplicate source IDs, duplicate accounts, ambiguous matches, missing domains, and unmatched domains remain visible in the review plan but are not promoted. A general `needs_review` flag does not suppress an otherwise exact match because it may describe unrelated incomplete account fields; the complete proposal still requires human approval.

The complete plan and proposed canonical signals stop at an `internal_report` gate. Approval permits only canonical signal persistence. The pipeline exposes no connector for outreach, account routing, sequencer enrollment, or CRM writes; downstream action requires a separate enabled module and its own human gate.
