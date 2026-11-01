import { connection } from 'next/server'
import { json, publicJson } from '@/lib/http'
import { latestSnapshot } from '@/lib/store'

export async function GET() {
  await connection()
  const latest = latestSnapshot()
  return latest ? publicJson(latest) : json({ error: 'no data yet' }, 404, { 'Access-Control-Allow-Origin': '*' })
}
