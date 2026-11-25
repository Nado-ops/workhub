// "Upload new version" for Cloudflare Pages sites without GitHub.
// 1. Read the files (a folder or a .zip) in the browser.
// 2. Save them as Work Hub's copy (Storage bucket site-files + the site_files list).
// 3. Send Cloudflare only the files it doesn't have yet, then ask the server to deploy.
import { unzipSync } from 'fflate'
import { blake3 } from '@noble/hashes/blake3.js'
import { supabase } from './supabase'
import { cmsApi } from './cms'

export interface PickedFile { path: string; bytes: Uint8Array }
export interface UploadResult { files: number; skipped: string[]; deployment: string; pages: number; fields: number; kept_edits_on: string[] }

const JUNK = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini|\.git)(\/|$)/i
const SERVER_CODE = /^(functions\/|_worker\.js)/
const MAX_FILE = 25 * 1024 * 1024 // Cloudflare Pages' limit per file

/** Files from a folder picker (each has webkitRelativePath) or from one .zip file. */
export async function readPicked(list: File[]): Promise<PickedFile[]> {
  let files: PickedFile[] = []
  if (list.length === 1 && /\.zip$/i.test(list[0].name)) {
    const unzipped = unzipSync(new Uint8Array(await list[0].arrayBuffer()))
    files = Object.entries(unzipped).filter(([p]) => !p.endsWith('/')).map(([path, bytes]) => ({ path, bytes }))
  } else {
    for (const f of list) files.push({ path: f.webkitRelativePath || f.name, bytes: new Uint8Array(await f.arrayBuffer()) })
  }
  files = files.map((f) => ({ ...f, path: f.path.replace(/\\/g, '/').replace(/^\.?\//, '') })).filter((f) => !JUNK.test(f.path))

  // If everything sits inside one top folder ("my-site/index.html"), use what's inside it.
  // If there's a "public" folder with the site in it, use that.
  for (let i = 0; i < 3; i++) {
    if (files.some((f) => f.path === 'index.html')) break
    const pub = files.filter((f) => f.path.startsWith('public/'))
    if (pub.some((f) => f.path === 'public/index.html')) { files = pub.map((f) => ({ ...f, path: f.path.slice(7) })); break }
    const tops = new Set(files.map((f) => f.path.split('/')[0]))
    if (tops.size !== 1 || !files.every((f) => f.path.includes('/'))) break
    const top = [...tops][0] + '/'
    files = files.map((f) => ({ ...f, path: f.path.slice(top.length) }))
  }
  return files
}

/** Cloudflare's fingerprint for a file (must match worker/pages.ts). */
export function cfHash(bytes: Uint8Array, path: string) {
  const ext = (path.split('/').pop() ?? '').includes('.') ? path.split('.').pop()! : ''
  const digest = blake3(new TextEncoder().encode(toBase64(bytes) + ext))
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

function toBase64(bytes: Uint8Array) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function contentType(path: string) {
  const ext = (path.split('.').pop() ?? '').toLowerCase()
  return ({
    html: 'text/html', htm: 'text/html', css: 'text/css', js: 'application/javascript', mjs: 'application/javascript', json: 'application/json',
    svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
    ico: 'image/x-icon', txt: 'text/plain', xml: 'application/xml', pdf: 'application/pdf', woff: 'font/woff', woff2: 'font/woff2',
    ttf: 'font/ttf', otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm', webmanifest: 'application/manifest+json',
  } as Record<string, string>)[ext] ?? 'application/octet-stream'
}

/** Run up to `n` jobs at the same time. */
async function pool<T>(items: T[], n: number, job: (item: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await job(items[i++]) }))
}

export async function uploadSiteVersion(siteId: string, picked: PickedFile[], progress: (text: string, done: number, total: number) => void): Promise<UploadResult> {
  const skipped = picked.filter((f) => SERVER_CODE.test(f.path)).map((f) => f.path)
  const files = picked.filter((f) => !SERVER_CODE.test(f.path))
  if (!files.some((f) => f.path === 'index.html')) throw new Error('There’s no index.html at the top of the upload. Choose the folder that has index.html in it.')
  const big = files.find((f) => f.bytes.length > MAX_FILE)
  if (big) throw new Error(`${big.path} is bigger than 25 MB, which Cloudflare Pages doesn’t allow.`)

  const rows = files.map((f) => ({ ...f, hash: cfHash(f.bytes, f.path), type: contentType(f.path) }))

  // 1. Work Hub's copy
  let done = 0
  await pool(rows, 4, async (f) => {
    const { error } = await supabase.storage.from('site-files').upload(`${siteId}/${f.path}`, f.bytes, { contentType: f.type, upsert: true })
    if (error) throw new Error(`${f.path}: ${error.message}`)
    progress('Saving Work Hub’s copy', ++done, rows.length)
  })

  // 2. The file list. Files that aren't in this upload are removed — except client photos added through the CMS.
  const { data: old } = await supabase.from('site_files').select('path, source').eq('site_id', siteId)
  const keep = new Set(rows.map((r) => r.path))
  const gone = ((old ?? []) as { path: string; source: string }[]).filter((f) => !keep.has(f.path) && f.source === 'site-files').map((f) => f.path)
  if (gone.length) {
    await supabase.from('site_files').delete().eq('site_id', siteId).in('path', gone)
    await supabase.storage.from('site-files').remove(gone.map((p) => `${siteId}/${p}`))
  }
  const { error } = await supabase.from('site_files').upsert(
    rows.map((r) => ({ site_id: siteId, path: r.path, size: r.bytes.length, content_type: r.type, hash: r.hash, source: 'site-files' })),
    { onConflict: 'site_id,path' })
  if (error) throw new Error(error.message)

  // 3. Only what Cloudflare doesn't have yet, in batches of about 15 MB
  progress('Checking what Cloudflare needs', 0, 1)
  const { missing } = await cmsApi<{ missing: string[] }>('cf-missing', { site_id: siteId, hashes: [...new Set(rows.map((r) => r.hash))] })
  const need = rows.filter((r, i) => missing.includes(r.hash) && rows.findIndex((x) => x.hash === r.hash) === i)
  let batch: { hash: string; base64: string; content_type: string }[] = []
  let size = 0
  let sent = 0
  const flush = async () => {
    if (!batch.length) return
    await cmsApi('cf-upload', { site_id: siteId, files: batch })
    sent += batch.length
    progress('Sending files to Cloudflare', sent, need.length)
    batch = []; size = 0
  }
  for (const r of need) {
    batch.push({ hash: r.hash, base64: toBase64(r.bytes), content_type: r.type })
    size += r.bytes.length
    if (size > 15 * 1024 * 1024) await flush()
  }
  await flush()

  // 4. Go live
  progress('Publishing', 0, 1)
  const out = await cmsApi<{ deployment: string; pages: number; fields: number; kept_edits_on: string[] }>('cf-deploy', { site_id: siteId })
  return { files: rows.length, skipped, ...out }
}
