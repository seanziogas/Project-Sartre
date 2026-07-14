import { getOpsDatabase } from '@/lib/postgres'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  try {
    await (await getOpsDatabase()).health()
    return Response.json({ status: 'ok', database: 'ok' }, { status: 200, headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ status: 'unavailable', database: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
