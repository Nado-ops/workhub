// The Work Hub server. It does two things:
//   1. Serves the app (everything in ./dist) — the same as before.
//   2. Handles /api/cms/* for the website CMS: reading client websites from GitHub,
//      marking editable parts, and publishing changes back to GitHub (Cloudflare then rebuilds the site).
//
// Security: every /api call must carry the person's Work Hub login. We ask Supabase who they are and
// read/write the database AS THAT PERSON, so all the normal database rules still apply.
// The only secret here is GITHUB_TOKEN, stored in Cloudflare — never in the code or the browser.
import { GitHub, repoPath } from './github'
import { applyEdits, autoMark, scanFields, KEY_PATTERN, type Edit, type FieldType } from './html'

export interface Env {
  ASSETS: Fetcher
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  GITHUB_TOKEN?: string
  GITHUB_API?: string // only for testing
}

interface Site { id: string; client_id: string; name: string; kind: string; repo: string | null; branch: string; folder: string; requires_approval: boolean }
interface Change {
  id: string; site_id: string; kind: string; page: string | null; field_key: string | null
  field_type: FieldType | null; new_value: string | null; status: string; created_by: string | null; created_at: string
}
interface Me { id: string; role: 'admin' | 'staff' | 'client'; client_id: string | null; full_name: string | null }

class HttpError extends Error { constructor(public status: number, message: string) { super(message) } }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)
    try {
      if (request.method !== 'POST' && url.pathname !== '/api/cms/status') throw new HttpError(405, 'Use POST')
      const db = await Db.forRequest(request, env)
      const body = request.method === 'POST' ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {}
      switch (url.pathname) {
        case '/api/cms/status': return json(await status(db, env))
        case '/api/cms/scan': return json(await scan(db, env, String(body.site_id ?? '')))
        case '/api/cms/automark': return json(await automark(db, env, String(body.site_id ?? ''), String(body.page ?? '')))
        case '/api/cms/publish': return json(await publish(db, env, (body.change_ids as string[] | undefined) ?? []))
        default: throw new HttpError(404, 'Not found')
      }
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500
      return json({ error: e instanceof Error ? e.message : 'Something went wrong' }, status)
    }
  },
} satisfies ExportedHandler<Env>

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

// ---------------------------------------------------------------------------
// Database access as the logged-in person (Supabase REST API + their login token)
// ---------------------------------------------------------------------------
class Db {
  private constructor(private env: Env, private token: string, public me: Me) {}

  static async forRequest(request: Request, env: Env) {
    const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!token) throw new HttpError(401, 'Please log in again.')
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new HttpError(401, 'Your login has expired. Please log in again.')
    const user = (await res.json()) as { id: string }
    const db = new Db(env, token, { id: user.id, role: 'client', client_id: null, full_name: null })
    const [me] = await db.get<Me>(`profiles?id=eq.${user.id}&select=id,role,client_id,full_name`)
    if (!me) throw new HttpError(403, 'No Work Hub profile for this login.')
    db.me = me
    return db
  }

  get isStaff() { return this.me.role === 'admin' || this.me.role === 'staff' }

  private async call(path: string, init: RequestInit = {}) {
    const res = await fetch(`${this.env.SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: this.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })
    if (!res.ok) throw new HttpError(res.status === 401 ? 401 : 400, `Database: ${(await res.text()).slice(0, 300)}`)
    return res
  }
  async get<T>(path: string): Promise<T[]> { return (await this.call(path)).json() as Promise<T[]> }
  async post(path: string, rows: unknown, prefer = 'return=minimal') { await this.call(path, { method: 'POST', body: JSON.stringify(rows), headers: { Prefer: prefer } }) }
  async patch(path: string, values: unknown) { await this.call(path, { method: 'PATCH', body: JSON.stringify(values), headers: { Prefer: 'return=minimal' } }) }
  async del(path: string) { await this.call(path, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }) }
  async rpc(fn: string, args: unknown) { await this.call(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) }) }

  /** Download a file from Storage (the database rules decide whether this person may). */
  async download(bucket: string, path: string): Promise<Uint8Array> {
    const res = await fetch(`${this.env.SUPABASE_URL}/storage/v1/object/authenticated/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`,
      { headers: { apikey: this.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${this.token}` } })
    if (!res.ok) throw new HttpError(400, `Couldn’t read the uploaded photo (${res.status}).`)
    return new Uint8Array(await res.arrayBuffer())
  }

  async site(id: string): Promise<Site> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Which website?')
    const [site] = await this.get<Site>(`sites?id=eq.${id}&select=*`)
    if (!site) throw new HttpError(404, 'Website not found.')
    return site
  }
}

function githubFor(site: Site, env: Env) {
  if (site.kind !== 'github' || !site.repo) throw new HttpError(400, 'This website isn’t connected to GitHub, so changes come in as requests.')
  return new GitHub(env, site.repo, site.branch)
}

// ---------------------------------------------------------------------------
// /api/cms/status — is everything set up? (shown on the Websites page)
// ---------------------------------------------------------------------------
async function status(db: Db, env: Env) {
  return { github_connected: Boolean(env.GITHUB_TOKEN), role: db.me.role }
}

// ---------------------------------------------------------------------------
// /api/cms/scan — read every page and save its editable fields (team only)
// ---------------------------------------------------------------------------
async function scan(db: Db, env: Env, siteId: string, onlyPage?: string) {
  if (!db.isStaff) throw new HttpError(403, 'Only the team can scan websites.')
  const site = await db.site(siteId)
  const gh = githubFor(site, env)
  const pages = onlyPage ? [onlyPage] : await gh.listHtml(site.folder)
  const existing = await db.get<{ id: string; page: string; key: string }>(
    `site_fields?site_id=eq.${site.id}&select=id,page,key${onlyPage ? `&page=eq.${encodeURIComponent(onlyPage)}` : ''}`)
  const known = new Map(existing.map((f) => [`${f.page}\u0000${f.key}`, f.id]))
  const found = new Set<string>()
  const fresh: unknown[] = []
  const update: unknown[] = []
  let total = 0

  for (const page of pages) {
    const fields = scanFields(await gh.readFile(repoPath(site.folder, page)))
    total += fields.length
    for (const f of fields) {
      const id = `${page}\u0000${f.key}`
      found.add(id)
      const row = { site_id: site.id, page, key: f.key, type: f.type, value: f.value, position: f.position }
      // New fields get a label; existing ones keep any label the team gave them.
      if (known.has(id)) update.push(row)
      else fresh.push({ ...row, label: f.label })
    }
  }
  const upsert = 'site_fields?on_conflict=site_id,page,key'
  if (fresh.length) await db.post(upsert, fresh, 'resolution=merge-duplicates,return=minimal')
  if (update.length) await db.post(upsert, update, 'resolution=merge-duplicates,return=minimal')
  // Fields that were removed from the HTML disappear from the CMS too.
  const gone = existing.filter((f) => !found.has(`${f.page}\u0000${f.key}`)).map((f) => f.id)
  if (gone.length) await db.del(`site_fields?id=in.(${gone.join(',')})`)
  await db.patch(`sites?id=eq.${site.id}`, { last_scanned_at: new Date().toISOString() }).catch(() => { /* staff can't edit sites; fine */ })
  return { pages: pages.length, fields: total, removed: gone.length }
}

// ---------------------------------------------------------------------------
// /api/cms/automark — mark headings, text, photos and buttons on one page (admin only)
// ---------------------------------------------------------------------------
async function automark(db: Db, env: Env, siteId: string, page: string) {
  if (db.me.role !== 'admin') throw new HttpError(403, 'Only admins can change website code.')
  if (!/^[\w./-]+\.html?$/i.test(page) || page.includes('..')) throw new HttpError(400, 'Which page?')
  const site = await db.site(siteId)
  const gh = githubFor(site, env)
  const path = repoPath(site.folder, page)
  const { html, added } = await autoMark(await gh.readFile(path))
  let commit: string | null = null
  if (added > 0) commit = await gh.commit([{ path, content: html }], `Work Hub: mark ${added} editable parts on ${page}`)
  const result = await scan(db, env, site.id, page)
  return { added, commit, fields: result.fields }
}

// ---------------------------------------------------------------------------
// /api/cms/publish — put approved changes live: edit the pages, add photos, one commit
// ---------------------------------------------------------------------------
async function publish(db: Db, env: Env, ids: string[]) {
  ids = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id))
  if (ids.length === 0) throw new HttpError(400, 'Nothing to publish.')
  const changes = await db.get<Change>(`site_changes?id=in.(${ids.join(',')})&select=*&order=created_at`)
  if (changes.length !== ids.length) throw new HttpError(404, 'Some of these changes can’t be found.')
  const siteIds = new Set(changes.map((c) => c.site_id))
  if (siteIds.size !== 1) throw new HttpError(400, 'Publish one website at a time.')
  const site = await db.site([...siteIds][0])

  // Check permission BEFORE touching GitHub (the database checks again when we record it).
  if (!db.isStaff) {
    if (site.requires_approval) throw new HttpError(403, 'Your changes are sent to the team for approval first.')
    if (changes.some((c) => c.created_by !== db.me.id)) throw new HttpError(403, 'You can only publish your own changes.')
  }
  for (const c of changes) {
    if (c.kind !== 'edit') throw new HttpError(400, 'Change requests are done by the team, not published automatically.')
    if (!['submitted', 'approved', 'failed'].includes(c.status)) throw new HttpError(400, 'One of these changes was already handled.')
    if (!c.page || !c.field_key || !c.field_type || c.new_value === null || !KEY_PATTERN.test(c.field_key)) throw new HttpError(400, 'A change is missing its details.')
  }

  try {
    const gh = githubFor(site, env)
    const files: { path: string; content: string | Uint8Array }[] = []

    // Photos the client uploaded: copy them into the website (e.g. public/images/uploads/…).
    for (const c of changes.filter((c) => c.field_type === 'image')) {
      const v = JSON.parse(c.new_value!) as { src: string; upload?: string }
      if (!v.upload) continue
      if (!v.upload.startsWith(`${site.id}/`) || !/^\/images\/uploads\/[\w.-]+$/.test(v.src)) throw new Error('A photo has an unexpected name.')
      files.push({ path: repoPath(site.folder, v.src.slice(1)), content: await db.download('site-images', v.upload) })
    }

    // Each page once, with all its changes (the newest change to a field wins).
    const byPage = new Map<string, Map<string, Edit>>()
    for (const c of changes) {
      const edits = byPage.get(c.page!) ?? new Map<string, Edit>()
      edits.set(c.field_key!, { key: c.field_key!, type: c.field_type!, value: c.new_value! })
      byPage.set(c.page!, edits)
    }
    for (const [page, edits] of byPage) {
      const path = repoPath(site.folder, page)
      const { html, applied } = await applyEdits(await gh.readFile(path), [...edits.values()])
      const missing = [...edits.keys()].filter((k) => !applied.has(k))
      if (missing.length) throw new Error(`These parts are no longer on ${page}: ${missing.join(', ')}. Scan the website again.`)
      files.push({ path, content: html })
    }

    const who = db.me.full_name || (db.isStaff ? 'the team' : 'the client')
    const sha = await gh.commit(files, `Website update from Work Hub: ${changes.length} change${changes.length === 1 ? '' : 's'} by ${who}`)
    await db.rpc('cms_mark_published', { p_change_ids: ids, p_commit: sha })
    return { published: ids.length, commit: sha }
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'Publishing failed'
    await db.rpc('cms_mark_failed', { p_change_ids: ids, p_reason: reason }).catch(() => {})
    throw new HttpError(e instanceof HttpError ? e.status : 502, reason)
  }
}
