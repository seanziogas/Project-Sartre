import { z } from 'zod'
import { parse as parseYaml } from 'yaml'

/**
 * Insight nodes — the atomic memory unit (Layer 6, kiln-os conventions
 * imported per docs/architecture/memory-layer.md). One markdown file per
 * concept under clients/<name>/insights/, kebab-case descriptive names.
 */

export const BLESSED_STATUSES = ['backlog', 'planned', 'in-progress', 'completed', 'paused', 'cancelled', 'active'] as const
export const BLESSED_SOURCES = ['meeting', 'email', 'slack', 'document', 'call', 'research', 'manual', 'brainstorm', 'internal-meeting'] as const

export const InsightFrontmatter = z.object({
  client: z.string().min(1),
  project_type: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(BLESSED_STATUSES),
  tags: z.array(z.string()).max(7), // max_tags_per_document: 7
  source: z.enum(BLESSED_SOURCES),
  source_file: z.string().optional(), // "[[YYYY-MM-DD-meeting-topic]]" backlink
  template: z.string().optional(),
  related_concepts: z.array(z.string()).default([]),
})
export type InsightFrontmatter = z.infer<typeof InsightFrontmatter>

export interface InsightNode {
  path: string
  frontmatter: InsightFrontmatter
  body: string
  /** All [[wiki-links]] in frontmatter + body, deduplicated, target only (alias/anchor stripped). */
  links: string[]
  attribution: { verified: number; inferred: number; unverifiable: number }
}

export class InsightError extends Error {
  constructor(
    message: string,
    readonly problems: string[] = [],
  ) {
    super(message)
    this.name = 'InsightError'
  }
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export function parseInsightNode(path: string, markdown: string): InsightNode {
  const match = FRONTMATTER_RE.exec(markdown)
  if (!match) throw new InsightError(`${path}: no YAML frontmatter`)
  let raw: unknown
  try {
    raw = parseYaml(match[1] ?? '')
  } catch (err) {
    throw new InsightError(`${path}: frontmatter is not valid YAML: ${(err as Error).message}`)
  }
  const parsed = InsightFrontmatter.safeParse(raw)
  if (!parsed.success) {
    throw new InsightError(
      `${path}: frontmatter invalid`,
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    )
  }
  const body = markdown.slice(match[0].length)
  return {
    path,
    frontmatter: parsed.data,
    body,
    links: extractWikiLinks(markdown),
    attribution: {
      verified: countTag(body, 'VERIFIED'),
      inferred: countTag(body, 'INFERRED'),
      unverifiable: countTag(body, 'UNVERIFIABLE'),
    },
  }
}

/** Extract [[wiki-link]] targets; pipe aliases and #anchors resolve on target only. */
export function extractWikiLinks(text: string): string[] {
  const links = new Set<string>()
  for (const m of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const target = (m[1] ?? '').split('|')[0]!.split('#')[0]!.trim()
    if (target !== '') links.add(target)
  }
  return [...links]
}

/**
 * Content-quality checks beyond schema validity. A node stating client facts
 * without a single attribution tag violates the honesty convention.
 */
export function lintInsightNode(node: InsightNode): string[] {
  const problems: string[] = []
  const total = node.attribution.verified + node.attribution.inferred + node.attribution.unverifiable
  if (total === 0) problems.push('no attribution tags — every client fact needs [VERIFIED]/[INFERRED]/[UNVERIFIABLE]')
  if (node.body.trim().length < 80) problems.push('body implausibly short for an insight node')
  const stem = node.path.split('/').pop() ?? ''
  if (/^meeting-notes|^notes-|^\d{4}-\d{2}-\d{2}\.md$/.test(stem)) {
    problems.push('filename should describe the CONCEPT, not the meeting (kebab-case concept names)')
  }
  return problems
}

function countTag(body: string, tag: string): number {
  return (body.match(new RegExp(`\\[${tag}[:\\]]`, 'g')) ?? []).length
}
