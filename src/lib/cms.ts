// Website CMS helpers shared by the admin "Websites" page and the client "My website" page.
import { supabase } from './supabase'

export type FieldType = 'text' | 'richtext' | 'image' | 'link'
export interface Site {
  id: string; client_id: string; name: string; url: string | null; kind: 'github' | 'wordpress' | 'other'
  repo: string | null; branch: string; folder: string; requires_approval: boolean; last_scanned_at: string | null
  client?: { name: string } | null
}
export interface SiteField { id: string; site_id: string; page: string; key: string; type: FieldType; label: string | null; value: string | null; position: number }
export interface SiteChange {
  id: string; site_id: string; kind: 'edit' | 'request'; page: string | null; field_key: string | null; field_type: FieldType | null
  old_value: string | null; new_value: string | null; note: string | null; images: string[]
  status: 'submitted' | 'approved' | 'published' | 'rejected' | 'done' | 'failed'; review_note: string | null
  created_by: string | null; created_at: string; published_at: string | null; commit_sha: string | null
  author?: { full_name: string | null; role: string } | null
}
export interface ImageValue { src: string; alt: string; upload?: string }
export interface LinkValue { href: string; text: string }

export const CHANGE_STATUS: Record<SiteChange['status'], { text: string; tone: string }> = {
  submitted: { text: 'Waiting for approval', tone: 'bg-warn-soft text-warn' },
  approved: { text: 'Approved', tone: 'bg-info-soft text-info' },
  published: { text: 'Live', tone: 'bg-success-soft text-success' },
  done: { text: 'Done', tone: 'bg-success-soft text-success' },
  rejected: { text: 'Not published', tone: 'bg-raised text-muted' },
  failed: { text: 'Didn’t publish', tone: 'bg-danger-soft text-danger' },
}

/** "about/index.html" → "About", "index.html" → "Home", "services.html" → "Services" */
export function pageName(page: string) {
  if (page === 'index.html') return 'Home'
  const s = page.replace(/\/index\.html?$/i, '').replace(/\.html?$/i, '').split('/').pop() ?? page
  return s.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

export const parseJson = <T,>(v: string | null, fallback: T): T => {
  try { return v ? (JSON.parse(v) as T) : fallback } catch { return fallback }
}

/** Show a website image: relative paths are loaded from the live site. */
export function imageUrl(site: Site, src: string) {
  if (/^https?:\/\//i.test(src) || !site.url) return src
  return site.url.replace(/\/$/, '') + (src.startsWith('/') ? src : `/${src}`)
}

/** Call the Work Hub server (worker/index.ts) with your login. */
export async function cmsApi<T = unknown>(path: 'scan' | 'automark' | 'publish' | 'status', body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const res = await fetch(`/api/cms/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const out = await res.json().catch(() => ({ error: `The server didn’t answer (${res.status}).` }))
  if (!res.ok) throw new Error((out as { error?: string }).error ?? 'Something went wrong')
  return out as T
}

/** Upload a photo for the website. It goes live (copied into the site) when the change is published. */
export async function uploadSiteImage(siteId: string, file: File): Promise<ImageValue> {
  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const base = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'photo'
  const name = `${base}-${crypto.randomUUID().slice(0, 8)}.${ext}`
  const upload = `${siteId}/${name}`
  const { error } = await supabase.storage.from('site-images').upload(upload, file, { contentType: file.type })
  if (error) throw new Error(error.message)
  return { src: `/images/uploads/${name}`, alt: '', upload }
}

/** A short-lived link to look at an uploaded photo that isn't on the website yet. */
export async function uploadPreview(path: string) {
  const { data } = await supabase.storage.from('site-images').createSignedUrl(path, 600)
  return data?.signedUrl ?? ''
}
