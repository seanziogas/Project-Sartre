import { z } from 'zod'
import { parseJsonObject } from './llm.js'
import type { LlmClient } from './llm.js'

export const SKILL_ID = 'copilot-brief@0.1.0'

export const BriefEvidence = z.object({
  id: z.string().min(1),
  kind: z.enum(['account', 'contact', 'opportunity', 'activity', 'signal']),
  observedAt: z.string().datetime().nullable().default(null),
  content: z.string().min(1),
})
export type BriefEvidence = z.infer<typeof BriefEvidence>

const BriefPoint = z.object({
  text: z.string().min(1),
  sourceRefs: z.array(z.string().min(1)).min(1),
})
export type BriefPoint = z.infer<typeof BriefPoint>

export const CopilotBrief = z.object({
  status: z.literal('draft'),
  accountId: z.string().min(1),
  generatedAt: z.string().datetime(),
  title: z.string().min(1),
  executiveSummary: z.array(BriefPoint).min(1),
  recentSignals: z.array(BriefPoint),
  openOpportunities: z.array(BriefPoint),
  risks: z.array(BriefPoint),
  recommendedActions: z.array(BriefPoint).min(1),
  questionsForTheMeeting: z.array(BriefPoint),
})
export type CopilotBrief = z.infer<typeof CopilotBrief>

export const CopilotBriefInput = z.object({
  accountId: z.string().min(1),
  accountName: z.string().min(1),
  generatedAt: z.string().datetime(),
  brainContext: z.string().min(1),
  evidence: z.array(BriefEvidence).min(1),
})
export type CopilotBriefInput = z.infer<typeof CopilotBriefInput>

/** Generate a source-grounded draft; only the pipeline's human gate can release it. */
export async function generateCopilotBrief(
  input: CopilotBriefInput,
  llm: LlmClient,
  options: { maxRetries?: number } = {},
): Promise<CopilotBrief> {
  const parsedInput = CopilotBriefInput.parse(input)
  const parsedEvidence = parsedInput.evidence
  const maxRetries = options.maxRetries ?? 2
  let problems: string[] = []
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const raw = await llm.complete({
      system: systemPrompt(parsedInput),
      user: userPrompt(parsedEvidence, problems),
      maxTokens: 8000,
    })
    const result = validateBrief(raw, parsedInput, new Set(parsedEvidence.map((item) => item.id)))
    if (result.ok) return result.brief
    problems = result.problems
  }
  throw new Error(`copilot brief failed validation after retries: ${problems.join('; ')}`)
}

function systemPrompt(input: CopilotBriefInput): string {
  return [
    `You are drafting a pre-meeting account brief for ${input.accountName}.`,
    `Use accountId exactly "${input.accountId}" and generatedAt exactly "${input.generatedAt}".`,
    'The client Brain below governs ICP, positioning, voice, use cases, and disqualifiers. Do not contradict it.',
    '',
    '=== APPROVED CLIENT BRAIN ===',
    input.brainContext,
    '=== END APPROVED CLIENT BRAIN ===',
    '',
    'Grounding rules:',
    '- Use only the supplied evidence. Never invent people, dates, amounts, quotes, intent, or opportunity state.',
    '- Every point must list one or more exact evidence ids in sourceRefs.',
    '- Recommendations and meeting questions must cite the evidence that motivates them.',
    '- Keep uncertain or missing information explicit instead of guessing.',
    '- Output status must be "draft". A human reviewer decides whether it can be delivered.',
    '',
    'Respond with ONLY one JSON object with keys: status, accountId, generatedAt, title, executiveSummary, recentSignals, openOpportunities, risks, recommendedActions, questionsForTheMeeting.',
    'Every section except status/accountId/generatedAt/title is an array of {"text": string, "sourceRefs": [evidence id]}.',
  ].join('\n')
}

function userPrompt(evidence: BriefEvidence[], problems: string[]): string {
  const retry = problems.length === 0
    ? ''
    : `\n\nPREVIOUS ATTEMPT FAILED VALIDATION — FIX:\n${problems.map((problem) => `- ${problem}`).join('\n')}`
  return `EVIDENCE:\n${JSON.stringify(evidence, null, 2)}${retry}`
}

function validateBrief(
  raw: string,
  input: CopilotBriefInput,
  evidenceIds: Set<string>,
): { ok: true; brief: CopilotBrief } | { ok: false; problems: string[] } {
  const parsed = CopilotBrief.safeParse(parseJsonObject(raw))
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    }
  }
  const problems: string[] = []
  if (parsed.data.accountId !== input.accountId) problems.push(`accountId must be ${input.accountId}`)
  if (parsed.data.generatedAt !== input.generatedAt) problems.push(`generatedAt must be ${input.generatedAt}`)
  for (const point of allPoints(parsed.data)) {
    for (const ref of point.sourceRefs) {
      if (!evidenceIds.has(ref)) problems.push(`unknown evidence sourceRef: ${ref}`)
    }
  }
  return problems.length === 0 ? { ok: true, brief: parsed.data } : { ok: false, problems }
}

function allPoints(brief: CopilotBrief): BriefPoint[] {
  return [
    ...brief.executiveSummary,
    ...brief.recentSignals,
    ...brief.openOpportunities,
    ...brief.risks,
    ...brief.recommendedActions,
    ...brief.questionsForTheMeeting,
  ]
}
