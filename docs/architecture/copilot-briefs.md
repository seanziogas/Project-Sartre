# Copilot briefs

`sales.copilot-briefs` produces internal pre-meeting drafts from two client-scoped sources: `PostgresCanonicalStore.briefContexts(clientId)` supplies account, contact, opportunity, activity, and signal evidence; `FileClientBrainStore.loadContext(clientId, [...])` supplies active, human-approved positioning and ICP rules.

The `copilot-brief@0.1.0` skill returns structured JSON with `status: draft`. Every factual point, recommendation, and meeting question must cite one or more exact canonical evidence IDs. Unknown citations, wrong account identity, wrong generation timestamp, malformed output, or any model-produced approved status trigger a bounded retry and then a surfaced failure.

The pipeline checkpoints canonical input, reserves the estimated token budget before model calls, checkpoints generated drafts, and then stops at an `internal_report` gate. Approval resumes from that checkpoint, so the model is not called or charged twice. Publication is an internal GTME delivery operation after the gate; the module has no CRM-write or outbound-send path.
