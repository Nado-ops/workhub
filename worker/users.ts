// Adding and managing logins from Work Hub (Team & settings), admins only.
//
// Creating a login needs Supabase's service_role key, which can do anything — so it ONLY lives here,
// as the Cloudflare secret SUPABASE_SERVICE_ROLE_KEY, and is only used AFTER we've checked (with the
// person's own login) that they're an admin. It's never sent to the browser.
//
// "Remove access" blocks the login instead of deleting it, so the person's history (tickets, leave,
// timesheets, claims) stays intact. It can be undone with "Give access back".

export interface UsersEnv { SUPABASE_URL: string; SUPABASE_ANON_KEY: string; SUPABASE_SERVICE_ROLE_KEY?: string }

export class UserAdmin {
  constructor(private env: UsersEnv) {}

  get ready() { return Boolean(this.env.SUPABASE_SERVICE_ROLE_KEY) }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const key = this.env.SUPABASE_SERVICE_ROLE_KEY
    if (!key) throw new Error('Adding people isn’t set up yet: add the SUPABASE_SERVICE_ROLE_KEY secret in Cloudflare (README → Team).')
    const res = await fetch(`${this.env.SUPABASE_URL}/auth/v1${path}`, {
      ...init,
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    })
    const out = (await res.json().catch(() => ({}))) as T & { msg?: string; message?: string; error_description?: string }
    if (!res.ok) {
      const why = out.msg || out.message || out.error_description || `status ${res.status}`
      if (/already been registered|already exists/i.test(why)) throw new Error('Someone with that email already has a login. Find them in the list below.')
      if (/rate limit/i.test(why)) throw new Error('Supabase has hit its email limit for now. Wait an hour, or set up your own email sender in Supabase (README → Team).')
      throw new Error(`Supabase: ${why}`)
    }
    return out
  }

  /** Create the login and email an invite link (they set their own password). */
  invite(email: string, fullName: string, redirectTo: string) {
    return this.call<{ id: string }>(`/invite?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: 'POST', body: JSON.stringify({ email, data: { full_name: fullName } }),
    })
  }

  /** Login status for everyone: invite waiting, last login, blocked. */
  async list() {
    const out: { id: string; invited_at: string | null; last_sign_in_at: string | null; banned_until: string | null }[] = []
    for (let page = 1; page <= 20; page++) {
      const r = await this.call<{ users: { id: string; invited_at?: string; last_sign_in_at?: string; banned_until?: string }[] }>(`/admin/users?page=${page}&per_page=200`)
      out.push(...r.users.map((u) => ({ id: u.id, invited_at: u.invited_at ?? null, last_sign_in_at: u.last_sign_in_at ?? null, banned_until: u.banned_until ?? null })))
      if (r.users.length < 200) break
    }
    return out
  }

  /** Block or unblock a login. ~100 years = until you unblock it. */
  setBlocked(userId: string, blocked: boolean) {
    return this.call(`/admin/users/${userId}`, { method: 'PUT', body: JSON.stringify({ ban_duration: blocked ? '876000h' : 'none' }) })
  }

  /** Email a "set your password" link (works for a waiting invite and for a forgotten password). */
  async sendLoginLink(email: string, redirectTo: string) {
    const res = await fetch(`${this.env.SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: 'POST',
      headers: { apikey: this.env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (!res.ok) throw new Error(res.status === 429 ? 'Supabase has hit its email limit. Try again in an hour.' : `Couldn’t send the link (${res.status}).`)
  }
}
