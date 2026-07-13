export interface HttpRequest {
  method: 'GET' | 'POST' | 'PATCH'
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
  async request(request: HttpRequest): Promise<HttpResponse> {
    const response = await fetch(request.url, {
      method: request.method,
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
      const retryable = response.status === 429 || (request.method !== 'POST' && response.status >= 500)
      if (attempt >= maxAttempts || !retryable) return response
      const retryAfterHeader = response.headers['retry-after']
      const retryAfter = retryAfterHeader === undefined ? Number.NaN : Number(retryAfterHeader)
      const milliseconds = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : 250 * 2 ** (attempt - 1)
      await (this.options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(milliseconds)
    }
  }
}

export function productionHttpTransport(): HttpTransport {
  return new RetryingHttpTransport(new FetchHttpTransport())
}

export async function requestJson<T>(transport: HttpTransport, request: HttpRequest): Promise<T> {
  const response = await transport.request(request)
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`provider request failed (${response.status})`)
  }
  return response.body as T
}

export function bearer(token: string): Record<string, string> {
  if (!token.trim()) throw new Error('access token is required')
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}
