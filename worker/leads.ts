// Public address for website contact forms: POST /api/leads?key=<form key>
//
// Your websites (e.g. nanotechnology6.co.za) send their contact form here, and each enquiry becomes a lead
// in the CRM pipeline. Nobody logs in for this, so we protect it instead by:
//   • the form key: each website has its own (Work Hub → CRM pipeline → Website forms)
//   • the website check: the browser tells us which site the form is on (Origin), and it must be one of
//     that key's domains — the database checks this again
//   • a spam trap: a hidden field called "website" that people never see; bots fill it in, and we quietly ignore them
//   • a flood limit in the database (30 leads per website per 10 minutes)
// Works both with a plain HTML form (the visitor sees a thank-you page or your own page) and with JavaScript fetch.

export interface LeadsEnv { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY?: string }

const UUID = /^[0-9a-f-]{36}$/i
const bareHost = (url: string) => {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' }
}
const allowedBy = (domains: string[], host: string) =>
  domains.some((d) => { const bare = bareHost(`https://${d.replace(/^https?:\/\//, '')}`); return host === bare || host.endsWith(`.${bare}`) })

async function rpc<T>(env: LeadsEnv, fn: string, args: unknown): Promise<{ ok: boolean; data?: T; message?: string }> {
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const out = (await res.json().catch(() => ({}))) as T & { message?: string }
  return res.ok ? { ok: true, data: out } : { ok: false, message: out.message }
}

export async function handleLeads(request: Request, env: LeadsEnv): Promise<Response> {
  const url = new URL(request.url)
  const origin = request.headers.get('Origin') ?? (request.headers.get('Referer') ? new URL(request.headers.get('Referer')!).origin : '')
  const host = bareHost(origin)

  // Read the form (JSON, normal HTML form, or multipart).
  let fields: Record<string, string> = {}
  if (request.method === 'POST') {
    const type = request.headers.get('Content-Type') ?? ''
    if (type.includes('application/json')) {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
      fields = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v ?? '')]))
    } else {
      const form = await request.formData().catch(() => null)
      form?.forEach((v, k) => { if (typeof v === 'string') fields[k] = v })
    }
  }
  const key = url.searchParams.get('key') ?? fields.form_key ?? ''
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return plain(503, 'Website forms aren’t switched on yet.')
  if (!UUID.test(key)) return plain(400, 'This form isn’t set up correctly (missing form key).')

  // Which websites may use this key? Only those get the browser permission (CORS) headers.
  const lookup = await rpc<string[] | null>(env, 'lead_source_domains', { p_key: key })
  const domains = lookup.data ?? null
  if (!domains) return plain(404, 'This form isn’t connected to Work Hub (unknown form key).')
  const allowed = host !== '' && allowedBy(domains, host)
  const cors: Record<string, string> = allowed
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
    : {}

  if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: cors })
  if (request.method !== 'POST') return plain(405, 'Send the form with POST.')
  if (!allowed) return plain(403, `Forms from ${host || 'this page'} can’t send to this key.`)

  const wantsJson = (request.headers.get('Accept') ?? '').includes('application/json') || (request.headers.get('Content-Type') ?? '').includes('application/json')
  const done = (status: number, message: string) => {
    if (wantsJson) return new Response(JSON.stringify(status < 300 ? { ok: true, message } : { ok: false, error: message }), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
    // A plain HTML form: go back to the website's own thank-you page if it gave one, else show ours.
    const back = fields._redirect ?? ''
    if (status < 300 && back && allowedBy(domains, bareHost(back))) return Response.redirect(back, 303)
    return thankYou(status, message, origin)
  }

  // Spam trap: real people never see or fill the hidden "website" field.
  if ((fields.website ?? '').trim() !== '' || (fields._gotcha ?? '').trim() !== '') return done(200, 'Thanks! We’ll be in touch soon.')

  const name = (fields.name ?? [fields.first_name, fields.last_name].filter(Boolean).join(' ')).trim()
  const email = (fields.email ?? '').trim()
  const phone = (fields.phone ?? fields.tel ?? '').trim()
  if (!name) return done(400, 'Please add your name.')
  if (!email && !phone) return done(400, 'Please add your email address or phone number.')
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return done(400, 'Please check your email address.')

  const res = await rpc(env, 'intake_lead', {
    p_key: key, p_origin: origin, p_name: name, p_email: email, p_phone: phone,
    p_company: fields.company ?? '', p_message: fields.message ?? fields.comments ?? '',
    p_page: request.headers.get('Referer') ? new URL(request.headers.get('Referer')!).pathname : '',
  })
  if (!res.ok) {
    const m = res.message ?? ''
    if (m.includes('too_many')) return done(429, 'We’re receiving a lot of messages right now. Please try again in a few minutes.')
    if (m.includes('missing_details')) return done(400, 'Please add your name and an email address or phone number.')
    if (m.includes('wrong_website') || m.includes('unknown_form')) return done(403, 'This form isn’t connected to Work Hub.')
    return done(500, 'Something went wrong sending your message. Please try again, or email us directly.')
  }
  return done(200, 'Thanks! We’ve got your message and will be in touch soon.')
}

const plain = (status: number, text: string) => new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A small, neutral page for plain HTML forms without their own thank-you page. */
function thankYou(status: number, message: string, origin: string) {
  const ok = status < 300
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${ok ? 'Thank you' : 'Message not sent'}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F4F6FA;font-family:system-ui,sans-serif;color:#0B1733}
.c{background:#fff;border:1px solid #E3E8EF;border-radius:16px;padding:32px;max-width:420px;margin:16px;text-align:center}
h1{font-size:22px;margin:0 0 8px}p{color:#334155;line-height:1.5}a{display:inline-block;margin-top:12px;background:#D4AF6A;color:#0B1733;
padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:600}</style></head>
<body><div class="c"><h1>${ok ? 'Thank you!' : 'Your message wasn’t sent'}</h1><p>${esc(message)}</p>
${origin ? `<a href="${esc(origin)}">${ok ? 'Back to the website' : 'Go back'}</a>` : ''}</div></body></html>`
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
