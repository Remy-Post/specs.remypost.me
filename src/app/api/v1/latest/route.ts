import { connection, type NextRequest } from 'next/server'
import { currentReading } from '@/lib/current'
import { json, publicJson } from '@/lib/http'
import { parseMachine } from '@/lib/machines'

const CORS = { 'Access-Control-Allow-Origin': '*' }

export async function GET(request: NextRequest) {
  await connection()
  const asked = request.nextUrl.searchParams.get('machine')
  const machine = asked === null ? 'mac' : parseMachine(asked)
  if (!machine) return json({ error: 'unknown machine' }, 400, CORS)

  if (machine === 'vm') {
    const latest = currentReading('vm')
    return latest ? publicJson({ machine, ...latest }) : json({ error: 'no data yet' }, 404, CORS)
  }
  // The Mac keeps its v1 shape ({ receivedAt, snapshot }) so existing readers do not break.
  const latest = currentReading('mac')
  return latest ? publicJson({ receivedAt: latest.receivedAt, snapshot: latest.reading }) : json({ error: 'no data yet' }, 404, CORS)
}
