import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Extra, Project } from '../../lib/types'
import { PHASE_LABEL, rand, shortDate } from '../../lib/format'
import PhaseSteps from '../../components/PhaseSteps'

type Row = Project & { extras: Extra[] }

/** A client's projects: progress, budget, and extra work to approve. */
export default function ClientProjects() {
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    // The database only returns this client's own projects and extras.
    const { data, error } = await supabase.from('projects').select('*, extras(*)').neq('status', 'done').order('due_date')
    if (error) setError(error.message)
    setRows((data as Row[] | null) ?? [])
  }
  useEffect(() => { load() }, [])

  async function respond(extra: Extra, approve: boolean) {
    setBusyId(extra.id)
    const { error } = await supabase.rpc('respond_to_extra', { extra_id: extra.id, approve })
    setBusyId(null)
    if (error) setError(error.message)
    else load()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="pt-2">
        <h1 className="text-2xl font-semibold">Your projects</h1>
        <p className="mt-1 text-sm text-muted">See where your work is, what it costs, and approve any extra work.</p>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {rows.length === 0 && <p className="card p-6 text-sm text-muted">No active projects right now.</p>}

      {rows.map((p) => {
        const approved = p.extras.filter((x) => x.status === 'approved').reduce((s, x) => s + Number(x.amount), 0)
        const waiting = p.extras.filter((x) => x.status === 'waiting')
        return (
          <section key={p.id} className="card flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{p.name}</h2>
                <p className="text-sm text-muted">{p.type ?? 'Project'} · {p.due_date ? `due ${shortDate(p.due_date)}` : 'no due date yet'}</p>
              </div>
              <span className="pill bg-success-soft text-success">{p.progress}% done</span>
            </div>

            <div>
              <div className="h-2 rounded bg-raised"><div className="h-2 rounded bg-accent" style={{ width: `${p.progress}%` }} /></div>
              <p className="mt-1.5 text-xs text-soft">Now in the {PHASE_LABEL[p.phase].toLowerCase()} phase</p>
            </div>
            <PhaseSteps phase={p.phase} />

            {p.waiting_on_client && (
              <p className="rounded-xl border border-info/30 bg-info-soft p-3 text-sm">
                <b className="text-info">Next step is yours:</b> we're waiting for your approval to carry on. Check your email or raise a ticket with any questions.
              </p>
            )}

            {Number(p.budget) > 0 && (
              <div className="grid gap-2 border-t border-line pt-4 text-sm">
                <div className="flex justify-between"><span className="text-soft">Original quote</span><span>{rand(Number(p.budget))}</span></div>
                <div className="flex justify-between"><span className="text-soft">Approved extras</span><span>{rand(approved)}</span></div>
                <div className="flex justify-between font-semibold"><span>Total</span><span>{rand(Number(p.budget) + approved)}</span></div>
              </div>
            )}

            {p.extras.length > 0 && (
              <div className="border-t border-line pt-4">
                <h3 className="font-semibold">Extra work</h3>
                <p className="text-xs text-muted">Nothing is added to your bill until you approve it.</p>
                {p.extras.map((x) => (
                  <div key={x.id} className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
                    <div className="min-w-0 flex-[1_1_220px]">
                      <p className="text-sm font-medium">{x.name}</p>
                      {x.note && <p className="text-xs text-muted">{x.note}</p>}
                    </div>
                    <b className="text-sm">{rand(Number(x.amount))}</b>
                    {x.status === 'waiting' ? (
                      <span className="flex gap-2">
                        <button className="btn-ghost h-9" disabled={busyId === x.id} onClick={() => respond(x, false)}>Decline</button>
                        <button className="btn-primary h-9" disabled={busyId === x.id} onClick={() => respond(x, true)}>Approve</button>
                      </span>
                    ) : (
                      <span className={`pill ${x.status === 'approved' ? 'bg-success-soft text-success' : 'bg-raised text-muted'}`}>
                        {x.status === 'approved' ? 'Approved' : 'Declined'}
                      </span>
                    )}
                  </div>
                ))}
                {waiting.length > 0 && <p className="mt-3 text-xs text-warn">{waiting.length} waiting for your answer.</p>}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
