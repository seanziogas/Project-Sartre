import { createServer } from 'node:http'

export class ReadinessState {
  private ready = false

  isReady = (): boolean => this.ready
  succeeded(): boolean {
    const changed = !this.ready
    this.ready = true
    return changed
  }
  failed(): boolean {
    const changed = this.ready
    this.ready = false
    return changed
  }
}

export function startHealthServer(port: number, ready: () => boolean) {
  const server = createServer((request, response) => {
    const result = healthStatus(request.url, ready())
    response.writeHead(result.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      .end(JSON.stringify(result.body))
  })
  server.listen(port)
  return server
}

export function healthStatus(path: string | undefined, ready: boolean): {
  status: 200 | 404 | 503
  body: { status: 'ok' | 'starting' | 'not_found' }
} {
  if (path === '/healthz') return { status: 200, body: { status: 'ok' } }
  if (path === '/readyz') return ready
    ? { status: 200, body: { status: 'ok' } }
    : { status: 503, body: { status: 'starting' } }
  return { status: 404, body: { status: 'not_found' } }
}
