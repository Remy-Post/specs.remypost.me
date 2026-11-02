// Runs once when the server starts. The VM sampler lives here so one timer feeds every open page.
// SPECS_VM_SAMPLER=off turns it off (tests, and a dev machine that is not the VM).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.SPECS_VM_SAMPLER === 'off') return
  const { startSampler } = await import('./lib/vm/sampler')
  startSampler()
}
