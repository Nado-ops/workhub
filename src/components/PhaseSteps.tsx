import type { ProjectPhase } from '../lib/types'
import { PHASES, PHASE_LABEL } from '../lib/format'

// The Plan → Design → Build → Launch strip on project cards.
export default function PhaseSteps({ phase, done }: { phase: ProjectPhase; done?: boolean }) {
  const at = PHASES.indexOf(phase)
  return (
    <div className="flex gap-1">
      {PHASES.map((ph, i) => (
        <span
          key={ph}
          className={`flex-1 rounded-md py-1.5 text-center text-[11px] ${
            done || i < at ? 'bg-success-soft text-success' : i === at ? 'bg-accent-soft font-semibold text-text' : 'bg-raised text-muted'
          }`}
        >
          {PHASE_LABEL[ph]}
        </span>
      ))}
    </div>
  )
}
