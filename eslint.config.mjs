import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // agent/ and n8n/ are separate packages.
  globalIgnores(['.next/**', 'coverage/**', 'next-env.d.ts', 'agent/**', 'n8n/**']),
])
