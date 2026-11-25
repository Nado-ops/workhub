import { useEffect, useState } from 'react'
import { ACCEPT, displayName, listFiles, openFile, uploadFile } from '../lib/files'

/** Screenshots and PDFs attached to a ticket. Used by the team and by clients. */
export default function TicketFiles({ ticketId }: { ticketId: number }) {
  const [files, setFiles] = useState<{ name: string; path: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setFiles(await listFiles('ticket-files', String(ticketId)))
  }
  useEffect(() => { load() }, [ticketId])

  async function add(list: FileList | null) {
    if (!list?.length) return
    setBusy(true)
    setError(null)
    try {
      for (const f of Array.from(list)) await uploadFile('ticket-files', String(ticketId), f)
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] tracking-widest text-muted">ATTACHMENTS</p>
        <label className="btn h-8 cursor-pointer border border-dashed border-line-2 px-3 text-xs font-normal text-soft">
          {busy ? 'Uploading…' : '+ Add screenshot or PDF'}
          <input type="file" accept={ACCEPT} multiple className="sr-only" disabled={busy} onChange={(e) => { add(e.target.files); e.target.value = '' }} />
        </label>
      </div>
      {files.length === 0 && <p className="text-xs text-muted">No files yet.</p>}
      {files.map((f) => (
        <button key={f.path} onClick={() => openFile('ticket-files', f.path)} className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-line bg-well px-3 py-2 text-left text-sm text-soft hover:text-text">
          <span className="truncate">{displayName(f.path)}</span>
          <span className="shrink-0 text-xs text-accent-text">Open</span>
        </button>
      ))}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  )
}
