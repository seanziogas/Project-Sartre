import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Defense-in-depth backstop: every page and server action still authorizes
 * individually via getPortalIdentity, but a route that forgets the call must
 * never ship unauthenticated. This cannot validate grants (the access file is
 * not readable here) — it only guarantees a proxy-asserted identity exists.
 */
export function middleware(request: NextRequest): NextResponse {
  if (process.env.SARTRE_TRUSTED_AUTH_PROXY !== 'true') {
    return new NextResponse('SARTRE_TRUSTED_AUTH_PROXY=true is required for portal access', { status: 503 })
  }
  if (!request.headers.get('x-sartre-user-id')?.trim()) {
    return new NextResponse('authenticated portal identity is required', { status: 401 })
  }
  return NextResponse.next()
}

export const config = {
  // /api/health stays identity-free for deployment liveness probes.
  matcher: ['/((?!api/health|_next/static|_next/image|favicon.ico).*)'],
}
