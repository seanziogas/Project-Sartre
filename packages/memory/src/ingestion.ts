import { z } from 'zod'
import { parseJsonObject } from '@sartre/skills'
import type { LlmClient } from '@sartre/skills'
import { lintInsightNode, parseInsightNode } from './nodes.js'

/**
 * Meeting ingestion (Layer 6, the kiln-os meeting-ingestion skill as code):
 * transcript in → meeting file + 1–5 insight nodes out. The LLM does the
 * analysis; frontmatter is assembled DETERMINISTICALLY so structure can't
 * drift — the model's output is validated content, never trusted structure.
 */

export interface MeetingMeta {
  clientName: string
  date: string // YYYY-MM-DD
  topic: string // kebab-case-able
  participants: string[]
  kind: 'internal' | 'external'
}

const Analysis = z.object({
  summary: z.string().min(40),
  decisions: z.array(z.string()).default([]),
  teamTodos: z.array(z.object({ owner: z.string(), todo: z.string() })).default([]),
  clientTodos: z.array(z.string()).default([]),
  insights: z
    .array(
      z.object({
        /** kebab-case CONCEPT name — never meeting-notes-<date>. */
        slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
        tags: z.array(z.string()).max(7),
        status: z.enum(['backlog', 'planned', 'in-progress', 'completed', 'active']),
        /** Markdown body with [VERIFIED: …] tags citing the meeting. */
        body: z.string().min(80),
      }),
    )
    .min(1)
    .max(5), // extract 1-5, never over-extract
})
type Analysis = z.infer<typeof Analysis>

export interface IngestionResult {
  meetingFile: { path: string; markdown: string }
  insightFiles: { path: string; markdown: string }[]
  analysis: Pick<Analysis, 'summary' | 'decisions' | 'teamTodos' | 'clientTodos'>
}

export async function ingestMeeting(
  transcript: string,
  meta: MeetingMeta,
  llm: LlmClient,
  options: { maxRetries?: number } = {},
): Promise<IngestionResult> {
  const maxRetries = options.maxRetries ?? 2
  const meetingLabel = `${meta.date}-${meta.topic}`
  let problems: string[] = []
  let analysis: Analysis | null = null

  for (let attempt = 0; attempt <= maxRetries && !analysis; attempt++) {
    const raw = await llm.complete({
      system: ingestionSystem(meta, meetingLabel),
      user:
        problems.length > 0
          ? `${transcript}\n\nPREVIOUS ATTEMPT FAILED VALIDATION — FIX:\n${problems.map((p) => `- ${p}`).join('\n')}`
          : transcript,
      maxTokens: 32000,
    })
    const parsed = Analysis.safeParse(parseJsonObject(raw))
    if (!parsed.success) {
      problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
      continue
    }
    // deterministic assembly + full node validation before accepting
    const nodeProblems: string[] = []
    for (const insight of parsed.data.insights) {
      const markdown = assembleInsight(insight, meta, meetingLabel)
      try {
        const node = parseInsightNode(`insights/${insight.slug}.md`, markdown)
        nodeProblems.push(...lintInsightNode(node).map((p) => `insight ${insight.slug}: ${p}`))
      } catch (err) {
        nodeProblems.push(`insight ${insight.slug}: ${(err as Error).message}`)
      }
    }
    if (nodeProblems.length > 0) {
      problems = nodeProblems
      continue
    }
    analysis = parsed.data
  }
  if (!analysis) throw new Error(`meeting ingestion failed validation after retries: ${problems.join('; ')}`)

  const meetingDir = meta.kind === 'internal' ? 'meetings/internal' : 'meetings/external'
  return {
    meetingFile: {
      path: `${meetingDir}/${meetingLabel}.md`,
      markdown: assembleMeetingFile(transcript, meta, analysis),
    },
    insightFiles: analysis.insights.map((i) => ({
      path: `insights/${i.slug}.md`,
      markdown: assembleInsight(i, meta, meetingLabel),
    })),
    analysis: {
      summary: analysis.summary,
      decisions: analysis.decisions,
      teamTodos: analysis.teamTodos,
      clientTodos: analysis.clientTodos,
    },
  }
}

function ingestionSystem(meta: MeetingMeta, meetingLabel: string): string {
  return [
    `You are ingesting a ${meta.kind} meeting transcript for ${meta.clientName} into the client's memory system.`,
    '',
    'Analyze for: decisions, action items (team vs client), and durable insights.',
    'Insight rules:',
    '- Extract 1 to 5 insight nodes — the durable concepts, NOT meeting minutes. Do not over-extract.',
    '- slug: kebab-case CONCEPT name (e.g. "enrichment-workflow-design-decisions"), never a date or "meeting-notes".',
    `- body: markdown with sections (## Key Points / ## Context / ## Evidence / ## Next Steps). Every client fact carries [VERIFIED: ${meetingLabel}] after the claim; deductions carry [INFERRED: <logic>]. Quote the transcript in > blockquotes inside Evidence.`,
    '- Honesty over confident guessing: if something is unclear, mark it [UNVERIFIABLE].',
    '',
    'Respond with ONLY a JSON object:',
    '{"summary": string, "decisions": [string], "teamTodos": [{"owner": string, "todo": string}], "clientTodos": [string], "insights": [{"slug": string, "tags": [string, max 7], "status": "backlog|planned|in-progress|completed|active", "body": string}]}',
  ].join('\n')
}

function assembleInsight(
  insight: Analysis['insights'][number],
  meta: MeetingMeta,
  meetingLabel: string,
): string {
  return [
    '---',
    `client: ${meta.clientName}`,
    `date: ${meta.date}`,
    `status: ${insight.status}`,
    `tags: [${insight.tags.join(', ')}]`,
    `source: ${meta.kind === 'internal' ? 'internal-meeting' : 'meeting'}`,
    `source_file: "[[${meetingLabel}]]"`,
    'related_concepts: []',
    '---',
    '',
    insight.body.trim(),
    '',
  ].join('\n')
}

function assembleMeetingFile(transcript: string, meta: MeetingMeta, analysis: Analysis): string {
  return [
    '---',
    `client: ${meta.clientName}`,
    `date: ${meta.date}`,
    `participants: [${meta.participants.join(', ')}]`,
    `source: ${meta.kind === 'internal' ? 'internal-meeting' : 'meeting'}`,
    `template: ${meta.kind === 'internal' ? 'internal-meeting' : 'meeting'}`,
    '---',
    '',
    `# ${meta.topic.replace(/-/g, ' ')} (${meta.date})`,
    '',
    '## Summary',
    analysis.summary,
    '',
    ...(analysis.decisions.length > 0 ? ['## Decisions', ...analysis.decisions.map((d) => `- ${d}`), ''] : []),
    '## Team To-Dos',
    ...(analysis.teamTodos.length > 0 ? analysis.teamTodos.map((t) => `- [ ] ${t.owner}: ${t.todo}`) : ['- none']),
    '',
    '## Client To-Dos',
    ...(analysis.clientTodos.length > 0 ? analysis.clientTodos.map((t) => `- [ ] ${t}`) : ['- none']),
    '',
    '## Insights extracted',
    ...analysis.insights.map((i) => `- [[${i.slug}]]`),
    '',
    '## Recording / Transcript',
    '',
    transcript.trim(),
    '',
  ].join('\n')
}
