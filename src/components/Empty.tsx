import type { MachineId } from '@/lib/schema'

const COPY: Record<MachineId, string> = {
  mac: 'The Mac reports every minute while it is awake. The first reading will appear here as soon as one arrives.',
  vm: 'The server reads its own numbers every five seconds. The first reading will appear here as soon as the sampler has two to compare.',
}

export default function Empty({ machine }: { machine: MachineId }) {
  return (
    <section className="card card--empty" aria-labelledby="empty">
      <p className="label">S.1</p>
      <h2 className="voice" id="empty">
        No readings yet
      </h2>
      <p className="fine">{COPY[machine]}</p>
    </section>
  )
}
