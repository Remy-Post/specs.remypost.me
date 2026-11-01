import { connection, type NextRequest } from 'next/server'
import { publicJson } from '@/lib/http'
import { parseRange } from '@/lib/schema'
import { history } from '@/lib/store'

export async function GET(request: NextRequest) {
  await connection()
  const range = parseRange(request.nextUrl.searchParams.get('range'))
  return publicJson(history(range))
}
