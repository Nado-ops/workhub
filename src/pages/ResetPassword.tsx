import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { setPasswordFlow, supabase } from '../lib/supabase'

// The page people land on from the "reset password" or invite email.
export default function ResetPassword() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) setError(error.message)
    else {
      setPasswordFlow.pending = false
      navigate('/', { replace: true })
    }
  }

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <form onSubmit={handleSubmit} className="card w-full max-w-sm p-8 flex flex-col gap-5">
        <h1 className="text-lg font-semibold">Choose a new password</h1>
        <label className="label">
          New password
          <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button className="btn-primary h-11" disabled={busy}>Save password</button>
      </form>
    </div>
  )
}
