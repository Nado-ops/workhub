import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { canDo, useAuth } from './AuthProvider'
import type { Permission, Role } from '../lib/types'

/**
 * Wrap a page with this to say which roles may open it.
 * This only hides screens — the real protection is the Row Level
 * Security in the database, so nobody can read data they shouldn't
 * even if they type a URL by hand.
 */
export function RequireRole({ roles, perm, children }: { roles: Role[]; perm?: Permission; children: ReactNode }) {
  const { session, profile, loading } = useAuth()
  const location = useLocation()

  if (loading) return <FullScreenMessage title="Loading…" />
  if (!session) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  if (!profile) return <FullScreenMessage title="We couldn't load your profile" text="Try signing out and in again." />
  if (profile.role === 'client' && !profile.client_id) {
    return (
      <FullScreenMessage
        title="Your account isn't set up yet"
        text="Ask Nadeem to link your login to your company. You'll see your dashboard as soon as that's done."
        showSignOut
      />
    )
  }
  if (!roles.includes(profile.role)) return <Navigate to="/" replace />
  if (perm && !canDo(profile, perm)) return <Navigate to="/" replace />
  return <>{children}</>
}

export function FullScreenMessage({ title, text, showSignOut }: { title: string; text?: string; showSignOut?: boolean }) {
  const { signOut } = useAuth()
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="card max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold">{title}</h1>
        {text && <p className="mt-2 text-sm text-muted">{text}</p>}
        {showSignOut && (
          <button className="btn-ghost mt-6" onClick={signOut}>
            Sign out
          </button>
        )}
      </div>
    </div>
  )
}
