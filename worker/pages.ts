// Talking to Cloudflare Pages "direct upload" — the same steps `wrangler pages deploy` uses:
//   1. get a short upload token for the project
//   2. ask which files (by fingerprint) Cloudflare doesn't have yet, and upload only those
//   3. create a deployment from a list of "path → fingerprint" (the manifest)
// Needs the Cloudflare secret CLOUDFLARE_API_TOKEN with permission "Cloudflare Pages: Edit".
import { blake3 } from '@noble/hashes/blake3.js'

export interface PagesEnv { CLOUDFLARE_API_TOKEN?: string; CLOUDFLARE_API?: string }

// Files Cloudflare treats as settings rather than web pages: sent next to the manifest, not in it.
export const SPECIAL_FILES = ['_headers', '_redirects', '_routes.json']
// Server code inside a Pages site isn't supported by this simple upload.
export const isServerCode = (path: string) => path === '_worker.js' || path.startsWith('_worker.js/') || path.startsWith('functions/')

/** Cloudflare's fingerprint for a file: blake3 of (file as base64 + its extension), first 32 hex characters. */
export function cfHash(bytes: Uint8Array, path: string) {
  const ext = (path.split('/').pop() ?? '').includes('.') ? path.split('.').pop()! : ''
  const digest = blake3(new TextEncoder().encode(toBase64(bytes) + ext))
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

export function toBase64(bytes: Uint8Array) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export class Pages {
  private api: string
  constructor(private env: PagesEnv, private account: string, private project: string) {
    this.api = (env.CLOUDFLARE_API || 'https://api.cloudflare.com/client/v4').replace(/\/$/, '')
  }

  private async call<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
    const key = token ?? this.env.CLOUDFLARE_API_TOKEN
    if (!key) throw new Error('Cloudflare isn’t connected yet: add the CLOUDFLARE_API_TOKEN secret in Cloudflare.')
    const res = await fetch(`${this.api}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, ...(typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}) },
    })
    const out = (await res.json().catch(() => ({}))) as { success?: boolean; result?: T; errors?: { message: string }[] }
    if (!res.ok || out.success === false) {
      const why = out.errors?.map((e) => e.message).join('; ') || `status ${res.status}`
      if (res.status === 404) throw new Error(`Cloudflare can’t find the Pages project “${this.project}”. Check the project name and account ID.`)
      if (res.status === 401 || res.status === 403) throw new Error(`Cloudflare refused the key (${why}). It needs “Cloudflare Pages: Edit”.`)
      throw new Error(`Cloudflare: ${why}`)
    }
    return out.result as T
  }

  private get base() { return `/accounts/${this.account}/pages/projects/${encodeURIComponent(this.project)}` }

  /** The newest live (production) deployment, to spot uploads made in the Cloudflare dashboard. */
  async latestDeployment(): Promise<string | null> {
    const list = await this.call<{ id: string }[]>(`${this.base}/deployments?env=production&per_page=1`)
    return list?.[0]?.id ?? null
  }

  uploadToken() { return this.call<{ jwt: string }>(`${this.base}/upload-token`).then((r) => r.jwt) }

  /** Which of these fingerprints Cloudflare doesn't have yet. */
  missing(jwt: string, hashes: string[]) {
    if (hashes.length === 0) return Promise.resolve([] as string[])
    return this.call<string[]>('/pages/assets/check-missing', { method: 'POST', body: JSON.stringify({ hashes }) }, jwt)
  }

  upload(jwt: string, files: { hash: string; base64: string; contentType: string }[]) {
    return this.call('/pages/assets/upload', {
      method: 'POST',
      body: JSON.stringify(files.map((f) => ({ key: f.hash, value: f.base64, metadata: { contentType: f.contentType }, base64: true }))),
    }, jwt)
  }

  /** Tell Cloudflare these files are still in use (keeps them from being cleaned up). */
  keep(jwt: string, hashes: string[]) {
    return this.call('/pages/assets/upsert-hashes', { method: 'POST', body: JSON.stringify({ hashes }) }, jwt)
  }

  /** Publish: manifest = { "/index.html": fingerprint, … } plus the settings files. Returns the deployment ID. */
  async deploy(manifest: Record<string, string>, special: { name: string; content: string }[]) {
    const form = new FormData()
    form.append('manifest', JSON.stringify(manifest))
    for (const f of special) form.append(f.name, new File([f.content], f.name))
    const out = await this.call<{ id: string }>(`${this.base}/deployments`, { method: 'POST', body: form })
    return out.id
  }
}

/** A sensible content type from the file name. */
export function contentType(path: string) {
  const ext = (path.split('.').pop() ?? '').toLowerCase()
  return ({
    html: 'text/html', htm: 'text/html', css: 'text/css', js: 'application/javascript', mjs: 'application/javascript',
    json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', txt: 'text/plain', xml: 'application/xml', pdf: 'application/pdf',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm', webmanifest: 'application/manifest+json',
  } as Record<string, string>)[ext] ?? 'application/octet-stream'
}
