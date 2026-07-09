import { z } from 'zod'

/**
 * Feedback events (Layer 8). Every human action inside the system is a
 * labeled training example. Capture is nearly free from day one; the three
 * learning speeds consume these later.
 *
 * Two families:
 *  - HumanActionEvent — a person acted on a machine output (the label).
 *  - OutcomeEvent     — something happened downstream (the reward signal).
 */

export const HumanAction = z.enum([
  'approve', // approved as-is (approve-without-edit rate is a first-class metric)
  'approve_with_edit',
  'reject',
  'grade_override',
  'routing_correction',
  'list_removal',
  'play_reassignment',
  'threshold_change',
  'brain_edit',
])
export type HumanAction = z.infer<typeof HumanAction>

/** What the machine produced, captured verbatim so the delta is computable forever. */
export const MachineOutput = z.object({
  skillId: z.string().min(1), // e.g. "list-grader@0.1.0"
  runId: z.string().min(1), // links to the run journal
  /** Reference to the item acted on: canonical record id, queue item id, draft id. */
  itemRef: z.string().min(1),
  output: z.unknown(), // the actual machine output (grade, draft, route, …)
  /** Brain state the output was grounded in (git commit of the client repo/dir). */
  brainVersion: z.string().optional(),
})
export type MachineOutput = z.infer<typeof MachineOutput>

export const HumanActionEvent = z.object({
  kind: z.literal('human_action'),
  id: z.string().uuid(),
  clientId: z.string().min(1),
  occurredAt: z.string().datetime(),
  actor: z.string().min(1), // who acted (GTME, client user in Phase 4)
  action: HumanAction,
  machine: MachineOutput,
  /** The human's replacement/correction, same shape as machine.output where applicable. */
  humanOutput: z.unknown().optional(),
  /**
   * Structured delta between machine and human output. For text: a unified
   * diff; for grades/routes: { from, to }. Kept alongside the raw outputs so
   * cheap queries don't recompute diffs.
   */
  delta: z.unknown().optional(),
  /** Free-text reason if the human gave one — exemplar memory quotes these. */
  reason: z.string().optional(),
  /** Where it happened: review queue, CRM, Slack, Claude Code session. */
  surface: z.enum(['review_queue', 'crm', 'slack', 'teams', 'email', 'cli', 'other']).default('review_queue'),
})
export type HumanActionEvent = z.infer<typeof HumanActionEvent>

export const OutcomeKind = z.enum([
  'reply_positive',
  'reply_negative',
  'reply_neutral',
  'unsubscribe',
  'meeting_booked',
  'opportunity_created',
  'closed_won',
  'closed_lost',
])
export type OutcomeKind = z.infer<typeof OutcomeKind>

export const OutcomeEvent = z.object({
  kind: z.literal('outcome'),
  id: z.string().uuid(),
  clientId: z.string().min(1),
  occurredAt: z.string().datetime(),
  outcome: OutcomeKind,
  /** Canonical record refs this outcome attaches to. */
  accountId: z.string().uuid().nullable(),
  contactId: z.string().uuid().nullable(),
  opportunityId: z.string().uuid().nullable(),
  /** Runs upstream of this outcome (attribution chain, best-effort). */
  attributedRunIds: z.array(z.string()).default([]),
  detail: z.string().optional(),
})
export type OutcomeEvent = z.infer<typeof OutcomeEvent>

export const FeedbackEvent = z.discriminatedUnion('kind', [HumanActionEvent, OutcomeEvent])
export type FeedbackEvent = z.infer<typeof FeedbackEvent>
