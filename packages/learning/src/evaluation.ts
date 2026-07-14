import type { TuningProposal } from './tuning.js'

export interface LearningDraftLike {
  kind: string
  slug: string
  target: string
  content: string
  sourceEventIds: string[]
}

const targetByKind: Record<TuningProposal['kind'], string> = {
  grading_bias: 'brain/grading.md', grading_segment: 'brain/grading.md', routing_rule: 'brain/routing.md',
}

/** Deterministic safety/evidence eval applied before a tuning proposal reaches review. */
export function evaluateTuningProposal(proposal: TuningProposal): { pass: boolean; detail: string } {
  const failures: string[] = []
  if (proposal.target !== targetByKind[proposal.kind]) failures.push(`target ${proposal.target} is invalid for ${proposal.kind}`)
  if (!proposal.summary.trim() || !proposal.proposedChange.trim() || !proposal.evidence.detail.trim()) failures.push('proposal text and evidence detail are required')
  const unique = new Set(proposal.evidence.eventIds)
  if (proposal.evidence.sampleSize < 8) failures.push('proposal requires at least 8 evidence events')
  if (unique.size !== proposal.evidence.eventIds.length || unique.size !== proposal.evidence.sampleSize) failures.push('event ids must be unique and match sample size')
  if (proposal.evidence.eventIds.some((id) => !id.trim())) failures.push('event ids must be nonempty')
  if (/status:\s*active|approved_by:\s*[^"\s]|auto[- ]?(apply|approve|activate)/i.test(proposal.proposedChange)) failures.push('proposal attempts activation or automatic application')
  return failures.length ? { pass: false, detail: failures.join('; ') } : { pass: true, detail: `${proposal.kind} evidence and draft-only invariants pass` }
}

/** Known-answer structural eval for allocation/calibration drafts. Never applies the draft. */
export function evaluateOptimizationDraft(draft: LearningDraftLike): { pass: boolean; detail: string } {
  const failures: string[] = []
  if (draft.kind !== 'allocation_report' && draft.kind !== 'calibration_report') failures.push(`unsupported optimization draft kind ${draft.kind}`)
  if (!/^brain\/learned\/[a-z0-9][a-z0-9-]*\.md$/.test(draft.target)) failures.push('target must be a slugged file under brain/learned')
  if (!/\nstatus: draft\n/.test(`\n${draft.content}\n`)) failures.push('draft envelope must declare status: draft')
  if (!/\napproved_by: ""\n/.test(`\n${draft.content}\n`)) failures.push('draft envelope must leave approved_by empty')
  const unique = new Set(draft.sourceEventIds)
  if (!unique.size || unique.size !== draft.sourceEventIds.length) failures.push('source event ids must be nonempty and unique')
  for (const id of unique) {
    if (!draft.content.includes(`:${id}`)) failures.push(`source event ${id} is not cited in the draft envelope`)
  }
  if (/status:\s*active|approved_by:\s*[^"\s]|auto[- ]?(apply|approve|activate)/i.test(draft.content)) failures.push('draft attempts activation or automatic application')
  return failures.length ? { pass: false, detail: failures.join('; ') } : { pass: true, detail: `${draft.kind} provenance and draft-only invariants pass` }
}
