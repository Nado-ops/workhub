import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Permission, Profile } from '../lib/types'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

/**
 * Keeps track of who is logged in and loads their profile
 * (name, role and company) from the `profiles` table.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadProfile(userId: string | undefined) {
    if (!userId) {
      setProfile(null)
      return
    }
    const { data } = await supabase
      .from('profiles')
      .select('id, email, full_name, job_title, role, client_id, role_id, custom_role:roles(name, permissions)')
      .eq('id', userId)
      .single()
    setProfile((data as Profile | null) ?? null)
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await loadProfile(data.session?.user.id)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      // Load the profile outside the callback (Supabase recommends not awaiting in here)
      setTimeout(() => {
        loadProfile(newSession?.user.id).finally(() => setLoading(false))
      }, 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const value: AuthState = {
    session,
    profile,
    loading,
    signOut: async () => {
      await supabase.auth.signOut()
    },
    refreshProfile: () => loadProfile(session?.user.id),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

export const isTeam = (p: Profile | null) => p?.role === 'admin' || p?.role === 'staff'

/** Can this person do X? Admins can do everything; staff only what their custom role allows. */
export const canDo = (p: Profile | null, permission: Permission) =>
  p?.role === 'admin' || (p?.role === 'staff' && !!p.custom_role?.permissions.includes(permission))

/** const can = useCan(); if (can('finance')) … */
export function useCan() {
  const { profile } = useAuth()
  return (permission: Permission) => canDo(profile, permission)
}
