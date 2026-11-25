import { useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase, supabaseConfigured } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'

// Short, original lines that rotate on the left. Add your own here.
const LINES = [
  { text: 'Small steps every day add up to big things.', tag: 'Keep going' },
  { text: 'Every ticket closed is someone’s day made easier.', tag: 'Support' },
  { text: 'Do the work you’d be proud to show a client.', tag: 'Quality' },
  { text: 'Learn one new thing today. Use it tomorrow.', tag: 'Growth' },
  { text: 'Clear plans, calm days, happy clients.', tag: 'Focus' },
  { text: 'Progress beats perfect. Ship it, then make it better.', tag: 'Momentum' },
]

export default function Login() {
  const { session, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [line, setLine] = useState(0)

  // Change the motivational line every 6 seconds
  useEffect(() => {
    const t = setInterval(() => setLine((n) => (n + 1) % LINES.length), 6000)
    return () => clearInterval(t)
  }, [])

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

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const current = LINES[line]

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Left: animated panel */}
      <section
        aria-label="Welcome"
        className="relative flex min-h-[300px] flex-col justify-between overflow-hidden p-8 md:min-h-screen md:w-[55%] md:p-14"
        style={{ background: '#0B1530' }}
      >
        {/* Background photo (public/login-bg.webp) with a very slow zoom */}
        <img
          src="/login-bg.webp"
          alt=""
          aria-hidden="true"
          className="slow-zoom pointer-events-none absolute inset-0 h-full w-full object-cover object-right"
        />
        {/* Darker on the left and bottom so the words stay easy to read */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: 'linear-gradient(90deg, rgba(8,14,30,0.78) 0%, rgba(8,14,30,0.45) 45%, rgba(8,14,30,0) 75%), linear-gradient(0deg, rgba(8,14,30,0.65) 0%, rgba(8,14,30,0) 40%)' }}
        />

        <div className="relative flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-lg font-bold text-accent-ink">W</span>
          <span className="text-lg font-semibold">Work Hub</span>
        </div>

        <div className="relative max-w-[440px] py-8 md:py-0">
          <p className="text-sm text-[#F5C46A]">{greeting}</p>
          <div key={line} className="quote-in" aria-live="polite">
            <p className="mt-4 text-[11px] font-semibold tracking-[0.2em] text-accent uppercase">{current.tag}</p>
            <p className="mt-2 text-2xl leading-snug font-semibold md:text-4xl md:leading-tight">{current.text}</p>
          </div>
          <div className="mt-6 flex gap-1.5" aria-hidden="true">
            {LINES.map((_, i) => (
              <span key={i} className={`h-1 rounded-full transition-all duration-500 ${i === line ? 'w-8 bg-accent' : 'w-3 bg-[#2A4A47]'}`} />
            ))}
          </div>
        </div>

        <p className="relative hidden text-xs text-[#C9D6D7] md:block">Tickets · Projects · Clients · Finance · HR — all in one place.</p>
      </section>

      {/* Right: sign-in form */}
      <main className="flex flex-1 items-center justify-center p-6 md:p-12">
        <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-5">
          <div>
            <h1 className="text-2xl font-semibold">Sign in</h1>
            <p className="mt-1 text-sm text-muted">Welcome back. Use the email you were invited with.</p>
          </div>

          {!supabaseConfigured && (
            <p className="rounded-xl bg-[#3A2A10] p-3 text-xs text-warn">
              The app isn’t connected to Supabase yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see README).
            </p>
          )}

          <label className="label">
            Email
            <input className="input h-12" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="label">
            <span className="flex items-center justify-between">
              Password
              <button type="button" onClick={handleForgot} className="cursor-pointer text-xs text-accent hover:text-[#7FE6D3]">Forgot password?</button>
            </span>
            <input className="input h-12" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>

          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          {notice && <p role="status" className="text-sm text-accent">{notice}</p>}

          <button className="btn-primary h-12 text-base" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <p className="text-center text-xs text-muted">Need access? Ask your Work Hub admin to invite you.</p>
        </form>
      </main>
    </div>
  )
}
