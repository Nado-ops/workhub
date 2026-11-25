import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'

const LINKS = [
  { to: '/portal', label: 'Dashboard', end: true },
  { to: '/portal/tickets', label: 'My tickets' },
  { to: '/portal/projects', label: 'My projects' },
  { to: '/portal/invoices', label: 'Quotes & invoices' },
]

/** The client portal shell: a header across the top. */
export default function ClientLayout() {
  const { profile, signOut } = useAuth()
  const [company, setCompany] = useState('')

  useEffect(() => {
    if (!profile?.client_id) return
    supabase.from('clients').select('name').eq('id', profile.client_id).single()
      .then(({ data }) => setCompany(data?.name ?? ''))
  }, [profile?.client_id])

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 md:p-5">
      <header className="card flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <img src="/logo-mark-light.png" alt="Work Hub" className="h-8 w-auto" />
          <div>
            <p className="text-sm font-semibold">{company || 'Your company'}</p>
            <p className="text-xs text-muted">Support portal</p>
          </div>
        </div>
        <nav aria-label="Client" className="flex flex-wrap gap-1">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm no-underline ${isActive ? 'bg-[#16282B] font-semibold text-text' : 'text-soft hover:text-text'}`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <span className="text-sm text-soft">{profile?.full_name || profile?.email}</span>
          <button onClick={signOut} className="btn-ghost h-9">Sign out</button>
        </div>
      </header>
      <Outlet />
    </div>
  )
}
