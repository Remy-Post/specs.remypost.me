// The privacy boundary for container names. The VM runs containers whose names are personal, so only the names
// below are ever published; everything else, and any container the host sampler has not named yet, is summed
// into "Other services". Add a name here only if it is fine on a public page.

export const OTHER_SERVICES = 'Other services'

/** Every label that can appear in a reading; the VmReading schema accepts nothing else. */
export const CONTAINER_LABELS = ['specs (this site)', 'Caddy', 'Cloudflare Tunnel', 'Course Hub', OTHER_SERVICES] as const

export type ContainerLabel = (typeof CONTAINER_LABELS)[number]

// Docker container name -> public label.
const ALLOWED = {
  specs: 'specs (this site)',
  'n8n-caddy-1': 'Caddy',
  'n8n-cloudflared-1': 'Cloudflare Tunnel',
  'n8n-hub': 'Course Hub',
  'hub-web': 'Course Hub',
} as const satisfies Record<string, ContainerLabel>

/** hasOwn, so "constructor" or "__proto__" can never match. */
export function publicName(dockerName: string | undefined): ContainerLabel {
  if (dockerName !== undefined && Object.hasOwn(ALLOWED, dockerName)) return ALLOWED[dockerName as keyof typeof ALLOWED]
  return OTHER_SERVICES
}
