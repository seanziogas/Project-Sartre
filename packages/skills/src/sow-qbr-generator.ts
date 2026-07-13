import { z } from 'zod'
import type { LlmClient } from './llm.js'
import { parseJsonObject } from './llm.js'

export const EngagementDocumentInput = z.object({
  kind: z.enum(['sow', 'qbr']),
  sourceContext: z.string().min(1),
  allowedSources: z.array(z.string().min(1)).min(1),
})
export type EngagementDocumentInput = z.infer<typeof EngagementDocumentInput>

export const EngagementDocumentDraft = z.object({
  title: z.string().min(1),
  markdown: z.string().min(1),
  citations: z.array(z.object({ source: z.string().min(1), evidence: z.string().min(1).max(500) })).min(1),
  status: z.literal('draft'),
})
export type EngagementDocumentDraft = z.infer<typeof EngagementDocumentDraft>

export async function draftEngagementDocument(input: EngagementDocumentInput, llm: LlmClient): Promise<EngagementDocumentDraft> {
  const parsed = EngagementDocumentInput.parse(input)
  const raw = await llm.complete({
    system: [
      `Draft a ${parsed.kind.toUpperCase()} using only the supplied sources.`,
      'Never invent metrics, commitments, dates, or outcomes. Unknowns must be explicit TODOs.',
      'Return JSON only: {title,markdown,citations:[{source,evidence}],status:"draft"}.',
      'Citation evidence must be an exact excerpt and source must be allowed.',
    ].join('\n'),
    user: `ALLOWED SOURCES: ${JSON.stringify(parsed.allowedSources)}\n\n${parsed.sourceContext}`,
    maxTokens: 5000,
  })
  const draft = EngagementDocumentDraft.parse(parseJsonObject(raw))
  for (const citation of draft.citations) {
    if (!parsed.allowedSources.includes(citation.source)) throw new Error(`document cited an unapproved source: ${citation.source}`)
    if (!sourceSection(parsed.sourceContext, citation.source).includes(citation.evidence)) throw new Error(`document citation evidence is not present: ${citation.source}`)
  }
  return draft
}

function sourceSection(context: string, source: string): string {
  const marker = `=== ${source} ===`
  const start = context.indexOf(marker)
  if (start < 0) return ''
  const contentStart = start + marker.length
  const next = context.indexOf('\n\n=== ', contentStart)
  return context.slice(contentStart, next < 0 ? context.length : next)
}
