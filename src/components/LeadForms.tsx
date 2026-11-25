import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useTeam, personName } from '../lib/team'

interface LeadSource { id: string; name: string; domains: string[]; form_key: string; default_owner: string | null; active: boolean; created_at: string }

/**
 * Admin: which websites may send leads into the pipeline (migration 014), and the form code to paste
 * into each website. Submissions go to /api/leads on this Work Hub (worker/leads.ts).
 */
export default function LeadForms({ onClose }: { onClose: () => void }) {
  const team = useTeam()
  const [sources, setSources] = useState<LeadSource[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [editing, setEditing] = useState<LeadSource | 'new' | null>(null)
  const [showCode, setShowCode] = useState<string | null>(null)

  async function load() {
    const [s, d] = await Promise.all([
      supabase.from('lead_sources').select('*').order('name'),
      supabase.from('deals').select('lead_source_id').not('lead_source_id', 'is', null),
    ])
    setSources((s.data as LeadSource[] | null) ?? [])
    const c: Record<string, number> = {}
    for (const r of (d.data as { lead_source_id: string }[] | null) ?? []) c[r.lead_source_id] = (c[r.lead_source_id] ?? 0) + 1
    setCounts(c)
  }
  useEffect(() => { load() }, [])

  async function toggle(s: LeadSource) {
    await supabase.from('lead_sources').update({ active: !s.active }).eq('id', s.id)
    load()
  }

  return (
    <section className="card p-5" aria-label="Website forms">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Website forms</h2>
          <p className="text-sm text-muted">Enquiries from these websites’ contact forms arrive in the pipeline as new leads.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-primary h-9" onClick={() => setEditing('new')}>+ Add a website</button>
          <button className="btn-ghost h-9" onClick={onClose}>Close</button>
        </div>
      </div>

      {editing && <SourceForm key={editing === 'new' ? 'new' : editing.id} source={editing === 'new' ? null : editing} team={team}
        onDone={(id) => { setEditing(null); load(); if (id) setShowCode(id) }} />}

      {sources.length === 0 && !editing && <p className="mt-4 text-sm text-muted">No websites yet. Add your first one, e.g. nanotechnology6.co.za.</p>}
      <ul className="mt-4 flex flex-col gap-2">
        {sources.map((s) => (
          <li key={s.id} className={`rounded-xl border border-line p-4 ${s.active ? '' : 'opacity-60'}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{s.name} {!s.active && <span className="pill ml-1 bg-raised text-muted">Paused</span>}</p>
                <p className="text-xs text-muted">
                  {s.domains.join(', ')} · leads go to {s.default_owner ? personName(team.find((m) => m.id === s.default_owner)) : 'all admins'} · {counts[s.id] ?? 0} {(counts[s.id] ?? 0) === 1 ? 'lead' : 'leads'} so far
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <button className="btn-ghost h-8 px-3 text-xs" onClick={() => setShowCode(showCode === s.id ? null : s.id)}>{showCode === s.id ? 'Hide code' : 'Get form code'}</button>
                <button className="btn-ghost h-8 px-3 text-xs" onClick={() => setEditing(s)}>Edit</button>
                <button className="btn-ghost h-8 px-3 text-xs" onClick={() => toggle(s)}>{s.active ? 'Pause' : 'Turn on'}</button>
              </div>
            </div>
            {showCode === s.id && <FormCode source={s} />}
          </li>
        ))}
      </ul>
    </section>
  )
}

function SourceForm({ source, team, onDone }: { source: LeadSource | null; team: ReturnType<typeof useTeam>; onDone: (id: string | null) => void }) {
  const [name, setName] = useState(source?.name ?? '')
  const [domains, setDomains] = useState(source?.domains.join(', ') ?? '')
  const [owner, setOwner] = useState(source?.default_owner ?? '')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    // "https://www.Example.co.za/contact, example.com" → ["example.co.za", "example.com"]
    const list = [...new Set(domains.split(/[\s,]+/).map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')).filter(Boolean))]
    if (list.length === 0) return setError('Add at least one website address.')
    if (list.some((d) => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) && d !== 'localhost')) return setError('Website addresses look like nanotechnology6.co.za')
    const row = { name: name.trim() || list[0], domains: list, default_owner: owner || null }
    const res = source
      ? await supabase.from('lead_sources').update(row).eq('id', source.id).select('id').single()
      : await supabase.from('lead_sources').insert(row).select('id').single()
    if (res.error) return setError(res.error.message)
    onDone(source ? null : (res.data as { id: string }).id)
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-3 rounded-xl bg-raised p-4">
      <label className="label flex-[2_1_220px]">Website address(es)
        <input className="input" required value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="nanotechnology6.co.za" />
      </label>
      <label className="label flex-[1_1_180px]">Name (optional)<input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Same as the address" /></label>
      <label className="label flex-[1_1_180px]">New leads go to
        <select className="input" value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">All admins</option>
          {team.map((m) => <option key={m.id} value={m.id}>{personName(m)}</option>)}
        </select>
      </label>
      <button className="btn-primary">{source ? 'Save' : 'Add website'}</button>
      <button type="button" className="btn-ghost" onClick={() => onDone(null)}>Cancel</button>
      <p className="basis-full text-xs text-muted">This covers subdomains too (www.…, shop.…). Separate several addresses with commas.</p>
      {error && <p className="basis-full text-sm text-danger">{error}</p>}
    </form>
  )
}

/** The code to paste into the website: a plain HTML form (works without JavaScript). */
function FormCode({ source }: { source: LeadSource }) {
  const [copied, setCopied] = useState(false)
  const action = `${window.location.origin}/api/leads?key=${source.form_key}`
  const code = `<!-- Work Hub contact form for ${source.name} -->
<form action="${action}" method="POST">
  <label>Name <input name="name" required></label>
  <label>Email <input name="email" type="email" required></label>
  <label>Phone <input name="phone" type="tel"></label>
  <label>Company <input name="company"></label>
  <label>Message <textarea name="message" rows="5"></textarea></label>
  <!-- Spam trap: keep this hidden and empty -->
  <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
  <!-- Optional: your own thank-you page on the same website -->
  <!-- <input type="hidden" name="_redirect" value="https://${source.domains[0]}/thank-you.html"> -->
  <button type="submit">Send</button>
</form>`

  async function copy() {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <p className="text-sm text-soft">Paste this where the contact form should be (or ask your AI builder to “use this form and style it to match the site”). The field names must stay the same.</p>
      <pre className="overflow-x-auto rounded-xl bg-raised p-3 text-xs leading-5"><code>{code}</code></pre>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary h-9" onClick={copy}>{copied ? 'Copied ✓' : 'Copy code'}</button>
        <span className="text-xs text-muted">Already have a form? Point its <code>action</code> at <code className="break-all">{action}</code> and name the fields name, email, phone, company, message.</span>
      </div>
    </div>
  )
}
