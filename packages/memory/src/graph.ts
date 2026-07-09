import { extractWikiLinks, parseInsightNode } from './nodes.js'
import type { InsightNode } from './nodes.js'

/**
 * Link health + graph health (Layer 6). Operates on an in-memory inventory
 * of one INSTANCE's memory files — tenancy means graph health never crosses
 * clients. Loader lives separately; tests feed synthetic inventories.
 */

export interface MemoryFile {
  /** Instance-relative path, e.g. "insights/enrichment-design.md". */
  path: string
  content: string
  /** Last-touched (max of git commit date and fs mtime) — NOT frontmatter date. */
  lastTouched?: string
}

export interface LinkHealth {
  /** Links resolving to no file — candidates, not errors (forward refs are legal). */
  forwardRefs: { from: string; target: string }[]
  /** Insights with fewer than 2 total links (in+out). */
  orphans: string[]
  /** Share of insights with 3+ links. */
  wellConnected: number
}

/**
 * Resolution rules (instance-scoped subset of the 8): bare-stem match,
 * path-style match, notion group shortcut; attachment extensions excluded.
 */
export function resolveLink(target: string, paths: Set<string>, stems: Map<string, string[]>): boolean {
  if (/\.(pdf|xlsx?|csv|png|jpg|docx?|pptx?)$/i.test(target)) return true // attachment ref, never "broken"
  const stem = target.split('/').pop() ?? target
  if (stems.has(stem)) return true
  if (paths.has(`${target}.md`) || paths.has(target)) return true
  if (paths.has(`notion/${target}/context-brief.md`)) return true
  return false
}

export function computeLinkHealth(files: MemoryFile[], insights: InsightNode[]): LinkHealth {
  const paths = new Set(files.map((f) => f.path))
  const stems = new Map<string, string[]>()
  for (const f of files) {
    const stem = (f.path.split('/').pop() ?? '').replace(/\.md$/, '')
    const list = stems.get(stem)
    if (list) list.push(f.path)
    else stems.set(stem, [f.path])
  }

  const forwardRefs: LinkHealth['forwardRefs'] = []
  const inbound = new Map<string, number>()
  // inbound counting scans ALL files (synthesis docs linking an insight count)
  for (const f of files) {
    for (const target of extractWikiLinks(f.content)) {
      const stem = target.split('/').pop() ?? target
      for (const p of stems.get(stem) ?? []) inbound.set(p, (inbound.get(p) ?? 0) + 1)
    }
  }

  let wellConnected = 0
  const orphans: string[] = []
  for (const node of insights) {
    for (const target of node.links) {
      if (!resolveLink(target, paths, stems)) forwardRefs.push({ from: node.path, target })
    }
    const degree = node.links.length + (inbound.get(node.path) ?? 0)
    if (degree < 2) orphans.push(node.path)
    if (degree >= 3) wellConnected++
  }

  return {
    forwardRefs,
    orphans,
    wellConnected: insights.length === 0 ? 1 : wellConnected / insights.length,
  }
}

export interface TaxonomyHealth {
  tagCounts: Record<string, number>
  /** Emerging tags at/over the validation threshold — promote or consolidate. */
  atThreshold: string[]
}

export function computeTaxonomy(insights: InsightNode[], validatedTags: string[], validationThreshold = 3): TaxonomyHealth {
  const validated = new Set(validatedTags.map((t) => t.toLowerCase()))
  const tagCounts: Record<string, number> = {}
  for (const node of insights) {
    for (const tag of node.frontmatter.tags) {
      const t = tag.toLowerCase()
      tagCounts[t] = (tagCounts[t] ?? 0) + 1
    }
  }
  const atThreshold = Object.entries(tagCounts)
    .filter(([tag, count]) => !validated.has(tag) && count >= validationThreshold)
    .map(([tag]) => tag)
    .sort()
  return { tagCounts, atThreshold }
}

export interface GraphHealthReport {
  generatedAt: string
  counts: { insights: number; meetings: number; synthesis: number; invalidNodes: number }
  byStatus: Record<string, number>
  linkHealth: LinkHealth
  taxonomy: TaxonomyHealth
  /** in-progress nodes untouched past the threshold (needs lastTouched). */
  staleInProgress: string[]
  synthesisGaps: string[] // e.g. "10+ insights but no synthesis doc"
  invalid: { path: string; error: string }[]
  rating: 'Healthy' | 'Warning' | 'Needs Attention'
}

export interface GraphHealthOptions {
  now?: Date
  validatedTags?: string[]
  validationThreshold?: number
  staleInProgressDays?: number // default 30
  tagsAtThresholdWarning?: number // default 5
  tagsAtThresholdCritical?: number // default 15
}

export function computeGraphHealth(files: MemoryFile[], options: GraphHealthOptions = {}): GraphHealthReport {
  const now = options.now ?? new Date()
  const staleDays = options.staleInProgressDays ?? 30

  const insights: InsightNode[] = []
  const invalid: GraphHealthReport['invalid'] = []
  const insightFiles = files.filter((f) => f.path.startsWith('insights/') && f.path.endsWith('.md'))
  for (const f of insightFiles) {
    try {
      insights.push(parseInsightNode(f.path, f.content))
    } catch (err) {
      invalid.push({ path: f.path, error: (err as Error).message })
    }
  }

  const byStatus: Record<string, number> = {}
  for (const n of insights) byStatus[n.frontmatter.status] = (byStatus[n.frontmatter.status] ?? 0) + 1

  const staleInProgress = insights
    .filter((n) => n.frontmatter.status === 'in-progress')
    .filter((n) => {
      const f = files.find((x) => x.path === n.path)
      if (!f?.lastTouched) return false // no signal — never guess staleness
      return (now.getTime() - new Date(f.lastTouched).getTime()) / 86_400_000 > staleDays
    })
    .map((n) => n.path)

  const meetings = files.filter((f) => f.path.startsWith('meetings/')).length
  const synthesis = files.filter((f) => f.path.startsWith('_synthesis/')).length
  const synthesisGaps: string[] = []
  if (insights.length >= 10 && synthesis === 0) synthesisGaps.push(`${insights.length} insights but no synthesis doc`)
  if (!files.some((f) => f.path === '_synthesis/engagement-summary.md')) {
    synthesisGaps.push('missing _synthesis/engagement-summary.md (mandatory for active clients)')
  }

  const linkHealth = computeLinkHealth(files, insights)
  const taxonomy = computeTaxonomy(insights, options.validatedTags ?? [], options.validationThreshold)

  const warnAt = options.tagsAtThresholdWarning ?? 5
  const criticalAt = options.tagsAtThresholdCritical ?? 15
  let rating: GraphHealthReport['rating'] = 'Healthy'
  if (taxonomy.atThreshold.length >= warnAt || invalid.length > 0 || staleInProgress.length > 0 || synthesisGaps.length > 0) {
    rating = 'Warning'
  }
  if (taxonomy.atThreshold.length >= criticalAt || invalid.length > insights.length / 2) rating = 'Needs Attention'

  return {
    generatedAt: now.toISOString(),
    counts: { insights: insights.length, meetings, synthesis, invalidNodes: invalid.length },
    byStatus,
    linkHealth,
    taxonomy,
    staleInProgress,
    synthesisGaps,
    invalid,
    rating,
  }
}

export function renderGraphHealthMarkdown(clientName: string, report: GraphHealthReport): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`
  return [
    `# Graph Health — ${clientName}`,
    '',
    `Generated ${report.generatedAt} · rating: **${report.rating}**`,
    '',
    `- Insights: ${report.counts.insights} (${Object.entries(report.byStatus).map(([s, n]) => `${n} ${s}`).join(', ') || 'none'})`,
    `- Meetings: ${report.counts.meetings} · synthesis docs: ${report.counts.synthesis}`,
    `- Well-connected (3+ links): ${pct(report.linkHealth.wellConnected)} · orphans: ${report.linkHealth.orphans.length} · forward refs: ${report.linkHealth.forwardRefs.length}`,
    `- Emerging tags at validation threshold: ${report.taxonomy.atThreshold.join(', ') || 'none'}`,
    report.staleInProgress.length > 0 ? `- ⚠️ stale in-progress: ${report.staleInProgress.join(', ')}` : '',
    ...report.synthesisGaps.map((g) => `- ⚠️ ${g}`),
    ...report.invalid.map((i) => `- ❌ invalid node ${i.path}: ${i.error}`),
    '',
  ]
    .filter((l) => l !== '')
    .join('\n')
}
