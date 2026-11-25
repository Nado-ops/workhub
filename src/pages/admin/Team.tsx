import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { serverApi } from '../../lib/api'
import { useAuth } from '../../auth/AuthProvider'
import { timeAgo } from '../../lib/format'
import { PERMISSIONS, type Client, type Permission, type Profile, type Role } from '../../lib/types'
import BusinessSettings from '../../components/BusinessSettings'
import EmailSettings from '../../components/EmailSettings'

interface CustomRole { id: string; name: string; description: string | null; permissions: Permission[] }
interface LoginStatus { id: string; invited_at: string | null; last_sign_in_at: string | null; banned_until: string | null }

/** Admin only: add people, set their role (and company or custom role), block access, and manage roles. */
export default function Team() {
  const { profile: me } = useAuth()
  const [people, setPeople] = useState<Profile[]>([])
  const [clients, setClients] = useState<Pick<Client, 'id' | 'name'>[]>([])
  const [roles, setRoles] = useState<CustomRole[]>([])
  const [logins, setLogins] = useState<Record<string, LoginStatus> | null>(null)
  const [ready, setReady] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  async function load() {
    const [p, r] = await Promise.all([
      supabase.from('profiles').select('id, email, full_name, job_title, role, client_id, role_id').order('role').order('full_name'),
      supabase.from('roles').select('*').order('name'),
    ])
    if (p.error) setError(p.error.message)
    setPeople((p.data as Profile[] | null) ?? [])
    setRoles((r.data as CustomRole[] | null) ?? [])
    serverApi<{ ready: boolean; users: LoginStatus[] }>('users/list')
      .then((out) => { setReady(out.ready); setLogins(Object.fromEntries(out.users.map((u) => [u.id, u]))) })
      .catch(() => { setReady(false); setLogins(null) })
  }
  useEffect(() => {
    load()
    supabase.from('clients').select('id, name').order('name').then(({ data }) => setClients(data ?? []))
  }, [])

  async function save(p: Profile, patch: Partial<Profile>) {
    setError(null); setSaved(null)
    const next = { ...p, ...patch }
    // A client must belong to a company; only staff have a custom role.
    if (next.role !== 'client') next.client_id = null
    if (next.role !== 'staff') next.role_id = null
    const { error } = await supabase.from('profiles')
      .update({ full_name: next.full_name, role: next.role, client_id: next.client_id, role_id: next.role_id ?? null }).eq('id', p.id)
    if (error) setError(error.message)
    else { setSaved(`Saved ${p.full_name || p.email}.`); load() }
  }

  async function act(label: string, fn: () => Promise<unknown>) {
    setError(null); setSaved(null)
    try { await fn(); setSaved(label) } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong') }
    load()
  }

  const status = (p: Profile) => {
    const l = logins?.[p.id]
    if (!l) return null
    if (l.banned_until && new Date(l.banned_until) > new Date()) return <span className="pill bg-danger-soft text-danger">No access</span>
    if (!l.last_sign_in_at) return <span className="pill bg-warn-soft text-warn">Invite sent{l.invited_at ? ` ${timeAgo(l.invited_at)}` : ''}</span>
    return <span className="text-xs text-muted">Last login {timeAgo(l.last_sign_in_at)}</span>
  }
  const blocked = (p: Profile) => { const l = logins?.[p.id]; return !!l?.banned_until && new Date(l.banned_until) > new Date() }

  return (
    <div className="flex flex-col gap-4">
      <div className="pt-2">
        <h1 className="text-2xl font-semibold">Team &amp; settings</h1>
        <p className="mt-1 text-sm text-muted">Who can log in, and what they're allowed to see.</p>
      </div>

      {ready === false && (
        <div className="card border-warn/30 bg-warn-soft p-4 text-sm">
          <p className="font-semibold text-warn">Adding people from here isn’t switched on yet</p>
          <p className="mt-1 text-soft">Add the <code>SUPABASE_SERVICE_ROLE_KEY</code> secret in Cloudflare (README → Team). Until then, invite people in Supabase (Authentication → Users → Invite user) and set their role below.</p>
        </div>
      )}

      <InviteForm clients={clients} roles={roles} disabled={!ready} onInvited={(name) => { setSaved(`Invite sent to ${name}.`); load() }} />

      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      {saved && <p role="status" className="text-sm text-success">{saved}</p>}

      <section className="card overflow-x-auto">
        <table className="w-full min-w-[920px] border-collapse">
          <thead><tr><th className="th">Person</th><th className="th">Name</th><th className="th">Role</th><th className="th">Company / custom role</th><th className="th"></th></tr></thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id} className={blocked(p) ? 'opacity-60' : ''}>
                <td className="td">
                  <p className="text-soft">{p.email}{p.id === me?.id && <span className="text-muted"> (you)</span>}</p>
                  <p className="mt-0.5">{status(p)}</p>
                </td>
                <td className="td">
                  <input aria-label={`Name for ${p.email}`} className="input h-9" defaultValue={p.full_name}
                    onBlur={(e) => e.target.value !== p.full_name && save(p, { full_name: e.target.value })} />
                </td>
                <td className="td">
                  <select aria-label={`Role for ${p.email}`} className="input h-9" value={p.role} disabled={p.id === me?.id}
                    onChange={(e) => save(p, { role: e.target.value as Role })}>
                    <option value="admin">Admin</option><option value="staff">Staff</option><option value="client">Client</option>
                  </select>
                </td>
                <td className="td">
                  {p.role === 'client' ? (
                    <select aria-label={`Company for ${p.email}`} className={`input h-9 ${p.client_id ? '' : 'border-warn'}`} value={p.client_id ?? ''}
                      onChange={(e) => save(p, { client_id: e.target.value || null })}>
                      <option value="">Not linked yet</option>
                      {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  ) : p.role === 'staff' ? (
                    <select aria-label={`Custom role for ${p.email}`} className="input h-9" value={p.role_id ?? ''}
                      onChange={(e) => save(p, { role_id: e.target.value || null })}>
                      <option value="">Staff (standard)</option>
                      {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  ) : <span className="text-xs text-muted">Everything</span>}
                </td>
                <td className="td">
                  {ready && p.id !== me?.id && (
                    <div className="flex flex-wrap justify-end gap-2">
                      <button className="btn-ghost h-8 px-3 text-xs" title="Emails a link to set a password"
                        onClick={() => act(`Login link sent to ${p.email}.`, () => serverApi('users/link', { user_id: p.id }))}>Send login link</button>
                      {blocked(p) ? (
                        <button className="btn-ghost h-8 px-3 text-xs" onClick={() => act(`${p.full_name || p.email} can log in again.`, () => serverApi('users/access', { user_id: p.id, blocked: false }))}>Give access back</button>
                      ) : (
                        <button className="btn-ghost h-8 px-3 text-xs text-danger"
                          onClick={() => window.confirm(`Remove ${p.full_name || p.email}'s access? They won't be able to log in. Their history stays.`) &&
                            act(`${p.full_name || p.email} can't log in any more.`, () => serverApi('users/access', { user_id: p.id, blocked: true }))}>Remove access</button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="text-xs text-muted">You can't change your own role or remove your own access, so you can't lock yourself out by accident.</p>

      <RolesEditor roles={roles} onChange={load} />
      <BusinessSettings />
      <EmailSettings />
    </div>
  )
}

/** Add a person: they get an email with a link to set their password. */
function InviteForm({ clients, roles, disabled, onInvited }: {
  clients: Pick<Client, 'id' | 'name'>[]; roles: CustomRole[]; disabled: boolean; onInvited: (name: string) => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('staff')
  const [clientId, setClientId] = useState('')
  const [roleId, setRoleId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await serverApi('users/invite', { full_name: name.trim(), email: email.trim(), role, client_id: role === 'client' ? clientId : null, role_id: role === 'staff' ? roleId || null : null })
      onInvited(name.trim())
      setName(''); setEmail(''); setClientId(''); setRoleId('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Invite failed') }
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="card flex flex-wrap items-end gap-3 p-5">
      <div className="basis-full">
        <h2 className="text-lg font-semibold">Add a person</h2>
        <p className="text-sm text-muted">They get an email with a link to set their own password.</p>
      </div>
      <fieldset disabled={disabled || busy} className="contents">
        <label className="label flex-[2_1_180px]">Name<input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="label flex-[2_1_220px]">Email<input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="label flex-[1_1_140px]">Role
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="staff">Staff</option><option value="client">Client</option><option value="admin">Admin</option>
          </select>
        </label>
        {role === 'staff' && (
          <label className="label flex-[1_1_180px]">Custom role
            <select className="input" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              <option value="">Staff (standard)</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
        )}
        {role === 'client' && (
          <label className="label flex-[1_1_200px]">Company
            <select className="input" required value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="" disabled>Choose…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <button className="btn-primary">{busy ? 'Sending…' : 'Send invite'}</button>
      </fieldset>
      {role === 'admin' && <p className="basis-full text-xs text-warn">Admins can see and change everything, including Finance, HR and this page.</p>}
      {error && <p className="basis-full text-sm text-danger">{error}</p>}
    </form>
  )
}

/** Custom roles = staff + extra powers. Changes apply the next time each person opens Work Hub. */
function RolesEditor({ roles, onChange }: { roles: CustomRole[]; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null)

  async function update(r: CustomRole, patch: Partial<CustomRole>) {
    const { error } = await supabase.from('roles').update(patch).eq('id', r.id)
    setError(error ? error.message : null); onChange()
  }
  async function add() {
    const name = window.prompt('Name of the new role (e.g. Support lead)')
    if (!name?.trim()) return
    const { error } = await supabase.from('roles').insert({ name: name.trim(), permissions: [] })
    setError(error ? (error.message.includes('duplicate') ? 'There is already a role with that name.' : error.message) : null); onChange()
  }
  async function remove(r: CustomRole) {
    if (!window.confirm(`Delete the role “${r.name}”? People with it go back to standard staff.`)) return
    const { error } = await supabase.from('roles').delete().eq('id', r.id)
    setError(error ? error.message : null); onChange()
  }
  const toggle = (r: CustomRole, p: Permission) =>
    update(r, { permissions: r.permissions.includes(p) ? r.permissions.filter((x) => x !== p) : [...r.permissions, p] })

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Roles</h2>
          <p className="text-sm text-muted">Every staff member can see tickets, clients, projects, the CRM, tasks and their own HR. A custom role adds powers on top.</p>
        </div>
        <button className="btn-ghost" onClick={add}>+ New role</button>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr>
              <th className="th">Role</th>
              {PERMISSIONS.map((p) => <th key={p.key} className="th" title={p.hint}>{p.label}</th>)}
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id}>
                <td className="td">
                  <input aria-label="Role name" className="input h-9" defaultValue={r.name}
                    onBlur={(e) => e.target.value.trim() && e.target.value !== r.name && update(r, { name: e.target.value.trim() })} />
                </td>
                {PERMISSIONS.map((p) => (
                  <td key={p.key} className="td">
                    <input type="checkbox" className="h-4 w-4 accent-[#B8893A]" aria-label={`${r.name}: ${p.label}`}
                      checked={r.permissions.includes(p.key)} onChange={() => toggle(r, p.key)} />
                  </td>
                ))}
                <td className="td text-right"><button className="text-xs text-muted hover:text-danger" onClick={() => remove(r)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-3 grid gap-1 text-xs text-muted sm:grid-cols-2">
        {PERMISSIONS.map((p) => <li key={p.key}><b className="text-soft">{p.label}:</b> {p.hint}</li>)}
      </ul>
      <p className="mt-2 text-xs text-muted">Only admins can open Team &amp; settings, the activity log and business details.</p>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  )
}
