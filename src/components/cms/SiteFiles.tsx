import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { timeAgo } from '../../lib/format'
import { cmsApi, type Site } from '../../lib/cms'
import { readPicked, uploadSiteVersion, type UploadResult } from '../../lib/siteUpload'

/**
 * Files tab for Cloudflare Pages sites without GitHub: Work Hub's copy of the website,
 * "Upload new version", and a warning when someone uploaded in the Cloudflare dashboard instead.
 */
export default function SiteFiles({ site, isAdmin, connected, onDone }: { site: Site; isAdmin: boolean; connected: boolean; onDone: () => void }) {
  const [files, setFiles] = useState<{ path: string; size: number; source: string; updated_at: string }[]>([])
  const [sync, setSync] = useState<{ in_sync: boolean; latest: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ text: string; done: number; total: number } | null>(null)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  async function load() {
    const { data } = await supabase.from('site_files').select('path, size, source, updated_at').eq('site_id', site.id).order('path')
    setFiles((data as typeof files | null) ?? [])
    if (connected && site.cf_deployment_id) cmsApi<{ in_sync: boolean; latest: string | null }>('cf-status', { site_id: site.id }).then(setSync).catch(() => setSync(null))
  }
  useEffect(() => { load() }, [site.id, site.cf_deployment_id])

  async function upload(list: FileList | null) {
    if (!list?.length) return
    setBusy(true); setError(null); setResult(null)
    try {
      const picked = await readPicked([...list])
      if (!window.confirm(`Upload ${picked.length} files and publish them to ${site.url ?? site.cf_project}?`)) { setBusy(false); return }
      const out = await uploadSiteVersion(site.id, picked, (text, done, total) => setProgress({ text, done, total }))
      setResult(out)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    }
    setProgress(null); setBusy(false)
    load()
  }

  const total = files.reduce((s, f) => s + Number(f.size), 0)
  const mb = (n: number) => (n / 1024 / 1024).toFixed(n > 10 * 1024 * 1024 ? 0 : 1)
  const sizeText = (n: number) => (n >= 1024 * 1024 ? `${mb(n)} MB` : `${Math.max(1, Math.ceil(n / 1024))} KB`)

  return (
    <div className="flex flex-col gap-4">
      {sync && !sync.in_sync && (
        <div className="rounded-xl border border-warn/30 bg-warn-soft p-4 text-sm" role="alert">
          <p className="font-semibold text-warn">Someone updated this website in the Cloudflare dashboard</p>
          <p className="mt-1 text-soft">Work Hub’s copy is older than the live site, so Work Hub has paused publishing to avoid undoing that update. Upload the same files here, then client edits can go live again.</p>
        </div>
      )}
      {!site.cf_deployment_id && (
        <div className="rounded-xl bg-info-soft p-4 text-sm text-info">
          Upload this website’s files once to start. After that, client edits go live from here, and you can upload new versions any time.
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">Work Hub’s copy</p>
          <p className="text-sm text-muted">
            {files.length ? `${files.length} files · ${sizeText(total)}` : 'No files yet'}
            {site.cf_deployed_at ? ` · last published ${timeAgo(site.cf_deployed_at)}` : ''}
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <label className={`btn-primary cursor-pointer ${busy || !connected ? 'pointer-events-none opacity-50' : ''}`}>
              Upload folder
              {/* webkitdirectory lets you pick a whole folder */}
              <input type="file" className="sr-only" multiple disabled={busy || !connected}
                ref={(el) => { if (el) el.setAttribute('webkitdirectory', '') }} onChange={(e) => upload(e.target.files)} />
            </label>
            <label className={`btn-ghost cursor-pointer ${busy || !connected ? 'pointer-events-none opacity-50' : ''}`}>
              Upload .zip
              <input type="file" className="sr-only" accept=".zip,application/zip" disabled={busy || !connected} onChange={(e) => upload(e.target.files)} />
            </label>
          </div>
        )}
      </div>

      {progress && (
        <div aria-live="polite">
          <p className="text-sm text-soft">{progress.text}{progress.total > 1 ? ` · ${progress.done} of ${progress.total}` : '…'}</p>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-raised">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress.total ? Math.max(5, (progress.done / progress.total) * 100) : 5}%` }} />
          </div>
        </div>
      )}
      {error && <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}
      {result && (
        <div className="rounded-xl bg-success-soft px-4 py-3 text-sm text-success" role="status">
          <p>Published {result.files} files. The website updates in a minute or two.</p>
          <p className="mt-1 text-soft">
            Found {result.fields} editable parts on {result.pages} pages.
            {result.kept_edits_on.length > 0 && ` Client edits were kept where you didn’t change that part (${result.kept_edits_on.join(', ')}).`}
            {result.skipped.length > 0 && ` Skipped server code (${result.skipped.length} files) — not supported here.`}
          </p>
        </div>
      )}

      {isAdmin && (
        <p className="text-xs text-muted">
          Choose the folder that has <code>index.html</code> in it (or a .zip of it). Uploading here replaces Work Hub’s copy and publishes it.
          Client edits stay on parts you didn’t change, and Work Hub adds the editable markers back for you.
          Photos clients added through Work Hub are kept.
        </p>
      )}

      {files.length > 0 && (
        <div className="rounded-xl border border-line">
          <ul className="divide-y divide-line text-sm">
            {(showAll ? files : files.slice(0, 12)).map((f) => (
              <li key={f.path} className="flex justify-between gap-3 px-3 py-2">
                <span className="truncate font-mono text-xs">{f.path}{f.source !== 'site-files' && <span className="ml-2 font-sans text-muted">(client photo)</span>}</span>
                <span className="shrink-0 text-xs text-muted">{sizeText(Number(f.size))}</span>
              </li>
            ))}
          </ul>
          {files.length > 12 && <button className="w-full cursor-pointer border-t border-line p-2 text-xs text-accent-text hover:bg-hover" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show fewer' : `Show all ${files.length} files`}</button>}
        </div>
      )}
    </div>
  )
}
