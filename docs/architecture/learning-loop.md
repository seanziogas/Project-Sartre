# Learning loop (speeds 1–2)

`platform.learning` is the scheduled production boundary around the Layer-8 speed 1–2 library. It reads tenant-scoped feedback, separates human corrections from outcome events, and follows two deliberately different paths.

- A correction becomes an exemplar draft only when the reviewer supplied a reason. Unexplained corrections remain metrics only.
- Weekly grade/routing patterns become tuning drafts only after the deployment adapter runs the relevant known-answer eval set and returns a pass. Eval failures appear as an internal diagnostic and cannot enter the brain-change queue.

Every proposed artifact carries draft frontmatter, source feedback-event IDs, and an empty `approved_by`. The full batch stops at a `brain_change` gate. Approval permits idempotent draft-file persistence only; it does not activate the artifact, edit an approved brain document, or apply a threshold. A GTME must review and promote a draft through the existing brain approval workflow.

The pipeline honors the manifest's `capture`, `exemplar_memory`, `weekly_tuning`, and `outcome_optimization` flags. Phase 4 outcome optimization aggregates attributed outcomes into Thompson-sampling allocation proposals and compares historical grades with conversion outcomes for ICP recalibration. Both outputs run their deployment-owned eval, carry source evidence, remain drafts, and share the same `brain_change` gate. Allocation can only redistribute mix among already-approved variants; the pipeline has no live allocation or scoring-write dependency.
