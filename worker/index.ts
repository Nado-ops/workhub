// The Work Hub server. It does two things:
//   1. Serves the app (everything in ./dist) — the same as before.
//   2. Handles /api/cms/* for the website CMS. Two kinds of client website are supported:
//      • GitHub sites (Cloudflare Pages or Workers connected to a repo): changes are committed to GitHub
//        and Cloudflare rebuilds the site.
//      • Cloudflare Pages "direct upload" sites (no GitHub): Work Hub keeps a copy of the files
//        (Storage bucket site-files) and deploys the whole site to Cloudflare after each change.
//
// Security: every /api call must carry the person's Work Hub login. We ask Supabase who they are and
// read/write the database AS THAT PERSON, so all the normal database rules still apply.
// Secrets (GITHUB_TOKEN, CLOUDFLARE_API_TOKEN) live in Cloudflare — never in the code or the browser.
import { GitHub, repoPath } from './github'
import { applyEdits, autoMark, scanFields, KEY_PATTERN, type Edit, type FieldType } from './html'
import { Pages, cfHash, contentType, isServerCode, SPECIAL_FILES, toBase64 } from './pages'
import { UserAdmin } from './users'
import { handleLeads } from './leads'

export interface Env {
  ASSETS: Fetcher
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  GITHUB_TOKEN?: string
  CLOUDFLARE_API_TOKEN?: string
  SUPABASE_SERVICE_ROLE_KEY?: string // only for adding people / blocking logins (worker/users.ts)
  GITHUB_API?: string     // only for testing
  CLOUDFLARE_API?: string // only for testing
}

interface Site {
  id: string; client_id: string; name: string; kind: string; repo: string | null; branch: string; folder: string
  requires_approval: boolean; cf_account_id: string | null; cf_project: string | null; cf_deployment_id: string | null
}
interface Change {
  id: string; site_id: string; kind: string; page: string | null; field_key: string | null
  field_type: FieldType | null; new_value: string | null; status: string; created_by: string | null; created_at: string
}
interface SiteFile { path: string; hash: string; deployed_hash: string | null; source: string; size: number; content_type: string | null }
interface Me { id: string; role: 'admin' | 'staff' | 'client'; client_id: string | null; full_name: string | null; custom_role?: { permissions: string[] } | null }

class HttpError extends Error { constructor(public status: number, message: string) { super(message) } }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)
    // Website contact forms: public (no login), protected by form key + website check (worker/leads.ts).
    if (url.pathname === '/api/leads') return handleLeads(request, env).catch(() => new Response('Something went wrong', { status: 500 }))
    try {
      if (request.method !== 'POST' && url.pathname !== '/api/cms/status') throw new HttpError(405, 'Use POST')
      const db = await Db.forRequest(request, env)
      const body = request.method === 'POST' ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {}
      const siteId = String(body.site_id ?? '')
      switch (url.pathname) {
        case '/api/cms/status': return json({ github_connected: Boolean(env.GITHUB_TOKEN), cloudflare_connected: Boolean(env.CLOUDFLARE_API_TOKEN), users_ready: Boolean(env.SUPABASE_SERVICE_ROLE_KEY), role: db.me.role })
        case '/api/cms/scan': return json(await scan(db, env, siteId))
        case '/api/cms/automark': return json(await automark(db, env, siteId, String(body.page ?? '')))
        case '/api/cms/publish': return json(await publish(db, env, (body.change_ids as string[] | undefined) ?? []))
        // Cloudflare Pages (direct upload) helpers
        case '/api/cms/cf-status': return json(await cfStatus(db, env, siteId))
        case '/api/cms/cf-missing': return json(await cfMissing(db, env, siteId, (body.hashes as string[] | undefined) ?? []))
        case '/api/cms/cf-upload': return json(await cfUpload(db, env, siteId, (body.files as UploadFile[] | undefined) ?? []))
        case '/api/cms/cf-deploy': return json(await cfDeployFresh(db, env, siteId))
        // People (Team & settings) — admins only
        case '/api/users/list': return json(await usersList(db, env))
        case '/api/users/invite': return json(await usersInvite(db, env, request, body))
        case '/api/users/access': return json(await usersAccess(db, env, String(body.user_id ?? ''), Boolean(body.blocked)))
        case '/api/users/link': return json(await usersLink(db, env, request, String(body.user_id ?? '')))
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

const enc = new TextEncoder()
const dec = new TextDecoder()

// ---------------------------------------------------------------------------
// Database + Storage access as the logged-in person (Supabase REST API + their login token)
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
    const [me] = await db.get<Me>(`profiles?id=eq.${user.id}&select=id,role,client_id,full_name,custom_role:roles(permissions)`)
    if (!me) throw new HttpError(403, 'No Work Hub profile for this login.')
    db.me = me
    return db
  }

  get isStaff() { return this.me.role === 'admin' || this.me.role === 'staff' }
  get isAdmin() { return this.me.role === 'admin' }
  /** Admins can do everything; staff what their custom role allows (migration 013). */
  can(permission: 'finance' | 'hr' | 'websites' | 'announcements') {
    return this.isAdmin || (this.me.role === 'staff' && !!this.me.custom_role?.permissions.includes(permission))
  }

  private headers(extra: Record<string, string> = {}) {
    return { apikey: this.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${this.token}`, ...extra }
  }
  private async call(path: string, init: RequestInit = {}) {
    const res = await fetch(`${this.env.SUPABASE_URL}/rest/v1/${path}`, {
      ...init, headers: this.headers({ 'Content-Type': 'application/json', ...((init.headers as Record<string, string>) ?? {}) }),
    })
    if (!res.ok) throw new HttpError(res.status === 401 ? 401 : 400, `Database: ${(await res.text()).slice(0, 300)}`)
    return res
  }
  async get<T>(path: string): Promise<T[]> { return (await this.call(path)).json() as Promise<T[]> }
  async post(path: string, rows: unknown, prefer = 'return=minimal') { await this.call(path, { method: 'POST', body: JSON.stringify(rows), headers: { Prefer: prefer } }) }
  async patch(path: string, values: unknown) { await this.call(path, { method: 'PATCH', body: JSON.stringify(values), headers: { Prefer: 'return=minimal' } }) }
  async del(path: string) { await this.call(path, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }) }
  async rpc(fn: string, args: unknown) { await this.call(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) }) }

  private objectUrl(bucket: string, path: string) {
    return `${this.env.SUPABASE_URL}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`
  }
  /** Download a file from Storage (the database rules decide whether this person may). */
  async download(bucket: string, path: string): Promise<Uint8Array> {
    const res = await fetch(this.objectUrl(bucket, path).replace('/object/', '/object/authenticated/'), { headers: this.headers() })
    if (!res.ok) throw new HttpError(400, `Couldn’t read ${path} from Work Hub’s copy (${res.status}).`)
    return new Uint8Array(await res.arrayBuffer())
  }
  /** Save a file to Storage, replacing any old one (admins only, by the bucket rules). */
  async upload(bucket: string, path: string, bytes: Uint8Array, type: string) {
    const res = await fetch(this.objectUrl(bucket, path), { method: 'POST', body: bytes, headers: this.headers({ 'Content-Type': type, 'x-upsert': 'true' }) })
    if (!res.ok) throw new HttpError(400, `Couldn’t save ${path} (${res.status}).`)
  }

  async site(id: string): Promise<Site> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Which website?')
    const [site] = await this.get<Site>(`sites?id=eq.${id}&select=*`)
    if (!site) throw new HttpError(404, 'Website not found.')
    return site
  }
}

// ---------------------------------------------------------------------------
// Where a site's pages come from
// ---------------------------------------------------------------------------
function githubFor(site: Site, env: Env) {
  if (site.kind !== 'github' || !site.repo) throw new HttpError(400, 'This website isn’t connected to GitHub.')
  return new GitHub(env, site.repo, site.branch)
}
function pagesFor(site: Site, env: Env) {
  if (site.kind !== 'cloudflare' || !site.cf_account_id || !site.cf_project) throw new HttpError(400, 'This website isn’t a Cloudflare Pages site.')
  return new Pages(env, site.cf_account_id, site.cf_project)
}
function requireEditable(site: Site) {
  if (site.kind !== 'github' && site.kind !== 'cloudflare') throw new HttpError(400, 'This website takes change requests only.')
}

/** Every HTML page of the site. */
async function listPages(db: Db, env: Env, site: Site): Promise<string[]> {
  if (site.kind === 'github') return githubFor(site, env).listHtml(site.folder)
  const files = await db.get<{ path: string }>(`site_files?site_id=eq.${site.id}&select=path`)
  return files.map((f) => f.path).filter((p) => /\.html?$/i.test(p))
    .sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)))
}

/** The page as stored: in GitHub (= what's live), or Work Hub's uploaded copy for Cloudflare Pages sites. */
async function readBase(db: Db, env: Env, site: Site, page: string): Promise<string> {
  if (site.kind === 'github') return githubFor(site, env).readFile(repoPath(site.folder, page))
  return dec.decode(await db.download('site-files', `${site.id}/${page}`))
}

/**
 * For Cloudflare Pages sites, what's live = the uploaded copy + edits made in Work Hub since.
 * Only fields whose value differs from the copy are applied, so untouched parts stay exactly as uploaded.
 */
async function buildLivePage(db: Db, site: Site, page: string, base: string, extra: Edit[] = []): Promise<string> {
  const baseValues = new Map(scanFields(base).map((f) => [f.key, f.value]))
  const fields = await db.get<{ key: string; type: FieldType; value: string | null }>(
    `site_fields?site_id=eq.${site.id}&page=eq.${encodeURIComponent(page)}&select=key,type,value`)
  const edits = new Map<string, Edit>()
  for (const f of fields) {
    if (f.value !== null && baseValues.has(f.key) && baseValues.get(f.key) !== f.value) edits.set(f.key, { key: f.key, type: f.type, value: f.value })
  }
  for (const e of extra) edits.set(e.key, e)
  if (edits.size === 0) return base
  return (await applyEdits(base, [...edits.values()])).html
}

// ---------------------------------------------------------------------------
// /api/cms/scan — read every page and save its editable fields (team only)
// mode, for each part already known:
//   'replace' — take the value from the files (GitHub sites: the repo IS the live site)
//   'keep'    — keep the current value (Cloudflare Pages sites: Work Hub's copy doesn't include edits)
//   'merge'   — after a new upload: keep the client's edit only if you didn't change that part in the new files
// ---------------------------------------------------------------------------
type ScanMode = 'replace' | 'keep' | 'merge'
async function scan(db: Db, env: Env, siteId: string, opts: { page?: string; mode?: ScanMode } = {}) {
  if (!db.isStaff) throw new HttpError(403, 'Only the team can scan websites.')
  const site = await db.site(siteId)
  requireEditable(site)
  const mode: ScanMode = opts.mode ?? (site.kind === 'cloudflare' ? 'keep' : 'replace')
  const pages = opts.page ? [opts.page] : await listPages(db, env, site)
  const existing = await db.get<{ id: string; page: string; key: string; value: string | null; base_value: string | null }>(
    `site_fields?site_id=eq.${site.id}&select=id,page,key,value,base_value${opts.page ? `&page=eq.${encodeURIComponent(opts.page)}` : ''}`)
  const known = new Map(existing.map((f) => [`${f.page}\u0000${f.key}`, f]))
  const found = new Set<string>()
  const fresh: unknown[] = []
  const update: unknown[] = []
  let total = 0

  for (const page of pages) {
    const fields = scanFields(await readBase(db, env, site, page))
    total += fields.length
    for (const f of fields) {
      const id = `${page}\u0000${f.key}`
      found.add(id)
      const old = known.get(id)
      const keep = old && (mode === 'keep' || (mode === 'merge' && old.base_value !== null && old.base_value === f.value))
      const row = { site_id: site.id, page, key: f.key, type: f.type, position: f.position, value: keep ? old!.value : f.value, base_value: f.value }
      // New fields get a label; existing ones keep any label the team gave them.
      if (old) update.push(row)
      else fresh.push({ ...row, value: f.value, label: f.label })
    }
  }
  const upsert = 'site_fields?on_conflict=site_id,page,key'
  if (fresh.length) await db.post(upsert, fresh, 'resolution=merge-duplicates,return=minimal')
  if (update.length) await db.post(upsert, update, 'resolution=merge-duplicates,return=minimal')
  const gone = existing.filter((f) => !found.has(`${f.page}\u0000${f.key}`)).map((f) => f.id)
  if (gone.length) await db.del(`site_fields?id=in.(${gone.join(',')})`)
  if (db.can('websites')) await db.patch(`sites?id=eq.${site.id}`, { last_scanned_at: new Date().toISOString() })
  return { pages: pages.length, fields: total, removed: gone.length }
}

// ---------------------------------------------------------------------------
// /api/cms/automark — mark headings, text, photos and buttons on one page (admin only)
// ---------------------------------------------------------------------------
async function automark(db: Db, env: Env, siteId: string, page: string) {
  if (!db.can('websites')) throw new HttpError(403, 'Only admins (or the web team) can change website code.')
  if (!/^[\w./-]+\.html?$/i.test(page) || page.includes('..')) throw new HttpError(400, 'Which page?')
  const site = await db.site(siteId)
  requireEditable(site)
  const { html, added } = await autoMark(await readBase(db, env, site, page))
  let saved: string | null = null
  if (added > 0) {
    if (site.kind === 'github') {
      saved = await githubFor(site, env).commit([{ path: repoPath(site.folder, page), content: html }], `Work Hub: mark ${added} editable parts on ${page}`)
    } else {
      // Save the marked copy, then deploy so the live page has the markers too.
      const bytes = enc.encode(html)
      await db.upload('site-files', `${site.id}/${page}`, bytes, 'text/html')
      await db.patch(`site_files?site_id=eq.${site.id}&path=eq.${encodeURIComponent(page)}`, { hash: cfHash(bytes, page), size: bytes.length })
      await scan(db, env, site.id, { page, mode: 'keep' })
      saved = await cfDeploy(db, env, site, { pages: [page], checkDrift: true })
      return { added, commit: saved, fields: (await db.get(`site_fields?site_id=eq.${site.id}&page=eq.${encodeURIComponent(page)}&select=id`)).length }
    }
  }
  const result = await scan(db, env, site.id, { page })
  return { added, commit: saved, fields: result.fields }
}

// ---------------------------------------------------------------------------
// /api/cms/publish — put changes live (pages + photos together)
// ---------------------------------------------------------------------------
async function publish(db: Db, env: Env, ids: string[]) {
  ids = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id))
  if (ids.length === 0) throw new HttpError(400, 'Nothing to publish.')
  const changes = await db.get<Change>(`site_changes?id=in.(${ids.join(',')})&select=*&order=created_at`)
  if (changes.length !== ids.length) throw new HttpError(404, 'Some of these changes can’t be found.')
  const siteIds = new Set(changes.map((c) => c.site_id))
  if (siteIds.size !== 1) throw new HttpError(400, 'Publish one website at a time.')
  const site = await db.site([...siteIds][0])
  requireEditable(site)

  // Check permission BEFORE touching GitHub/Cloudflare (the database checks again when we record it).
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
    // Photos the client uploaded: they go into the website at /images/uploads/…
    const photos: { path: string; upload: string; bytes: Uint8Array }[] = []
    for (const c of changes.filter((c) => c.field_type === 'image')) {
      const v = JSON.parse(c.new_value!) as { src: string; upload?: string }
      if (!v.upload) continue
      if (!v.upload.startsWith(`${site.id}/`) || !/^\/images\/uploads\/[\w.-]+$/.test(v.src)) throw new Error('A photo has an unexpected name.')
      photos.push({ path: v.src.slice(1), upload: v.upload, bytes: await db.download('site-images', v.upload) })
    }

    // Each page once, with all its changes (the newest change to a field wins).
    const byPage = new Map<string, Map<string, Edit>>()
    for (const c of changes) {
      const edits = byPage.get(c.page!) ?? new Map<string, Edit>()
      edits.set(c.field_key!, { key: c.field_key!, type: c.field_type!, value: c.new_value! })
      byPage.set(c.page!, edits)
    }
    const who = db.me.full_name || (db.isStaff ? 'the team' : 'the client')
    const message = `Website update from Work Hub: ${changes.length} change${changes.length === 1 ? '' : 's'} by ${who}`

    let ref: string
    if (site.kind === 'github') {
      const gh = githubFor(site, env)
      const files: { path: string; content: string | Uint8Array }[] = photos.map((p) => ({ path: repoPath(site.folder, p.path), content: p.bytes }))
      for (const [page, edits] of byPage) {
        const { html, applied } = await applyEdits(await gh.readFile(repoPath(site.folder, page)), [...edits.values()])
        const missing = [...edits.keys()].filter((k) => !applied.has(k))
        if (missing.length) throw new Error(`These parts are no longer on ${page}: ${missing.join(', ')}. Scan the website again.`)
        files.push({ path: repoPath(site.folder, page), content: html })
      }
      ref = await gh.commit(files, message)
    } else {
      // Check the parts still exist in Work Hub's copy, then deploy.
      for (const [page, edits] of byPage) {
        const keys = new Set(scanFields(await readBase(db, env, site, page)).map((f) => f.key))
        const missing = [...edits.keys()].filter((k) => !keys.has(k))
        if (missing.length) throw new Error(`These parts are no longer on ${page}: ${missing.join(', ')}. Scan the website again.`)
      }
      ref = await cfDeploy(db, env, site, {
        pages: [...byPage.keys()],
        edits: new Map([...byPage].map(([p, e]) => [p, [...e.values()]])),
        photos,
        checkDrift: true,
      })
    }
    await db.rpc('cms_mark_published', { p_change_ids: ids, p_commit: ref })
    return { published: ids.length, commit: ref }
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'Publishing failed'
    await db.rpc('cms_mark_failed', { p_change_ids: ids, p_reason: reason }).catch(() => {})
    throw new HttpError(e instanceof HttpError ? e.status : 502, reason)
  }
}

// ---------------------------------------------------------------------------
// Cloudflare Pages: deploy the whole site from Work Hub's copy
// ---------------------------------------------------------------------------
async function cfDeploy(db: Db, env: Env, site: Site, opts: {
  pages?: string[]                     // pages to rebuild (copy + Work Hub edits)
  edits?: Map<string, Edit[]>          // new edits for those pages
  photos?: { path: string; upload: string; bytes: Uint8Array }[]
  checkDrift?: boolean
  fresh?: boolean                      // a brand-new upload: deploy the copy exactly as uploaded
}): Promise<string> {
  const cf = pagesFor(site, env)

  // Someone uploaded straight in the Cloudflare dashboard since Work Hub last deployed? Then Work Hub's
  // copy is out of date, and deploying would bring back the old version. Stop and ask for the new files.
  if (opts.checkDrift) {
    if (!site.cf_deployment_id) throw new HttpError(409, 'Upload this website’s files in Work Hub first (Websites → Files).')
    const latest = await cf.latestDeployment()
    if (latest && latest !== site.cf_deployment_id) {
      throw new HttpError(409, 'This website was updated in the Cloudflare dashboard after Work Hub’s last upload. Upload the new files in Work Hub (Websites → Files) so nothing gets undone, then publish again.')
    }
  }

  const files = await db.get<SiteFile>(`site_files?site_id=eq.${site.id}&select=path,hash,deployed_hash,source,size,content_type`)
  if (files.length === 0) throw new HttpError(400, 'Work Hub has no copy of this website yet. Upload its files first.')
  const byPath = new Map(files.map((f) => [f.path, f]))

  const manifest: Record<string, string> = {}
  const built = new Map<string, { bytes: Uint8Array; type: string }>()
  const records: Record<string, unknown>[] = []

  for (const f of files) {
    if (SPECIAL_FILES.includes(f.path) || isServerCode(f.path)) continue
    manifest[`/${f.path}`] = opts.fresh ? f.hash : f.deployed_hash ?? f.hash
    if (opts.fresh) records.push({ path: f.path, deployed_hash: f.hash })
  }
  for (const page of opts.pages ?? []) {
    if (!byPath.has(page)) throw new HttpError(400, `${page} isn’t in Work Hub’s copy of the website.`)
    const html = await buildLivePage(db, site, page, await readBase(db, env, site, page), opts.edits?.get(page) ?? [])
    const bytes = enc.encode(html)
    const h = cfHash(bytes, page)
    manifest[`/${page}`] = h
    built.set(h, { bytes, type: 'text/html' })
    records.push({ path: page, deployed_hash: h })
  }
  for (const p of opts.photos ?? []) {
    const h = cfHash(p.bytes, p.path)
    manifest[`/${p.path}`] = h
    built.set(h, { bytes: p.bytes, type: contentType(p.path) })
    records.push({ path: p.path, hash: h, deployed_hash: h, size: p.bytes.length, content_type: contentType(p.path), source: `site-images:${p.upload}` })
  }

  // Upload only what Cloudflare doesn't already have.
  const jwt = await cf.uploadToken()
  const hashes = [...new Set(Object.values(manifest))]
  const missing = await cf.missing(jwt, hashes)
  const pathFor = new Map(Object.entries(manifest).map(([p, h]) => [h, p.slice(1)]))
  let batch: { hash: string; base64: string; contentType: string }[] = []
  let size = 0
  const flush = async () => { if (batch.length) await cf.upload(jwt, batch); batch = []; size = 0 }
  for (const h of missing) {
    let item = built.get(h)
    if (!item) {
      // Not built just now: rebuild an edited page, or take the file from Work Hub's copy.
      const path = pathFor.get(h)!
      const f = byPath.get(path)!
      if (/\.html?$/i.test(path) && f.deployed_hash && f.deployed_hash !== f.hash && !opts.fresh) {
        item = { bytes: enc.encode(await buildLivePage(db, site, path, await readBase(db, env, site, path))), type: 'text/html' }
      } else if (f.source.startsWith('site-images:')) {
        item = { bytes: await db.download('site-images', f.source.slice('site-images:'.length)), type: f.content_type ?? contentType(path) }
      } else {
        item = { bytes: await db.download('site-files', `${site.id}/${path}`), type: f.content_type ?? contentType(path) }
      }
    }
    batch.push({ hash: h, base64: toBase64(item.bytes), contentType: item.type })
    size += item.bytes.length
    if (size > 20 * 1024 * 1024 || batch.length >= 500) await flush()
  }
  await flush()
  await cf.keep(jwt, hashes)

  // Settings files (_headers, _redirects, _routes.json) go next to the manifest.
  const special = []
  for (const name of SPECIAL_FILES) {
    if (byPath.has(name)) special.push({ name, content: dec.decode(await db.download('site-files', `${site.id}/${name}`)) })
  }
  const deployment = await cf.deploy(manifest, special)
  await db.rpc('cms_record_deploy', { p_site: site.id, p_deployment: deployment, p_files: records })
  return deployment
}

// ---------------------------------------------------------------------------
// Cloudflare Pages: endpoints used by the "Upload new version" screen (admin only).
// The browser saves the files in Work Hub's copy itself, then sends Cloudflare only the missing ones through here.
// ---------------------------------------------------------------------------
interface UploadFile { hash: string; base64: string; content_type: string }

async function cfSiteForAdmin(db: Db, env: Env, siteId: string) {
  if (!db.can('websites')) throw new HttpError(403, 'Only admins (or the web team) can upload website files.')
  const site = await db.site(siteId)
  return { site, cf: pagesFor(site, env) }
}

async function cfStatus(db: Db, env: Env, siteId: string) {
  if (!db.isStaff) throw new HttpError(403, 'Team only.')
  const site = await db.site(siteId)
  const latest = await pagesFor(site, env).latestDeployment()
  return { latest, ours: site.cf_deployment_id, in_sync: Boolean(site.cf_deployment_id) && (!latest || latest === site.cf_deployment_id) }
}

async function cfMissing(db: Db, env: Env, siteId: string, hashes: string[]) {
  const { cf } = await cfSiteForAdmin(db, env, siteId)
  const clean = hashes.filter((h) => /^[0-9a-f]{32}$/.test(h))
  return { missing: await cf.missing(await cf.uploadToken(), clean) }
}

async function cfUpload(db: Db, env: Env, siteId: string, files: UploadFile[]) {
  const { cf } = await cfSiteForAdmin(db, env, siteId)
  const clean = files.filter((f) => /^[0-9a-f]{32}$/.test(f.hash) && typeof f.base64 === 'string')
  // Make sure each file really matches its fingerprint (the extension comes from Work Hub's list).
  const known = new Map((await db.get<{ path: string; hash: string }>(`site_files?site_id=eq.${siteId}&select=path,hash`)).map((f) => [f.hash, f.path]))
  for (const f of clean) {
    const path = known.get(f.hash)
    if (!path) throw new HttpError(400, 'A file isn’t in Work Hub’s list. Upload again.')
    const bytes = Uint8Array.from(atob(f.base64), (ch) => ch.charCodeAt(0))
    if (cfHash(bytes, path) !== f.hash) throw new HttpError(400, `${path} didn’t upload correctly. Try again.`)
  }
  await cf.upload(await cf.uploadToken(), clean.map((f) => ({ hash: f.hash, base64: f.base64, contentType: f.content_type || 'application/octet-stream' })))
  return { uploaded: clean.length }
}

async function cfDeployFresh(db: Db, env: Env, siteId: string) {
  const { site } = await cfSiteForAdmin(db, env, siteId)
  // Files edited on your computer won't have the markers Work Hub added, so pages that had editable
  // parts are marked again (same names when the page layout is the same).
  const before = await db.get<{ page: string }>(`site_fields?site_id=eq.${site.id}&select=page`)
  const present = new Set((await db.get<{ path: string }>(`site_files?site_id=eq.${site.id}&select=path`)).map((f) => f.path))
  let remarked = 0
  for (const page of new Set(before.map((f) => f.page))) {
    if (!present.has(page)) continue
    const { html, added } = await autoMark(await readBase(db, env, site, page))
    if (added === 0) continue
    const bytes = enc.encode(html)
    await db.upload('site-files', `${site.id}/${page}`, bytes, 'text/html')
    await db.patch(`site_files?site_id=eq.${site.id}&path=eq.${encodeURIComponent(page)}`, { hash: cfHash(bytes, page), size: bytes.length })
    remarked++
  }
  // Read the new files' editable parts. Client edits stay where you didn't change that part.
  const result = await scan(db, env, site.id, { mode: 'merge' })
  // Pages that still carry client edits are rebuilt; everything else goes live exactly as uploaded.
  const fields = await db.get<{ page: string; value: string | null; base_value: string | null }>(`site_fields?site_id=eq.${site.id}&select=page,value,base_value`)
  const edited = [...new Set(fields.filter((f) => f.value !== f.base_value).map((f) => f.page))]
  const deployment = await cfDeploy(db, env, site, { fresh: true, pages: edited })
  return { deployment, kept_edits_on: edited, remarked_pages: remarked, ...result }
}

// ---------------------------------------------------------------------------
// People: invite, login status, block / unblock, send a login link (admins only)
// ---------------------------------------------------------------------------
const UUID = /^[0-9a-f-]{36}$/i

function adminOnly(db: Db) {
  if (!db.isAdmin) throw new HttpError(403, 'Only admins can manage people.')
}

async function usersList(db: Db, env: Env) {
  adminOnly(db)
  const users = new UserAdmin(env)
  if (!users.ready) return { ready: false, users: [] }
  return { ready: true, users: await users.list() }
}

async function usersInvite(db: Db, env: Env, request: Request, body: Record<string, unknown>) {
  adminOnly(db)
  const email = String(body.email ?? '').trim().toLowerCase()
  const fullName = String(body.full_name ?? '').trim()
  const role = String(body.role ?? '')
  const clientId = body.client_id ? String(body.client_id) : null
  const roleId = body.role_id ? String(body.role_id) : null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Please enter a valid email address.')
  if (!fullName) throw new HttpError(400, 'Please enter their name.')
  if (!['admin', 'staff', 'client'].includes(role)) throw new HttpError(400, 'Choose a role.')
  if (role === 'client' && (!clientId || !UUID.test(clientId))) throw new HttpError(400, 'Choose which company this client belongs to.')
  if (roleId && !UUID.test(roleId)) throw new HttpError(400, 'Unknown custom role.')

  // The invite link brings them back to this Work Hub, where they set a password.
  const user = await new UserAdmin(env).invite(email, fullName, `${new URL(request.url).origin}/`)
    .catch((e) => { throw new HttpError(400, e instanceof Error ? e.message : 'Invite failed') })
  // Their profile is created automatically; set the role with YOUR login (the normal admin rules apply).
  await db.patch(`profiles?id=eq.${user.id}`, {
    full_name: fullName, role,
    client_id: role === 'client' ? clientId : null,
    role_id: role === 'staff' ? roleId : null,
  })
  return { id: user.id }
}

async function usersAccess(db: Db, env: Env, userId: string, blocked: boolean) {
  adminOnly(db)
  if (!UUID.test(userId)) throw new HttpError(400, 'Who?')
  if (userId === db.me.id) throw new HttpError(400, 'You can’t remove your own access.')
  await new UserAdmin(env).setBlocked(userId, blocked).catch((e) => { throw new HttpError(400, e instanceof Error ? e.message : 'Failed') })
  return { blocked }
}

async function usersLink(db: Db, env: Env, request: Request, userId: string) {
  adminOnly(db)
  if (!UUID.test(userId)) throw new HttpError(400, 'Who?')
  const [p] = await db.get<{ email: string | null }>(`profiles?id=eq.${userId}&select=email`)
  if (!p?.email) throw new HttpError(404, 'That person has no email address.')
  await new UserAdmin(env).sendLoginLink(p.email, `${new URL(request.url).origin}/`).catch((e) => { throw new HttpError(400, e instanceof Error ? e.message : 'Failed') })
  return { sent: p.email }
}
