import { createClient } from '@supabase/supabase-js'

// Remember the link someone arrived with before Supabase tidies it away.
// Invite and password-reset emails add "type=invite" / "type=recovery",
// and those people need to choose a password first.
export const setPasswordFlow = { pending: /type=(invite|recovery)/.test(window.location.hash) }

// These come from .env.local (on your PC) or from Cloudflare's
// environment variables (when it's live). See .env.example.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(url && anonKey)

// One shared connection to the database for the whole app.
export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing-key')
