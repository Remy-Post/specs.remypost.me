import { connection, type NextRequest } from 'next/server'
import { json, publicJson } from '@/lib/http'
import { parseMachine, parseRange } from '@/lib/machines'
import { cachedHistory } from '@/lib/store'

export async function GET(request: NextRequest) {
  await connection()
  const params = request.nextUrl.searchParams
  const asked = params.get('machine')
  const machine = asked === null ? 'mac' : parseMachine(asked)
  if (!machine) return json({ error: 'unknown machine' }, 400, { 'Access-Control-Allow-Origin': '*' })
  return publicJson(cachedHistory(machine, parseRange(params.get('range'))))
}
