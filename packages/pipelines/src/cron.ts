/**
 * Minimal 5-field cron matcher (minute hour day-of-month month day-of-week).
 * Supports: * , - / and numeric values. Standard semantics: when BOTH
 * day-of-month and day-of-week are restricted, either matching fires (POSIX).
 * UTC evaluation — manifests declare schedules in UTC.
 */

export function cronMatches(expr: string, date: Date): boolean {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) throw new Error(`invalid cron expression "${expr}" (need 5 fields)`)
  const [min, hour, dom, mon, dow] = fields as [string, string, string, string, string]

  const minuteOk = fieldMatches(min, date.getUTCMinutes(), 0, 59)
  const hourOk = fieldMatches(hour, date.getUTCHours(), 0, 23)
  const monthOk = fieldMatches(mon, date.getUTCMonth() + 1, 1, 12)

  const domRestricted = dom !== '*'
  const dowRestricted = dow !== '*'
  const domOk = fieldMatches(dom, date.getUTCDate(), 1, 31)
  const dowOk = fieldMatches(dow, date.getUTCDay(), 0, 7) // 0 and 7 both Sunday

  const dayOk =
    domRestricted && dowRestricted ? domOk || dowOk : domRestricted ? domOk : dowRestricted ? dowOk : true

  return minuteOk && hourOk && monthOk && dayOk
}

function fieldMatches(field: string, value: number, min: number, max: number): boolean {
  return field.split(',').some((part) => partMatches(part.trim(), value, min, max))
}

function partMatches(part: string, value: number, min: number, max: number): boolean {
  const [rangePart, stepPart] = part.split('/') as [string, string | undefined]
  const step = stepPart !== undefined ? parseInt(stepPart, 10) : 1
  if (Number.isNaN(step) || step < 1) throw new Error(`invalid cron step in "${part}"`)

  let lo: number
  let hi: number
  if (rangePart === '*' || rangePart === '') {
    lo = min
    hi = max
  } else if (rangePart.includes('-')) {
    const [a, b] = rangePart.split('-').map((n) => parseInt(n, 10)) as [number, number]
    if (Number.isNaN(a) || Number.isNaN(b)) throw new Error(`invalid cron range "${part}"`)
    lo = a
    hi = b
  } else {
    const n = parseInt(rangePart, 10)
    if (Number.isNaN(n)) throw new Error(`invalid cron value "${part}"`)
    // day-of-week 7 == 0 (Sunday)
    const normalized = max === 7 && n === 7 ? 0 : n
    return stepPart === undefined ? value === normalized : value >= normalized && (value - normalized) % step === 0
  }
  const v = max === 7 && value === 7 ? 0 : value
  return v >= lo && v <= hi && (v - lo) % step === 0
}
