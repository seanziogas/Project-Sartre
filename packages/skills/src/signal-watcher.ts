import { z } from 'zod'

export const SignalRule = z.object({
  id: z.string().min(1),
  kinds: z.array(z.string().min(1)).min(1),
  minStrength: z.number().min(0).max(100),
  play: z.string().min(1),
})
export type SignalRule = z.infer<typeof SignalRule>

export const WatchedSignal = z.object({
  id: z.string().min(1), accountId: z.string().min(1), kind: z.string().min(1),
  strength: z.number().min(0).max(100), occurredAt: z.string().datetime(),
})
export type WatchedSignal = z.infer<typeof WatchedSignal>

export interface SignalMatch { signal: WatchedSignal; ruleId: string; play: string }

export function matchSignals(signals: WatchedSignal[], rules: SignalRule[]): { matches: SignalMatch[]; unmatched: WatchedSignal[] } {
  const parsedRules = rules.map((rule) => SignalRule.parse(rule))
  const matches: SignalMatch[] = []
  const unmatched: WatchedSignal[] = []
  for (const raw of signals) {
    const signal = WatchedSignal.parse(raw)
    const rule = parsedRules.find((candidate) => candidate.kinds.includes(signal.kind) && signal.strength >= candidate.minStrength)
    if (rule) matches.push({ signal, ruleId: rule.id, play: rule.play })
    else unmatched.push(signal)
  }
  return { matches, unmatched }
}
