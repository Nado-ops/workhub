import { useEffect, useRef, useState } from 'react'
import { cleanRichText } from '../../lib/richtext'
import { imageUrl, parseJson, uploadPreview, uploadSiteImage, type ImageValue, type LinkValue, type Site, type SiteField } from '../../lib/cms'

/**
 * Edit one part of a web page. Calls onSave(newValue) — the page decides whether that publishes
 * straight away or waits for approval.
 */
export default function FieldEditor({ site, field, pending, busy, onSave }: {
  site: Site
  field: SiteField
  pending?: boolean            // there's already a change waiting for this field
  busy?: boolean
  onSave: (value: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const label = field.label || field.key

  return (
    <article className="rounded-xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-xs font-semibold tracking-wider text-muted uppercase">{label}</p>
        {pending && <span className="pill bg-warn-soft text-warn">Change waiting</span>}
      </div>
      {editing ? (
        <Editor site={site} field={field} busy={busy} onCancel={() => setEditing(false)} onSave={(v) => { onSave(v); setEditing(false) }} />
      ) : (
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 flex-1"><ValueView site={site} type={field.type} value={field.value} /></div>
          <button className="btn-ghost h-9 px-3 text-sm" onClick={() => setEditing(true)} disabled={busy}>Edit</button>
        </div>
      )}
    </article>
  )
}

function Editor({ site, field, busy, onSave, onCancel }: { site: Site; field: SiteField; busy?: boolean; onSave: (v: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(field.type === 'text' ? field.value ?? '' : '')
  const [img, setImg] = useState<ImageValue>(parseJson(field.value, { src: '', alt: '' }))
  const [link, setLink] = useState<LinkValue>(parseJson(field.value, { href: '', text: '' }))
  const rich = useRef<HTMLDivElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (field.type === 'richtext' && rich.current) rich.current.innerHTML = cleanRichText(field.value ?? '')
  }, [field])

  async function pickPhoto(file: File | undefined) {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) return setError('Please choose a photo under 10 MB.')
    setUploading(true); setError(null)
    try { const v = await uploadSiteImage(site.id, file); setImg({ ...v, alt: img.alt }) }
    catch (e) { setError(e instanceof Error ? e.message : 'Upload failed') }
    setUploading(false)
  }

  function save() {
    if (field.type === 'text') return onSave(text.trim())
    if (field.type === 'richtext') return onSave(cleanRichText(rich.current?.innerHTML ?? ''))
    if (field.type === 'image') return onSave(JSON.stringify(img))
    return onSave(JSON.stringify({ href: link.href.trim(), text: link.text.trim() }))
  }

  // Simple formatting buttons for rich text (bold, italic, list, link).
  const format = (cmd: string, arg?: string) => { rich.current?.focus(); document.execCommand(cmd, false, arg) }

  return (
    <div className="mt-3 flex flex-col gap-3">
      {field.type === 'text' && (
        (field.value ?? '').length > 70
          ? <textarea className="input h-24 py-2" value={text} onChange={(e) => setText(e.target.value)} aria-label="New text" />
          : <input className="input" value={text} onChange={(e) => setText(e.target.value)} aria-label="New text" />
      )}

      {field.type === 'richtext' && (
        <div className="overflow-hidden rounded-xl border border-line-2">
          <div className="flex gap-1 border-b border-line bg-raised p-1.5" role="toolbar" aria-label="Formatting">
            <ToolButton label="Bold" onClick={() => format('bold')}><b>B</b></ToolButton>
            <ToolButton label="Italic" onClick={() => format('italic')}><i>I</i></ToolButton>
            <ToolButton label="Bullet list" onClick={() => format('insertUnorderedList')}>• List</ToolButton>
            <ToolButton label="Add link" onClick={() => { const u = window.prompt('Link address (https://…)'); if (u) format('createLink', u) }}>🔗 Link</ToolButton>
            <ToolButton label="Remove formatting" onClick={() => format('removeFormat')}>Clear</ToolButton>
          </div>
          <div ref={rich} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label="New text"
            className="min-h-24 bg-well p-3 text-sm leading-6 outline-none [&_a]:text-accent-text [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5" />
        </div>
      )}

      {field.type === 'image' && (
        <div className="flex flex-wrap items-start gap-4">
          <ImagePreview site={site} value={img} className="h-32 w-48" />
          <div className="flex min-w-[220px] flex-1 flex-col gap-2">
            <label className="btn-ghost w-fit cursor-pointer">
              {uploading ? 'Uploading…' : 'Choose a new photo'}
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={(e) => pickPhoto(e.target.files?.[0])} />
            </label>
            <label className="label">Describe the photo (for screen readers and Google)
              <input className="input" value={img.alt} onChange={(e) => setImg({ ...img, alt: e.target.value })} placeholder="Our reception area" />
            </label>
          </div>
        </div>
      )}

      {field.type === 'link' && (
        <div className="flex flex-wrap gap-3">
          <label className="label flex-[1_1_180px]">Button text<input className="input" value={link.text} onChange={(e) => setLink({ ...link, text: e.target.value })} /></label>
          <label className="label flex-[2_1_240px]">Goes to<input className="input" value={link.href} onChange={(e) => setLink({ ...link, href: e.target.value })} placeholder="https://… or /contact" /></label>
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary h-10" onClick={save} disabled={busy || uploading}>Save</button>
        <button className="btn-ghost h-10" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

const ToolButton = ({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) => (
  // onMouseDown + preventDefault keeps the text selected while you click the button
  <button type="button" aria-label={label} title={label} className="h-8 cursor-pointer rounded-lg px-2.5 text-sm hover:bg-hover"
    onMouseDown={(e) => { e.preventDefault(); onClick() }}>{children}</button>
)

/** Show a value read-only: text, formatted text, a photo or a button. */
export function ValueView({ site, type, value }: { site: Site; type: SiteField['type']; value: string | null }) {
  if (type === 'image') return <ImagePreview site={site} value={parseJson<ImageValue>(value, { src: '', alt: '' })} className="h-24 w-40" />
  if (type === 'link') {
    const v = parseJson<LinkValue>(value, { href: '', text: '' })
    return <p className="text-sm"><span className="pill bg-accent-soft text-accent-text">{v.text || '—'}</span> <span className="text-xs text-muted">→ {v.href || '—'}</span></p>
  }
  if (type === 'richtext') {
    return <div className="text-sm leading-6 text-soft [&_a]:text-accent-text [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5"
      dangerouslySetInnerHTML={{ __html: cleanRichText(value ?? '') || '<span>—</span>' }} />
  }
  return <p className="text-sm font-medium">{value || '—'}</p>
}

function ImagePreview({ site, value, className }: { site: Site; value: ImageValue; className: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    // A new upload isn't on the website yet, so show it from Work Hub's private storage.
    if (value.upload) uploadPreview(value.upload).then(setSrc)
    else setSrc(value.src ? imageUrl(site, value.src) : '')
  }, [site, value.src, value.upload])
  return src
    ? <img src={src} alt={value.alt} className={`${className} rounded-lg border border-line bg-raised object-cover`} />
    : <div className={`${className} grid place-items-center rounded-lg border border-dashed border-line-2 text-xs text-muted`}>No photo</div>
}
