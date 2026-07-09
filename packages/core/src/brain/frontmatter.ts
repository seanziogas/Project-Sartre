import { z } from 'zod'
import { parse as parseYaml } from 'yaml'

/**
 * Brain document frontmatter contract (schemas/brain/README.md).
 * Bodies are free-form markdown; the frontmatter is what machines rely on.
 */

export const BRAIN_DOC_TYPES = [
  'company',
  'icp',
  'voice',
  'grading',
  'use-cases',
  'use-case', // deep-dive file under use-cases/
  'industry',
  'competitor',
  'case-study',
  'signals',
  'routing',
  'data-conventions',
  'engagement-log',
] as const

export const BrainFrontmatter = z.object({
  brain_doc: z.enum(BRAIN_DOC_TYPES),
  client: z.string().min(1),
  status: z.enum(['active', 'draft', 'superseded']),
  updated: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('YYYY-MM-DD')]),
  sources: z.array(z.string()).default([]),
  approved_by: z.string().default(''),
  /** case-study only: pain × persona × vertical tags for "use this when". */
  use_when: z
    .object({
      pains: z.array(z.string()).default([]),
      personas: z.array(z.string()).default([]),
      verticals: z.array(z.string()).default([]),
    })
    .optional(),
  /** grading only: posture is a field, not folklore. */
  posture: z.enum(['generous', 'strict']).optional(),
  /** use-cases/industries: controlled vocabulary consumed by classifiers. */
  vocabulary: z.array(z.string()).optional(),
})
export type BrainFrontmatter = z.infer<typeof BrainFrontmatter>

export class BrainDocError extends Error {
  constructor(
    message: string,
    readonly issues: z.ZodIssue[] = [],
  ) {
    super(message)
    this.name = 'BrainDocError'
  }
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/** Split a brain markdown file into validated frontmatter + body. */
export function parseBrainDoc(markdown: string): { frontmatter: BrainFrontmatter; body: string } {
  const match = FRONTMATTER_RE.exec(markdown)
  if (!match) throw new BrainDocError('brain doc has no YAML frontmatter block')
  let raw: unknown
  try {
    raw = parseYaml(match[1] ?? '')
  } catch (err) {
    throw new BrainDocError(`frontmatter is not valid YAML: ${(err as Error).message}`)
  }
  const result = BrainFrontmatter.safeParse(raw)
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
    throw new BrainDocError(`brain frontmatter failed validation:\n${lines.join('\n')}`, result.error.issues)
  }
  return { frontmatter: result.data, body: markdown.slice(match[0].length) }
}

/** A grading doc must state posture once it's active (draft may omit while being drafted). */
export function validateBrainDocRules(fm: BrainFrontmatter): string[] {
  const problems: string[] = []
  if (fm.brain_doc === 'grading' && fm.status === 'active' && !fm.posture) {
    problems.push('active grading doc must declare posture (generous | strict)')
  }
  if (fm.status === 'active' && fm.approved_by === '') {
    problems.push('active brain docs must carry approved_by (human gate)')
  }
  if (fm.status === 'active' && fm.updated === 'YYYY-MM-DD') {
    problems.push('active brain docs must carry a real updated date')
  }
  return problems
}
