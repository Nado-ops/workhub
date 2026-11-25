import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { timeAgo } from '../../lib/format'
import { CHANGE_STATUS, cmsApi, isEditable, pageName, type Site, type SiteChange, type SiteField } from '../../lib/cms'
import { textOnly } from '../../lib/richtext'
import FieldEditor from '../../components/cms/FieldEditor'
import Tabs from '../../components/Tabs'

/**
 * The client's own website: change text, photos and buttons, or ask the team for bigger changes.
 * If the site needs approval, edits wait for the team; otherwise they go live in a minute or two.
 */
export default function MyWebsite() {
  const { profile } = useAuth()
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState<string | null>(null)
  const [fields, setFields] = useState<SiteField[]>([])
  const [changes, setChanges] = useState<SiteChange[]>([])
  const [page, setPage] = useState('index.html')
  const [tab, setTab] = useState<'edit' | 'request' | 'history'>('edit')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    supabase.from('sites').select('*').order('name').then(({ data }) => {
      const list = (data as Site[] | null) ?? []
      setSites(list); setSiteId(list[0]?.id ?? null); setLoaded(true)
    })
  }, [])

  async function load(id = siteId) {
    if (!id) return
    const [f, c] = await Promise.all([
      supabase.from('site_fields').select('*').eq('site_id', id).order('page').order('position'),
      supabase.from('site_changes').select('*').eq('site_id', id).order('created_at', { ascending: false }).limit(50),
    ])
    setFields((f.data as SiteField[] | null) ?? [])
    setChanges((c.data as SiteChange[] | null) ?? [])
  }
  useEffect(() => { load() }, [siteId])

  const site = sites.find((s) => s.id === siteId) ?? null
  const pages = useMemo(() => [...new Set(fields.map((f) => f.page))].sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b))), [fields])
  useEffect(() => { if (pages.length && !pages.includes(page)) setPage(pages[0]) }, [pages, page])
  const waiting = new Set(changes.filter((c) => c.status === 'submitted' && c.kind === 'edit').map((c) => `${c.page}|${c.field_key}`))
  const canEdit = !!site && isEditable(site) && fields.length > 0

  async function save(field: SiteField, value: string) {
    if (!site || value === (field.value ?? '')) return
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.from('site_changes').insert({
      site_id: site.id, kind: 'edit', page: field.page, field_key: field.key, field_type: field.type,
      old_value: field.value, new_value: value, created_by: profile?.id,
    }).select('id').single()
    if (error) { setBusy(false); return setMsg({ ok: false, text: error.message }) }
    if (site.requires_approval) {
      setMsg({ ok: true, text: 'Sent to the team. You’ll get an email when it’s live.' })
    } else {
      try {
        await cmsApi('publish', { change_ids: [(data as { id: string }).id] })
        setMsg({ ok: true, text: 'Saved! Your website updates in a minute or two.' })
      } catch (e) {
        setMsg({ ok: false, text: `Couldn’t publish: ${e instanceof Error ? e.message : ''} The team has been told.` })
      }
    }
    setBusy(false)
    load()
  }

  async function withdraw(c: SiteChange) {
    await supabase.from('site_changes').delete().eq('id', c.id)
    load()
  }

  if (!loaded) return <p className="pt-4 text-sm text-muted">Loading…</p>
  if (!site) {
    return (
      <div className="card mt-2 p-6">
        <h1 className="text-2xl font-semibold">My website</h1>
        <p className="mt-2 text-sm text-muted">Your website isn’t connected to Work Hub yet. Ask us and we’ll set it up, then you can update it here.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <h1 className="text-2xl font-semibold">My website</h1>
          <p className="mt-1 text-sm text-muted">
            {site.requires_approval ? 'Change your text and photos here. We check each change before it goes live.' : 'Change your text and photos here. Changes go live in a minute or two.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {sites.length > 1 && (
            <select className="input h-10 w-auto" aria-label="Website" value={site.id} onChange={(e) => setSiteId(e.target.value)}>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {site.url && <a href={site.url} target="_blank" rel="noopener" className="btn-ghost no-underline">View website ↗</a>}
        </div>
      </div>

      {msg && <p className={`rounded-xl px-4 py-3 text-sm ${msg.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`} role="status">{msg.text}</p>}

      <section className="card overflow-hidden">
        <Tabs
          tabs={[
            ...(canEdit ? [{ key: 'edit' as const, label: 'Edit pages' }] : []),
            { key: 'request', label: 'Request a change' },
            { key: 'history', label: 'History', count: changes.filter((c) => c.status === 'submitted').length || undefined },
          ]}
          value={canEdit ? tab : tab === 'edit' ? 'request' : tab}
          onChange={setTab}
        />
        <div className="p-5">
          {canEdit && tab === 'edit' && (
            <div className="flex flex-col gap-4">
              {pages.length > 1 && (
                <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Pages">
                  {pages.map((p) => (
                    <button key={p} role="tab" aria-selected={p === page} onClick={() => setPage(p)}
                      className={`h-9 cursor-pointer rounded-lg border px-3 text-sm ${p === page ? 'border-accent bg-accent-soft font-semibold' : 'border-line hover:bg-hover'}`}>{pageName(p)}</button>
                  ))}
                </div>
              )}
              {fields.filter((f) => f.page === page).map((f) => (
                <FieldEditor key={f.id} site={site} field={f} busy={busy} pending={waiting.has(`${f.page}|${f.key}`)} onSave={(v) => save(f, v)} />
              ))}
              <p className="text-xs text-muted">Need something bigger, like a new page or a new section? Use <button className="text-accent-text underline" onClick={() => setTab('request')}>Request a change</button>.</p>
            </div>
          )}
          {(tab === 'request' || (!canEdit && tab === 'edit')) && <RequestForm site={site} onSent={() => { setMsg({ ok: true, text: 'Request sent. We’ll let you know when it’s done.' }); setTab('history'); load() }} />}
          {tab === 'history' && <History changes={changes} onWithdraw={withdraw} myId={profile?.id} />}
        </div>
      </section>
    </div>
  )
}

/** "Please change…" in words, with photos if needed. */
function RequestForm({ site, onSent }: { site: Site; onSent: () => void }) {
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const paths: string[] = []
    for (const f of files) {
      const path = `${site.id}/request-${crypto.randomUUID().slice(0, 8)}-${f.name.replace(/[^\w.-]+/g, '-')}`
      const { error } = await supabase.storage.from('site-images').upload(path, f, { contentType: f.type })
      if (error) { setBusy(false); return setError(error.message) }
      paths.push(path)
    }
    const { error } = await supabase.from('site_changes').insert({ site_id: site.id, kind: 'request', note: note.trim(), images: paths })
    setBusy(false)
    if (error) return setError(error.message)
    setNote(''); setFiles([])
    onSent()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="label">What would you like changed?
        <textarea className="input h-32 py-2" required value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Please add Dr Naidoo to the Team page. Photo attached. Her title is Orthodontist." />
      </label>
      <label className="label">Photos (optional)
        <input type="file" multiple accept="image/*" className="input pt-2.5" onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 6))} />
      </label>
      {files.length > 0 && <p className="text-xs text-muted">{files.length} photo{files.length === 1 ? '' : 's'} attached</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      <button className="btn-primary w-fit" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
    </form>
  )
}

function History({ changes, onWithdraw, myId }: { changes: SiteChange[]; onWithdraw: (c: SiteChange) => void; myId?: string }) {
  if (changes.length === 0) return <p className="text-sm text-muted">No changes yet.</p>
  return (
    <ul className="flex flex-col">
      {changes.map((c) => (
        <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 border-t border-line py-3 first:border-t-0">
          <div className="min-w-0 flex-[1_1_260px]">
            <p className="text-sm font-medium">
              {c.kind === 'request' ? 'Request: ' : `${pageName(c.page ?? '')} · ${c.field_key}: `}
              <span className="font-normal text-soft">{summary(c)}</span>
            </p>
            <p className="text-xs text-muted">{timeAgo(c.created_at)}{c.review_note ? ` · ${c.review_note}` : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`pill ${CHANGE_STATUS[c.status].tone}`}>{CHANGE_STATUS[c.status].text}</span>
            {c.status === 'submitted' && c.created_by === myId && <button className="text-xs text-muted hover:text-danger" onClick={() => onWithdraw(c)}>Withdraw</button>}
          </div>
        </li>
      ))}
    </ul>
  )
}

/** One line describing what changed. */
export function summary(c: SiteChange) {
  if (c.kind === 'request') return (c.note ?? '').slice(0, 140) + (c.images.length ? ` (${c.images.length} photo${c.images.length === 1 ? '' : 's'})` : '')
  if (c.field_type === 'image') return 'New photo'
  if (c.field_type === 'link') { try { return `Button “${(JSON.parse(c.new_value ?? '{}') as { text: string }).text}”` } catch { return 'Button' } }
  const t = c.field_type === 'richtext' ? textOnly(c.new_value ?? '') : c.new_value ?? ''
  return `“${t.slice(0, 100)}${t.length > 100 ? '…' : ''}”`
}
