import type { HumanActionEvent } from '@sartre/core'

/**
 * Learning speed 1 — exemplar memory (Layer 8). A corrected grade or edited
 * output becomes a worked example in the client's brain. This module turns
 * feedback events into DRAFT exemplar files for brain/learned/exemplars/ —
 * the GTME approves them like any brain change. Nothing here writes brains;
 * it produces content for a human-gated pipeline step.
 */

export interface Exemplar {
  /** kebab-case filename stem, e.g. "grade-override-acct-123-2026-07-09". */
  slug: string
  /** Which brain doc this exemplar teaches, e.g. "grading" or "voice". */
  teaches: 'grading' | 'voice' | 'routing'
  markdown: string
  sourceEventId: string
}

const TEACHES_BY_ACTION: Partial<Record<HumanActionEvent['action'], Exemplar['teaches']>> = {
  grade_override: 'grading',
  approve_with_edit: 'voice',
  routing_correction: 'routing',
  list_removal: 'grading',
}

/**
 * Extract exemplars from feedback events. Only events carrying a human
 * correction AND a reason qualify — an unexplained correction is a metric,
 * not a lesson (the reviewer's "why" is what makes it teachable).
 */
export function extractExemplars(events: HumanActionEvent[], clientName: string): Exemplar[] {
  const exemplars: Exemplar[] = []
  for (const event of events) {
    const teaches = teachesFor(event)
    if (!teaches) continue
    if (!event.reason || event.reason.trim() === '') continue

    const date = event.occurredAt.slice(0, 10)
    const eventSuffix = event.id.replace(/[^a-zA-Z0-9]/g, '').slice(-8)
    const slug = `${event.action.replace(/_/g, '-')}-${event.machine.itemRef.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 40)}-${date}-${eventSuffix}`
    exemplars.push({
      slug,
      teaches,
      sourceEventId: event.id,
      markdown: renderExemplar(event, teaches, clientName, date),
    })
  }
  return exemplars
}

function teachesFor(event: HumanActionEvent): Exemplar['teaches'] | undefined {
  const direct = TEACHES_BY_ACTION[event.action]
  if (direct) return direct
  if (event.action !== 'reject') return undefined
  if (/:(outbound_send|client_comms)$/.test(event.machine.itemRef)) return 'voice'
  if (/:crm_write$/.test(event.machine.itemRef) && hasOwner(event.machine.output)) return 'routing'
  if (/grader|grading/i.test(event.machine.skillId)) return 'grading'
  return undefined
}

function hasOwner(output: unknown): boolean {
  if (typeof output !== 'object' || output === null) return false
  const record = output as Record<string, unknown>
  return 'owner' in record || 'assignments' in record
}

function renderExemplar(
  event: HumanActionEvent,
  teaches: Exemplar['teaches'],
  clientName: string,
  date: string,
): string {
  const machineOut = JSON.stringify(event.machine.output, null, 2)
  const humanOut = event.humanOutput !== undefined ? JSON.stringify(event.humanOutput, null, 2) : null
  return [
    '---',
    `brain_doc: exemplar`,
    `client: ${clientName}`,
    `teaches: ${teaches}`,
    'status: draft',
    `updated: ${date}`,
    `sources: ["feedback-event:${event.id}"]`,
    'approved_by: ""',
    '---',
    '',
    `# Worked example: ${event.action.replace(/_/g, ' ')} (${date})`,
    '',
    `**Skill:** \`${event.machine.skillId}\` · **run:** \`${event.machine.runId}\` · **item:** \`${event.machine.itemRef}\` · **by:** ${event.actor}`,
    '',
    '## Machine output',
    '```json',
    machineOut,
    '```',
    ...(humanOut ? ['', '## Human correction', '```json', humanOut, '```'] : []),
    '',
    '## Why (verbatim from the reviewer)',
    `> ${event.reason}`,
    '',
    `## Rule to internalize`,
    `<!-- GTME: rewrite the reason above as a general rule before approving, e.g. a new edge case for ${teaches}.md -->`,
    'TODO',
    '',
  ].join('\n')
}
