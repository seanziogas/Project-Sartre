export interface HttpRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  url: string
  headers?: Record<string, string>
  body?: string
}

export interface HttpResponse {
  status: number
  body: unknown
  headers: Record<string, string>
}

export interface HttpTransport {
  request(request: HttpRequest): Promise<HttpResponse>
}

export class FetchHttpTransport implements HttpTransport {
  constructor(private readonly timeoutMs = 30_000) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) throw new Error('provider HTTP timeout must be 1000-120000ms')
  }
  async request(request: HttpRequest): Promise<HttpResponse> {
    const response = await fetch(request.url, {
      method: request.method,
      signal: AbortSignal.timeout(this.timeoutMs),
      ...(request.headers === undefined ? {} : { headers: request.headers }),
      ...(request.body === undefined ? {} : { body: request.body }),
    })
    const text = await response.text()
    let body: unknown = text
    if (text) {
      try { body = JSON.parse(text) } catch { /* retain text */ }
    }
    return { status: response.status, body, headers: Object.fromEntries(response.headers.entries()) }
  }
}

export class RetryingHttpTransport implements HttpTransport {
  constructor(
    private readonly inner: HttpTransport,
    private readonly options: { maxAttempts?: number; wait?: (milliseconds: number) => Promise<void> } = {},
  ) {}

  async request(request: HttpRequest): Promise<HttpResponse> {
    const maxAttempts = this.options.maxAttempts ?? 3
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) throw new Error('maxAttempts must be 1-5')
    for (let attempt = 1; ; attempt++) {
      const response = await this.inner.request(request)
      const retryable = request.method !== 'POST' && (response.status === 429 || response.status >= 500)
      if (attempt >= maxAttempts || !retryable) return response
      const retryAfterHeader = Object.entries(response.headers).find(([name]) => name.toLowerCase() === 'retry-after')?.[1]
      const retryAfter = retryDelay(retryAfterHeader)
      const milliseconds = retryAfter ?? 250 * 2 ** (attempt - 1)
      await (this.options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(milliseconds)
    }
  }
}

function retryDelay(value: string | undefined): number | null {
  if (value === undefined) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}

export function productionHttpTransport(): HttpTransport {
  return new RetryingHttpTransport(new FetchHttpTransport())
}

export async function requestJson<T>(transport: HttpTransport, request: HttpRequest): Promise<T> {
  const response = await transport.request(request)
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`provider request failed (${response.status})${providerErrorSuffix(response.body)}`)
  }
  return response.body as T
}

function providerErrorSuffix(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const record = body as Record<string, unknown>
  const nested = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : null
  const value = nested?.message ?? record.message ?? record.error_description
  if (typeof value !== 'string' || !value.trim()) return ''
  return `: ${value.replace(/[\r\n]+/g, ' ').slice(0, 300)}`
}

export function bearer(token: string): Record<string, string> {
  if (!token.trim()) throw new Error('access token is required')
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}
