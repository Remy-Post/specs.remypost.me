import { ViewTransition } from 'react'
import { MACHINE_NAMES } from '@/lib/machines'
import type { MachineId } from '@/lib/schema'

/**
 * The page heading. On a machine page the label carries the machine's name under a shared transition name, so on
 * the way from Compare the column heading morphs into it.
 */
export default function Nameplate({ machine, children }: { machine?: MachineId; children?: React.ReactNode }) {
  return (
    <header className="intro">
      <p className="label">
        Appendix S ·{' '}
        {machine ? (
          <ViewTransition name={`machine-${machine}`} share="morph" default="none">
            <span className="intro__machine">{MACHINE_NAMES[machine]}</span>
          </ViewTransition>
        ) : (
          'Compare'
        )}
      </p>
      <h1>Specs</h1>
      <p className="voice intro__sub">What Remy&rsquo;s machines are doing, live.</p>
      {children}
    </header>
  )
}
