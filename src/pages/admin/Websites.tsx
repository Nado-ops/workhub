import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { timeAgo } from '../../lib/format'
import { CHANGE_STATUS, cmsApi, pageName, uploadPreview, type Site, type SiteChange, type SiteField } from '../../lib/cms'
import FieldEditor, { ValueView } from '../../components/cms/FieldEditor'
import { summary } from '../client/MyWebsite'
import Tabs from '../../components/Tabs'

/**
 * The team's side of the website CMS: connect client websites, mark the editable parts,
 * edit pages, and approve or reject what clients send.
 */
export default function Websites() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [sites, setSites] = useState<Site[]>([])
  const [pendingBySite, setPendingBySite] = useState<Record<string, number>>({})
  const [selected, setSelected] = useState<string | 'new' | null>(null)
  const [github, setGithub] = useState<boolean | null>(null)

  async function load() {
    const [s, p] = await Promise.all([
      supabase.from('sites').select('*, client:clients(name)').order('name'),
      supabase.from('site_changes').select('site_id').in('status', ['submitted', 'failed']),
    ])
    const list = (s.data as Site[] | null) ?? []
    setSites(list)
    const counts: Record<string, number> = {}
    for (const r of (p.data as { site_id: string }[] | null) ?? []) counts[r.site_id] = (counts[r.site_id] ?? 0) + 1
    setPendingBySite(counts)
    setSelected((cur) => cur ?? list[0]?.id ?? null)
  }
  useEffect(() => {
    load()
    cmsApi<{ github_connected: boolean }>('status').then((s) => setGithub(s.github_connected)).catch(() => setGithub(false))
  }, [])

  const site = sites.find((s) => s.id === selected) ?? null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <h1 className="text-2xl font-semibold">Websites</h1>
          <p className="mt-1 text-sm text-muted">Client websites they can update from their portal. Changes are saved to GitHub and Cloudflare publishes them.</p>
        </div>
        {isAdmin && <button className="btn-primary" onClick={() => setSelected('new')}>+ Connect a website</button>}
      </div>

      {github === false && (
        <div className="card border-warn/30 bg-warn-soft p-4 text-sm">
          <p className="font-semibold text-warn">GitHub isn’t connected yet</p>
          <p className="mt-1 text-soft">You can add websites and take change requests now. To publish edits, add the GitHub token in Cloudflare (see README → Website CMS).</p>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-4">
        <aside className="flex w-full flex-col gap-2 lg:w-72">
          {sites.length === 0 && <p className="card p-4 text-sm text-muted">No websites yet.</p>}
          {sites.map((s) => (
            <button key={s.id} onClick={() => setSelected(s.id)}
              className={`card cursor-pointer p-4 text-left ${selected === s.id ? 'border-accent shadow-[inset_3px_0_0_var(--color-accent)]' : 'hover:bg-hover'}`}>
              <span className="flex items-start justify-between gap-2">
                <span className="font-semibold">{s.name}</span>
                {pendingBySite[s.id] ? <span className="pill bg-warn-soft text-warn">{pendingBySite[s.id]} new</span> : null}
              </span>
              <span className="block text-xs text-muted">{s.client?.name} · {s.kind === 'github' ? 'GitHub + Cloudflare' : s.kind === 'wordpress' ? 'WordPress (requests)' : 'Requests only'}</span>
            </button>
          ))}
        </aside>

        <div className="min-w-0 flex-[1_1_560px]">
          {selected === 'new' && <SiteForm site={null} onDone={(id) => { load(); setSelected(id) }} />}
          {site && <SitePanel key={site.id} site={site} isAdmin={isAdmin} github={github === true} onChange={load} />}
        </div>
      </div>
    </div>
  )
}

function SitePanel({ site, isAdmin, github, onChange }: { site: Site; isAdmin: boolean; github: boolean; onChange: () => void }) {
  const [tab, setTab] = useState<'inbox' | 'pages' | 'history' | 'settings'>('inbox')
  const [fields, setFields] = useState<SiteField[]>([])
  const [changes, setChanges] = useState<SiteChange[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function load() {
    const [f, c] = await Promise.all([
      supabase.from('site_fields').select('*').eq('site_id', site.id).order('page').order('position'),
      supabase.from('site_changes').select('*, author:profiles!site_changes_created_by_fkey(full_name, role)').eq('site_id', site.id).order('created_at', { ascending: false }).limit(100),
    ])
    setFields((f.data as SiteField[] | null) ?? [])
    setChanges((c.data as SiteChange[] | null) ?? [])
  }
  useEffect(() => { load() }, [site.id])

  // Run a server action and show the result.
  async function run(label: string, fn: () => Promise<string>) {
    setBusy(true); setMsg(null)
    try { setMsg({ ok: true, text: await fn() }) } catch (e) { setMsg({ ok: false, text: `${label}: ${e instanceof Error ? e.message : 'failed'}` }) }
    setBusy(false)
    load(); onChange()
  }
  const scan = () => run('Scan', async () => {
    const r = await cmsApi<{ pages: number; fields: number; removed: number }>('scan', { site_id: site.id })
    return `Found ${r.fields} editable parts on ${r.pages} page${r.pages === 1 ? '' : 's'}${r.removed ? ` (${r.removed} removed)` : ''}.`
  })
  const publish = (ids: string[]) => run('Publish', async () => {
    const r = await cmsApi<{ published: number }>('publish', { change_ids: ids })
    return `Published ${r.published} change${r.published === 1 ? '' : 's'}. The website updates in a minute or two.`
  })

  const inbox = changes.filter((c) => c.status === 'submitted' || c.status === 'failed')
  const isGit = site.kind === 'github'

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{site.name}</h2>
          <p className="text-sm text-muted">
            {site.client?.name}
            {site.url && <> · <a href={site.url} target="_blank" rel="noopener" className="text-accent-text">{site.url.replace(/^https?:\/\//, '')} ↗</a></>}
            {isGit && <> · {site.repo} ({site.branch}{site.folder ? `, /${site.folder}` : ''})</>}
          </p>
          <p className="text-xs text-muted">
            {site.requires_approval ? 'Client edits wait for approval' : 'Client edits go live straight away'}
            {site.last_scanned_at ? ` · scanned ${timeAgo(site.last_scanned_at)}` : ''}
          </p>
        </div>
        {isGit && <button className="btn-ghost h-9" onClick={scan} disabled={busy || !github}>{busy ? 'Working…' : 'Scan website'}</button>}
      </div>
      {msg && <p className={`mx-5 mb-3 rounded-xl px-4 py-2.5 text-sm ${msg.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`} role="status">{msg.text}</p>}

      <Tabs
        tabs={[
          { key: 'inbox', label: 'Inbox', count: inbox.length },
          ...(isGit ? [{ key: 'pages' as const, label: 'Pages' }] : []),
          { key: 'history', label: 'History' },
          ...(isAdmin ? [{ key: 'settings' as const, label: 'Settings' }] : []),
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="p-5">
        {tab === 'inbox' && <Inbox site={site} labels={Object.fromEntries(fields.map((f) => [`${f.page}|${f.key}`, f.label ?? f.key]))} changes={inbox} busy={busy} canPublish={github} onPublish={publish} onChange={() => { load(); onChange() }} />}
        {tab === 'pages' && <Pages site={site} fields={fields} isAdmin={isAdmin} busy={busy} github={github} onRun={run} onPublish={publish} onReload={load} />}
        {tab === 'history' && <HistoryList changes={changes} />}
        {tab === 'settings' && <SiteForm site={site} onDone={() => onChange()} />}
      </div>
    </section>
  )
}

/** Client edits and requests waiting for the team. */
function Inbox({ site, labels, changes, busy, canPublish, onPublish, onChange }: {
  site: Site; labels: Record<string, string>; changes: SiteChange[]; busy: boolean; canPublish: boolean; onPublish: (ids: string[]) => void; onChange: () => void
}) {
  const edits = changes.filter((c) => c.kind === 'edit')
  const requests = changes.filter((c) => c.kind === 'request')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  useEffect(() => setPicked(new Set(edits.map((c) => c.id))), [changes.length])

  async function decide(c: SiteChange, status: 'rejected' | 'done') {
    const note = status === 'rejected' ? window.prompt('Why not? (the client sees this)', '') : null
    if (status === 'rejected' && note === null) return
    await supabase.from('site_changes').update({ status, review_note: note || null, reviewed_at: new Date().toISOString() }).eq('id', c.id)
    onChange()
  }

  if (changes.length === 0) return <p className="text-sm text-muted">All caught up — nothing waiting.</p>
  return (
    <div className="flex flex-col gap-5">
      {edits.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Edits to approve</h3>
            <button className="btn-primary h-9" disabled={busy || picked.size === 0 || !canPublish} onClick={() => onPublish([...picked])}>
              Approve &amp; publish {picked.size || ''}
            </button>
          </div>
          {edits.map((c) => (
            <article key={c.id} className="rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" className="h-4 w-4 accent-[#B8893A]" checked={picked.has(c.id)}
                    onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n })} />
                  {pageName(c.page ?? '')} · {labels[`${c.page}|${c.field_key}`] ?? c.field_key}
                </label>
                <span className="text-xs text-muted">{c.author?.full_name ?? 'Client'} · {timeAgo(c.created_at)}</span>
              </div>
              {c.status === 'failed' && <p className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">Didn’t publish: {c.review_note}</p>}
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div><p className="mb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">Now</p><ValueView site={site} type={c.field_type!} value={c.old_value} /></div>
                <div><p className="mb-1 text-[11px] font-semibold tracking-wider text-success uppercase">New</p><ValueView site={site} type={c.field_type!} value={c.new_value} /></div>
              </div>
              <button className="mt-3 text-xs text-muted hover:text-danger" onClick={() => decide(c, 'rejected')}>Don’t publish…</button>
            </article>
          ))}
        </div>
      )}
      {requests.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold">Change requests</h3>
          {requests.map((c) => <RequestCard key={c.id} change={c} onDone={() => decide(c, 'done')} onReject={() => decide(c, 'rejected')} />)}
        </div>
      )}
    </div>
  )
}

function RequestCard({ change: c, onDone, onReject }: { change: SiteChange; onDone: () => void; onReject: () => void }) {
  const [photos, setPhotos] = useState<string[]>([])
  useEffect(() => { Promise.all(c.images.map(uploadPreview)).then(setPhotos) }, [c.images])
  const { profile } = useAuth()

  async function makeTask() {
    const { error } = await supabase.from('tasks').insert({ title: `Website: ${(c.note ?? '').slice(0, 80)}`, description: c.note, assignee_id: profile?.id })
    window.alert(error ? error.message : 'Added to your tasks.')
  }

  return (
    <article className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted"><span>{c.author?.full_name ?? 'Client'}</span><span>{timeAgo(c.created_at)}</span></div>
      <p className="mt-2 text-sm whitespace-pre-wrap">{c.note}</p>
      {photos.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {photos.map((src, i) => <a key={i} href={src} target="_blank" rel="noopener"><img src={src} alt={`Attached photo ${i + 1}`} className="h-20 w-28 rounded-lg border border-line object-cover" /></a>)}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn-primary h-9" onClick={onDone}>Mark done</button>
        <button className="btn-ghost h-9" onClick={makeTask}>Add to my tasks</button>
        <button className="btn-ghost h-9 text-muted" onClick={onReject}>Decline…</button>
      </div>
    </article>
  )
}

/** The editable parts of each page. The team's edits publish straight away. */
function Pages({ site, fields, isAdmin, busy, github, onRun, onPublish, onReload }: {
  site: Site; fields: SiteField[]; isAdmin: boolean; busy: boolean; github: boolean
  onRun: (label: string, fn: () => Promise<string>) => void; onPublish: (ids: string[]) => void; onReload: () => void
}) {
  const pages = useMemo(() => [...new Set(fields.map((f) => f.page))], [fields])
  const [page, setPage] = useState('index.html')
  const [markPage, setMarkPage] = useState('index.html')
  useEffect(() => { if (pages.length && !pages.includes(page)) setPage(pages[0]) }, [pages, page])

  async function save(f: SiteField, value: string) {
    if (value === (f.value ?? '')) return
    const { data, error } = await supabase.from('site_changes')
      .insert({ site_id: site.id, kind: 'edit', page: f.page, field_key: f.key, field_type: f.type, old_value: f.value, new_value: value })
      .select('id').single()
    if (error) return window.alert(error.message)
    onPublish([(data as { id: string }).id])
  }
  async function rename(f: SiteField) {
    const label = window.prompt('What should the client see this called?', f.label ?? '')
    if (!label) return
    await supabase.from('site_fields').update({ label: label.trim() }).eq('id', f.id)
    onReload()
  }
  const automark = () => {
    if (!window.confirm(`Mark the headings, text, photos and buttons on ${markPage} as editable? This saves a small change to the website's code.`)) return
    onRun('Auto-mark', async () => {
      const r = await cmsApi<{ added: number; fields: number }>('automark', { site_id: site.id, page: markPage })
      return r.added ? `Marked ${r.added} new parts. ${markPage} now has ${r.fields} editable parts.` : `Nothing new to mark on ${markPage}.`
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {isAdmin && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl bg-raised p-3">
          <label className="label flex-[1_1_200px]">Make a page editable (file in the website folder)
            <input className="input" value={markPage} onChange={(e) => setMarkPage(e.target.value)} placeholder="index.html or about/index.html" />
          </label>
          <button className="btn-ghost" onClick={automark} disabled={busy || !github}>Auto-mark page</button>
          <p className="basis-full text-xs text-muted">Finds headings, paragraphs, photos and buttons (not menus or forms) and adds <code>data-cms</code> markers. You can also add <code>data-cms="name"</code> to any element yourself, then press Scan website.</p>
        </div>
      )}
      {pages.length === 0 && <p className="text-sm text-muted">No editable parts yet. Auto-mark a page or press Scan website.</p>}
      {pages.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Pages">
          {pages.map((p) => (
            <button key={p} role="tab" aria-selected={p === page} onClick={() => setPage(p)}
              className={`h-9 cursor-pointer rounded-lg border px-3 text-sm ${p === page ? 'border-accent bg-accent-soft font-semibold' : 'border-line hover:bg-hover'}`}>{pageName(p)}</button>
          ))}
        </div>
      )}
      {fields.filter((f) => f.page === page).map((f) => (
        <div key={f.id} className="relative">
          <FieldEditor site={site} field={f} busy={busy || !github} onSave={(v) => save(f, v)} />
          <button className="absolute top-3.5 right-28 text-xs text-muted hover:text-text" onClick={() => rename(f)} title="Rename for the client">Rename</button>
        </div>
      ))}
    </div>
  )
}

function HistoryList({ changes }: { changes: SiteChange[] }) {
  if (changes.length === 0) return <p className="text-sm text-muted">No changes yet.</p>
  return (
    <ul>
      {changes.map((c) => (
        <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 border-t border-line py-3 first:border-t-0">
          <div className="min-w-0 flex-[1_1_260px]">
            <p className="text-sm"><b>{c.author?.full_name ?? 'Someone'}</b> · {c.kind === 'request' ? 'request' : `${pageName(c.page ?? '')} / ${c.field_key}`}</p>
            <p className="text-xs text-soft">{summary(c)}</p>
            <p className="text-xs text-muted">{timeAgo(c.created_at)}{c.commit_sha ? ` · commit ${c.commit_sha.slice(0, 7)}` : ''}{c.review_note ? ` · ${c.review_note}` : ''}</p>
          </div>
          <span className={`pill ${CHANGE_STATUS[c.status].tone}`}>{CHANGE_STATUS[c.status].text}</span>
        </li>
      ))}
    </ul>
  )
}

/** Connect a website / change its settings (admin). */
function SiteForm({ site, onDone }: { site: Site | null; onDone: (id: string) => void }) {
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [f, setF] = useState({
    client_id: site?.client_id ?? '', name: site?.name ?? '', url: site?.url ?? '', kind: site?.kind ?? 'github',
    repo: site?.repo ?? '', branch: site?.branch ?? 'main', folder: site?.folder ?? 'public', requires_approval: site?.requires_approval ?? true,
  })
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => { supabase.from('clients').select('id, name').order('name').then(({ data }) => setClients(data ?? [])) }, [])
  const set = (k: keyof typeof f, v: string | boolean) => { setF((x) => ({ ...x, [k]: v })); setSaved(false) }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const repo = f.repo.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').replace(/\/$/, '')
    const row = { ...f, name: f.name.trim(), url: f.url.trim() || null, repo: f.kind === 'github' ? repo : null, folder: f.folder.trim().replace(/^\/|\/$/g, ''), branch: f.branch.trim() || 'main' }
    const res = site
      ? await supabase.from('sites').update(row).eq('id', site.id).select('id').single()
      : await supabase.from('sites').insert(row).select('id').single()
    if (res.error) return setError(res.error.message.includes('sites_check') ? 'The GitHub repo should look like owner/name, e.g. Nado-ops/harbour-dental.' : res.error.message)
    setError(null); setSaved(true)
    onDone((res.data as { id: string }).id)
  }
  async function remove() {
    if (!site || !window.confirm(`Disconnect ${site.name}? The website itself isn't touched; its CMS history in Work Hub is deleted.`)) return
    await supabase.from('sites').delete().eq('id', site.id)
    window.location.reload()
  }

  return (
    <form onSubmit={submit} className={`flex flex-wrap items-end gap-3 ${site ? '' : 'card p-5'}`}>
      {!site && <h2 className="basis-full text-lg font-semibold">Connect a website</h2>}
      <label className="label flex-[1_1_200px]">Client
        <select className="input" required value={f.client_id} onChange={(e) => set('client_id', e.target.value)}>
          <option value="" disabled>Choose…</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="label flex-[2_1_220px]">Name<input className="input" required value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Harbour Dental website" /></label>
      <label className="label flex-[2_1_240px]">Live address<input className="input" type="url" value={f.url} onChange={(e) => set('url', e.target.value)} placeholder="https://harbourdental.co.za" /></label>
      <label className="label flex-[1_1_200px]">Built with
        <select className="input" value={f.kind} onChange={(e) => set('kind', e.target.value)}>
          <option value="github">HTML on GitHub + Cloudflare</option>
          <option value="wordpress">WordPress (requests for now)</option>
          <option value="other">Something else (requests only)</option>
        </select>
      </label>
      {f.kind === 'github' && <>
        <label className="label flex-[2_1_220px]">GitHub repo<input className="input" required value={f.repo} onChange={(e) => set('repo', e.target.value)} placeholder="Nado-ops/harbour-dental" /></label>
        <label className="label flex-[1_1_120px]">Branch<input className="input" value={f.branch} onChange={(e) => set('branch', e.target.value)} /></label>
        <label className="label flex-[1_1_140px]">Folder with the HTML<input className="input" value={f.folder} onChange={(e) => set('folder', e.target.value)} placeholder="public (empty = top level)" /></label>
      </>}
      <label className="flex basis-full items-center gap-2 text-sm text-soft">
        <input type="checkbox" className="h-4 w-4 accent-[#B8893A]" checked={f.requires_approval} onChange={(e) => set('requires_approval', e.target.checked)} />
        I review client edits before they go live (recommended)
      </label>
      <button className="btn-primary">{site ? 'Save settings' : 'Connect website'}</button>
      {site && <button type="button" className="btn-ghost text-danger" onClick={remove}>Disconnect</button>}
      {saved && <span className="text-sm text-success">Saved</span>}
      {error && <p className="basis-full text-sm text-danger">{error}</p>}
      {!site && f.kind === 'github' && <p className="basis-full text-xs text-muted">Next: press Scan website, then Auto-mark the pages the client should be able to edit.</p>}
    </form>
  )
}
