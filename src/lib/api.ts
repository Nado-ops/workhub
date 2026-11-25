import { supabase } from './supabase'

/** Call the Work Hub server (worker/index.ts) with your login, e.g. serverApi('users/invite', {...}). */
export async function serverApi<T = unknown>(path: string, body: unknown = {}): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const res = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const out = await res.json().catch(() => ({ error: `The server didn’t answer (${res.status}).` }))
  if (!res.ok) throw new Error((out as { error?: string }).error ?? 'Something went wrong')
  return out as T
}
