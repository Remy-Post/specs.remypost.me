import { json } from '@/lib/http'
import pkg from '../../../../package.json'

export function GET() {
  return json({ ok: true, version: pkg.version })
}
