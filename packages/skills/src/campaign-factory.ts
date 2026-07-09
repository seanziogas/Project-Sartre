/**
 * Campaign Factory (skill-patterns.md Pattern 3, generalized from the
 * Hologram closed-lost engine). Fully deterministic: template selection on
 * two axes (email 1 by play, email 2 by segment group), rotating breakup
 * email, slot filling with conservative defaults, subject rotation by row
 * index, DNC blanking, and a coverage-prioritized review sample.
 *
 * Doctrine: the LLM's only role is upstream (per-row summaries that slots are
 * mined from). Nothing in this module calls a model.
 */

export const SKILL_ID = 'campaign-factory@0.1.0'

export interface EmailTemplate {
  subjects: string[] // rotated by row index
  body: string // {slot} placeholders filled here; {{merge_tag}} left for the sequencer
}

export interface CampaignTemplates {
  /** Email 1 keyed by play (e.g. timing-check-in, competitive-win-back). */
  email1: Record<string, EmailTemplate>
  /** Email 2 keyed by segment group (e.g. fleet, healthcare, catchall). */
  email2: Record<string, EmailTemplate>
  /** Breakup variants, rotated by row index. */
  email3: EmailTemplate[]
  /** Fallback values per slot when a row has no mined value. */
  slotDefaults: Record<string, string>
  /** Fallback keys when a row's play/group has no template. */
  fallbackPlay: string
  fallbackGroup: string
}

export interface CampaignRow {
  id: string
  play: string
  group: string
  /** Mined slot values ({opp_detail}, {blocker}, …); missing slots use defaults. */
  slots: Record<string, string | null>
  /** Coverage tier for review sampling (e.g. enterprise > large > …). */
  tier?: string
  doNotContact?: boolean
}

export interface GeneratedEmail {
  subject: string
  body: string
}

export interface GeneratedRow {
  id: string
  emails: [GeneratedEmail, GeneratedEmail, GeneratedEmail] | null // null = DNC, columns blanked
  /** Slots that fell back to defaults — visible so review can spot thin rows. */
  defaultedSlots: string[]
}

export interface CampaignResult {
  rows: GeneratedRow[]
  /** Coverage-prioritized sample for the human review deck. */
  reviewSampleIds: string[]
  skippedDnc: number
}

export function generateCampaign(
  rows: CampaignRow[],
  templates: CampaignTemplates,
  options: { reviewSampleSize?: number } = {},
): CampaignResult {
  const out: GeneratedRow[] = []
  let skippedDnc = 0

  rows.forEach((row, index) => {
    if (row.doNotContact) {
      skippedDnc++
      out.push({ id: row.id, emails: null, defaultedSlots: [] })
      return
    }
    const t1 = templates.email1[row.play] ?? templates.email1[templates.fallbackPlay]
    const t2 = templates.email2[row.group] ?? templates.email2[templates.fallbackGroup]
    const t3 = templates.email3[index % templates.email3.length]
    if (!t1 || !t2 || !t3) {
      throw new Error(
        `template set incomplete: play=${row.play} group=${row.group} (fallbacks ${templates.fallbackPlay}/${templates.fallbackGroup})`,
      )
    }
    const defaulted = new Set<string>()
    const emails: [GeneratedEmail, GeneratedEmail, GeneratedEmail] = [
      renderEmail(t1, row, index, templates.slotDefaults, defaulted),
      renderEmail(t2, row, index, templates.slotDefaults, defaulted),
      renderEmail(t3, row, index, templates.slotDefaults, defaulted),
    ]
    out.push({ id: row.id, emails, defaultedSlots: [...defaulted].sort() })
  })

  return {
    rows: out,
    reviewSampleIds: selectReviewSamples(rows, options.reviewSampleSize ?? 20),
    skippedDnc,
  }
}

function renderEmail(
  template: EmailTemplate,
  row: CampaignRow,
  index: number,
  defaults: Record<string, string>,
  defaulted: Set<string>,
): GeneratedEmail {
  const subject = template.subjects[index % template.subjects.length] ?? template.subjects[0] ?? ''
  return {
    subject: fillSlots(subject, row.slots, defaults, defaulted),
    body: fillSlots(template.body, row.slots, defaults, defaulted),
  }
}

/**
 * Fill {slot} placeholders from mined values, falling back to defaults.
 * {{merge_tags}} pass through untouched — they belong to the sequencer.
 */
export function fillSlots(
  template: string,
  slots: Record<string, string | null>,
  defaults: Record<string, string>,
  defaulted?: Set<string>,
): string {
  return template.replace(/\{\{[^}]+\}\}|\{([a-z0-9_]+)\}/gi, (match, slot: string | undefined) => {
    if (slot === undefined) return match // {{merge_tag}}
    const mined = slots[slot]
    if (mined !== null && mined !== undefined && mined !== '') return mined
    const fallback = defaults[slot]
    if (fallback !== undefined) {
      defaulted?.add(slot)
      return fallback
    }
    throw new Error(`no value or default for slot {${slot}}`)
  })
}

/**
 * Review-sample selection, coverage-prioritized: every play first, then every
 * group, then every tier, then fill remaining seats in row order.
 */
export function selectReviewSamples(rows: CampaignRow[], size: number): string[] {
  const eligible = rows.filter((r) => !r.doNotContact)
  const selected: string[] = []
  const chosen = new Set<string>()

  const coverBy = (keyOf: (r: CampaignRow) => string | undefined) => {
    const covered = new Set(
      selected.map((id) => keyOf(eligible.find((r) => r.id === id)!)).filter(Boolean),
    )
    for (const row of eligible) {
      if (selected.length >= size) return
      const key = keyOf(row)
      if (!key || covered.has(key) || chosen.has(row.id)) continue
      covered.add(key)
      chosen.add(row.id)
      selected.push(row.id)
    }
  }

  coverBy((r) => r.play)
  coverBy((r) => r.group)
  coverBy((r) => r.tier)
  for (const row of eligible) {
    if (selected.length >= size) break
    if (!chosen.has(row.id)) {
      chosen.add(row.id)
      selected.push(row.id)
    }
  }
  return selected
}
