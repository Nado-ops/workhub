import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase, supabaseConfigured } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'

export default function Login() {
  const { session, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  if (!loading && session) return <Navigate to="/" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setError('That email and password don’t match. Check them and try again.')
  }

  async function handleForgot() {
    if (!email.trim()) {
      setError('Type your email first, then tap “Forgot password”.')
      return
    }
    setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (error) setError(error.message)
    else setNotice('If that email has an account, a reset link is on its way.')
  }

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <form onSubmit={handleSubmit} className="card w-full max-w-sm p-8 flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent font-bold text-accent-ink">W</span>
          <div>
            <h1 className="text-lg font-semibold">Work Hub</h1>
            <p className="text-xs text-muted">Sign in to continue</p>
          </div>
        </div>

        {!supabaseConfigured && (
          <p className="rounded-xl bg-[#3A2A10] p-3 text-xs text-warn">
            The app isn’t connected to Supabase yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see README).
          </p>
        )}

        <label className="label">
          Email
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="label">
          Password
          <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>

        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {notice && <p role="status" className="text-sm text-accent">{notice}</p>}

        <button className="btn-primary h-11" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button type="button" onClick={handleForgot} className="text-xs text-muted hover:text-text cursor-pointer">
          Forgot password?
        </button>
      </form>
    </div>
  )
}
