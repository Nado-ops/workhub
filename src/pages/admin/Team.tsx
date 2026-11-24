import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import type { Client, Profile, Role } from '../../lib/types'

/** Admin only: set each person's role and, for clients, their company. */
export default function Team() {
  const { profile: me } = useAuth()
  const [people, setPeople] = useState<Profile[]>([])
  const [clients, setClients] = useState<Pick<Client, 'id' | 'name'>[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  async function load() {
    const { data, error } = await supabase.from('profiles').select('id, email, full_name, job_title, role, client_id').order('role').order('full_name')
    if (error) setError(error.message)
    setPeople((data as Profile[] | null) ?? [])
  }
  useEffect(() => {
    load()
    supabase.from('clients').select('id, name').order('name').then(({ data }) => setClients(data ?? []))
  }, [])

  async function save(p: Profile, patch: Partial<Profile>) {
    setError(null)
    // A client must belong to a company; staff and admins must not.
    const next = { ...p, ...patch }
    if (next.role !== 'client') next.client_id = null
    const { error } = await supabase.from('profiles')
      .update({ full_name: next.full_name, job_title: next.job_title, role: next.role, client_id: next.client_id }).eq('id', p.id)
    if (error) setError(error.message)
    else { setSaved(p.email); load() }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="pt-2">
        <h1 className="text-2xl font-semibold">Team &amp; roles</h1>
        <p className="mt-1 text-sm text-muted">Who can log in, and what they're allowed to see.</p>
      </div>

      <div className="card p-5 text-sm text-soft">
        <b className="text-text">Adding someone:</b> in Supabase go to Authentication → Users → <b>Invite user</b> and enter their email.
        They'll appear below as a client with no company. Then set their role here (and their company if they're a client).
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {saved && <p role="status" className="text-sm text-accent">Saved {saved}.</p>}

      <section className="card overflow-x-auto">
        <table className="w-full min-w-[780px] border-collapse">
          <thead><tr><th className="th">Person</th><th className="th">Name</th><th className="th">Role</th><th className="th">Company (clients)</th></tr></thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id}>
                <td className="td text-soft">{p.email}{p.id === me?.id && <span className="text-muted"> (you)</span>}</td>
                <td className="td">
                  <input
                    aria-label={`Name for ${p.email}`}
                    className="input h-9"
                    defaultValue={p.full_name}
                    onBlur={(e) => e.target.value !== p.full_name && save(p, { full_name: e.target.value })}
                  />
                </td>
                <td className="td">
                  <select
                    aria-label={`Role for ${p.email}`}
                    className="input h-9"
                    value={p.role}
                    disabled={p.id === me?.id}
                    onChange={(e) => save(p, { role: e.target.value as Role })}
                  >
                    <option value="admin">Admin</option><option value="staff">Staff</option><option value="client">Client</option>
                  </select>
                </td>
                <td className="td">
                  {p.role === 'client' ? (
                    <select
                      aria-label={`Company for ${p.email}`}
                      className={`input h-9 ${p.client_id ? '' : 'border-warn'}`}
                      value={p.client_id ?? ''}
                      onChange={(e) => save(p, { client_id: e.target.value || null })}
                    >
                      <option value="">Not linked yet</option>
                      {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  ) : <span className="text-muted">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="text-xs text-muted">You can't change your own role, so you can't lock yourself out by accident.</p>
    </div>
  )
}
