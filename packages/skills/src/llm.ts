import Anthropic from '@anthropic-ai/sdk'

/**
 * LLM boundary for skills. Skills depend on this interface, never on the SDK
 * directly — evals run against scripted fakes in CI (no API key), production
 * uses the Anthropic adapter below.
 */
export interface LlmClient {
  complete(req: { system: string; user: string; maxTokens?: number }): Promise<string>
}

export const DEFAULT_LLM_MODEL = 'claude-opus-4-8'

/** Deployment override for the production model; the default stays pinned here. */
export function llmModelFromEnvironment(env: Record<string, string | undefined>): string {
  return env.SARTRE_LLM_MODEL?.trim() || DEFAULT_LLM_MODEL
}

export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic
  constructor(
    private readonly model: string = DEFAULT_LLM_MODEL,
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic()
  }

  async complete(req: { system: string; user: string; maxTokens?: number }): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 16000,
      thinking: { type: 'adaptive' },
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
    })
    if (response.stop_reason === 'refusal') {
      throw new Error('model refused the request')
    }
    return response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
  }
}

/** Defensive JSON parsing — the proven pattern: strip fences, regex fallback. */
export function parseJsonArray(text: string): unknown[] | null {
  const direct = tryParse(stripFences(text))
  if (Array.isArray(direct)) return direct
  const match = text.match(/\[[\s\S]*\]/)
  if (match) {
    const fallback = tryParse(match[0])
    if (Array.isArray(fallback)) return fallback
  }
  return null
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
  const direct = tryParse(stripFences(text))
  if (isPlainObject(direct)) return direct
  const match = text.match(/\{[\s\S]*\}/)
  if (match) {
    const fallback = tryParse(match[0])
    if (isPlainObject(fallback)) return fallback
  }
  return null
}

function stripFences(text: string): string {
  return text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
