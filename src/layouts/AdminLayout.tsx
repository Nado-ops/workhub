import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import type { Role } from '../lib/types'

interface Item {
  to: string
  label: string
  staffLabel?: string
  roles: Role[] // who sees this menu item
}

const MAIN: Item[] = [
  { to: '/app', label: 'Overview', roles: ['admin', 'staff'] },
  { to: '/app/tickets', label: 'Support tickets', roles: ['admin', 'staff'] },
  { to: '/app/clients', label: 'Clients', roles: ['admin', 'staff'] },
  { to: '/app/projects', label: 'Projects', roles: ['admin', 'staff'] },
  { to: '/app/pipeline', label: 'CRM pipeline', roles: ['admin', 'staff'] },
  { to: '/app/finance', label: 'Finance', roles: ['admin'] },
  { to: '/app/vendors', label: 'Vendors', roles: ['admin'] },
  { to: '/app/reports', label: 'Reports', roles: ['admin', 'staff'] },
  { to: '/app/study', label: 'Study reminders', roles: ['admin'] },
]

const WORKSPACE: Item[] = [
  { to: '/app/hr', label: 'HR & people', staffLabel: 'My HR', roles: ['admin', 'staff'] },
  { to: '/app/team', label: 'Team & roles', roles: ['admin'] },
]

/** The admin & staff shell: menu on the left, the page on the right. */
export default function AdminLayout() {
  const { profile, signOut } = useAuth()
  const role = profile?.role ?? 'staff'
  const visible = (items: Item[]) => items.filter((i) => i.roles.includes(role))

  const link = ({ isActive }: { isActive: boolean }) =>
    `flex rounded-lg px-2.5 py-2 text-sm no-underline ${isActive ? 'bg-[#16282B] font-semibold text-text' : 'text-soft hover:text-text'}`

  return (
    <div className="flex min-h-screen flex-wrap items-start gap-4 p-4 md:p-5">
      <nav aria-label="Main" className="card flex w-full flex-col gap-0.5 p-3 md:sticky md:top-5 md:w-60">
        <NavLink to="/app" end className="mb-3 flex items-center gap-2.5 px-2 pt-1 no-underline text-text">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent font-bold text-accent-ink">W</span>
          <span className="font-semibold">Work Hub</span>
        </NavLink>

        <p className="px-2.5 pt-2 pb-1 text-[11px] tracking-widest text-muted">MAIN</p>
        {visible(MAIN).map((i) => (
          <NavLink key={i.to} to={i.to} end={i.to === '/app'} className={link}>
            {i.label}
          </NavLink>
        ))}

        <p className="px-2.5 pt-4 pb-1 text-[11px] tracking-widest text-muted">WORKSPACE</p>
        {visible(WORKSPACE).map((i) => (
          <NavLink key={i.to} to={i.to} className={link}>
            {role === 'staff' && i.staffLabel ? i.staffLabel : i.label}
          </NavLink>
        ))}

        <div className="mt-4 border-t border-line px-2.5 pt-3">
          <p className="truncate text-sm font-medium">{profile?.full_name || profile?.email}</p>
          <p className="text-xs text-muted capitalize">{role}</p>
          <button onClick={signOut} className="mt-2 text-xs text-muted hover:text-text cursor-pointer">Sign out</button>
        </div>
      </nav>

      <main className="min-w-0 flex-[999_1_560px]">
        <Outlet />
      </main>
    </div>
  )
}
