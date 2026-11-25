import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface TeamMember { id: string; full_name: string; email: string | null; role: string }

/** The admin + staff people, for "assign to" dropdowns. */
export function useTeam() {
  const [team, setTeam] = useState<TeamMember[]>([])
  useEffect(() => {
    supabase.from('profiles').select('id, full_name, email, role').in('role', ['admin', 'staff']).order('full_name')
      .then(({ data }) => setTeam((data as TeamMember[] | null) ?? []))
  }, [])
  return team
}

export const personName = (p: { full_name?: string | null; email?: string | null } | null | undefined) =>
  p?.full_name || p?.email || 'Unassigned'
