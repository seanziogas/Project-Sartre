# Client portal security and copilot

The Phase 4 portal is the existing ops surface with a fail-closed authorization boundary, not a second application. A deployment-owned identity proxy authenticates users and injects a verified subject header after stripping any caller-supplied value. Sartre maps that subject to explicit tenant grants from an external, git-excluded access file.

Roles are intentionally small: `internal_admin` is portfolio-wide, `gtme` is tenant-scoped internal access, `client_approver` can approve operational effects, and `client_viewer` is read-only. Client approvers cannot decide `brain_change`; learned rules and Brain activation remain a GTME responsibility. All decisions use the authenticated email for attribution. UI filtering is convenience—the server action re-fetches the gate and repeats authorization before recording a decision.

The Brain copilot loads only active, attributed, human-approved documents through `FileClientBrainStore`. The skill has no action tools and uses the locked Anthropic production client. Its structured response must cite an allowed Brain filename and an exact excerpt present in the approved context; invented evidence or sources fail the request. Draft, missing, and superseded documents are invisible.

The overview and health pages form the client dashboard: module/MVD state, remediation gaps, subscription state, budget usage, run health, pending reviews, and feedback-derived trust metrics remain tenant-scoped.
