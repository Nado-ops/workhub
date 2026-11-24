import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Claim, ClaimStatus, Client, Doc, DocKind, DocLine, DocTotals } from '../../lib/types'
import { rand, shortDate, todayISO } from '../../lib/format'
import { BUSINESS } from '../../lib/business'
import Tabs from '../../components/Tabs'
import { STATUS_TEXT, STATUS_TONE, docStatus } from '../../lib/finance'

type DocRow = Doc & { client: { name: string } | null }
type ClaimRow = Claim & { person: { full_name: string } | null; client: { name: string } | null }
type Tab = 'invoice' | 'quote' | 'claims'

/** Finance (admin only): quotes, invoices and staff claims. */
export default function Finance() {
  const [docs, setDocs] = useState<DocRow[]>([])
  const [totals, setTotals] = useState<Record<string, DocTotals>>({})
  const [claims, setClaims] = useState<ClaimRow[]>([])
  const [clients, setClients] = useState<Pick<Client, 'id' | 'name'>[]>([])
  const [tab, setTab] = useState<Tab>('invoice')
  const [builder, setBuilder] = useState<BuilderStart | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const [d, t, c] = await Promise.all([
      supabase.from('documents').select('*, client:clients(name)').order('created_at', { ascending: false }),
      supabase.from('document_totals').select('*'),
      supabase.from('claims').select('*, person:profiles(full_name), client:clients(name)').order('created_at', { ascending: false }),
    ])
    if (d.error) setError(d.error.message)
    setDocs((d.data as DocRow[] | null) ?? [])
    setTotals(Object.fromEntries(((t.data as DocTotals[] | null) ?? []).map((x) => [x.document_id, x])))
    setClaims((c.data as ClaimRow[] | null) ?? [])
  }
  useEffect(() => {
    load()
    supabase.from('clients').select('id, name').order('name').then(({ data }) => setClients(data ?? []))
  }, [])

  const total = (id: string) => Number(totals[id]?.total ?? 0)
  const invoices = docs.filter((d) => d.kind === 'invoice')
  const quotes = docs.filter((d) => d.kind === 'quote')
  const unpaid = invoices.filter((d) => d.status === 'sent')
  const overdue = unpaid.filter((d) => docStatus(d) === 'overdue')
  const openQuotes = quotes.filter((d) => d.status === 'sent')
  const monthStart = todayISO().slice(0, 8) + '01'
  const paidThisMonth = invoices.filter((d) => d.status === 'paid' && (d.paid_at ?? '') >= monthStart)
  const sum = (list: Doc[]) => list.reduce((s, d) => s + total(d.id), 0)

  async function act(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setError(null)
    const { error } = await fn()
    if (error) setError(error.message)
    else load()
  }

  async function convertToInvoice(q: DocRow) {
    setError(null)
    const { data: inv, error } = await supabase.from('documents').insert({
      kind: 'invoice', client_id: q.client_id, project_id: q.project_id, title: q.title, from_quote_id: q.id,
      include_vat: q.include_vat, vat_rate: q.vat_rate, due_date: todayISO(7),
    }).select('id').single()
    if (error) { setError(error.message); return }
    const { data: lines } = await supabase.from('document_lines').select('position, description, qty, unit_price').eq('document_id', q.id)
    if (lines?.length) await supabase.from('document_lines').insert(lines.map((l) => ({ ...l, document_id: inv.id })))
    await supabase.from('documents').update({ status: 'invoiced' }).eq('id', q.id)
    setTab('invoice')
    load()
  }

  async function editDraft(d: DocRow) {
    const { data } = await supabase.from('document_lines').select('*').eq('document_id', d.id).order('position')
    setBuilder({ doc: d, lines: (data as DocLine[] | null) ?? [] })
  }

  const shown = tab === 'invoice' ? invoices : quotes

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <h1 className="text-2xl font-semibold">Finance</h1>
          <p className="mt-1 text-sm text-muted">Quotes, invoices and staff claims. Only admins can see this page.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => setBuilder({ kind: 'quote' })}>+ New quote</button>
          <button className="btn-primary" onClick={() => setBuilder({ kind: 'invoice' })}>+ New invoice</button>
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
        <Kpi label="Waiting to be paid" value={rand(sum(unpaid))} sub={`${unpaid.length} invoices`} />
        <Kpi label="Overdue" value={rand(sum(overdue))} sub={overdue.map((d) => d.client?.name).filter(Boolean).slice(0, 2).join(', ') || 'None'} danger={overdue.length > 0} />
        <Kpi label="Quotes waiting for a yes" value={rand(sum(openQuotes))} sub={`${openQuotes.length} sent`} />
        <Kpi label="Paid this month" value={rand(sum(paidThisMonth))} sub={`${paidThisMonth.length} invoices`} />
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {builder && (
        <DocBuilder
          key={builder.doc?.id ?? builder.kind}
          start={builder}
          clients={clients}
          onDone={() => { setBuilder(null); load() }}
          onClose={() => setBuilder(null)}
        />
      )}

      <section className="card overflow-hidden">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'invoice', label: 'Invoices', count: invoices.length },
            { key: 'quote', label: 'Quotes', count: quotes.length },
            { key: 'claims', label: 'Claims', count: claims.filter((c) => c.status === 'waiting').length + ' new' },
          ]}
        />

        {tab !== 'claims' && (
          shown.length === 0 ? <p className="p-5 text-sm text-muted">Nothing here yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse">
                <thead><tr><th className="th">Number</th><th className="th">Client</th><th className="th">For</th><th className="th">Amount</th><th className="th">Status</th><th className="th"></th></tr></thead>
                <tbody>
                  {shown.map((d) => {
                    const s = docStatus(d)
                    return (
                      <tr key={d.id}>
                        <td className="td text-soft">{d.number}</td>
                        <td className="td">{d.client?.name}</td>
                        <td className="td text-soft">{d.title || '—'}<p className="text-xs text-muted">{d.kind === 'invoice' ? 'Due' : 'Valid until'} {shortDate(d.due_date)}</p></td>
                        <td className="td font-semibold">{rand(total(d.id))}</td>
                        <td className="td"><span className={`pill ${STATUS_TONE[s]}`}>● {STATUS_TEXT[s]}</span></td>
                        <td className="td">
                          <div className="flex flex-wrap justify-end gap-2">
                            {d.status === 'draft' && (
                              <>
                                <button className="btn-ghost h-8 px-3 text-xs" onClick={() => editDraft(d)}>Edit</button>
                                <button className="btn-ghost h-8 px-3 text-xs" onClick={() => act(() => supabase.from('documents').delete().eq('id', d.id))}>Delete</button>
                                <button className="btn-primary h-8 px-3 text-xs" onClick={() => act(() => supabase.from('documents').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', d.id))}>Send to client</button>
                              </>
                            )}
                            {d.kind === 'invoice' && d.status === 'sent' && (
                              <button className="btn-ghost h-8 px-3 text-xs text-accent" onClick={() => act(() => supabase.from('documents').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', d.id))}>Mark paid</button>
                            )}
                            {d.kind === 'quote' && d.status === 'accepted' && (
                              <button className="btn-primary h-8 px-3 text-xs" onClick={() => convertToInvoice(d)}>Turn into invoice</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        )}

        {tab === 'claims' && <ClaimsTable claims={claims} onChange={load} onError={setError} />}
      </section>
    </div>
  )
}

function Kpi({ label, value, sub, danger }: { label: string; value: string; sub: string; danger?: boolean }) {
  return (
    <div className={`card p-4 ${danger ? 'border-[#4A2326] bg-[#1F1213]' : ''}`}>
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold ${danger ? 'text-danger' : ''}`}>{value}</p>
      <p className="mt-1 text-xs text-soft">{sub}</p>
    </div>
  )
}

function ClaimsTable({ claims, onChange, onError }: { claims: ClaimRow[]; onChange: () => void; onError: (m: string) => void }) {
  async function setStatus(c: ClaimRow, status: ClaimStatus) {
    const { error } = await supabase.from('claims').update({ status }).eq('id', c.id)
    if (error) onError(error.message)
    else onChange()
  }
  const tone: Record<ClaimStatus, string> = { waiting: 'bg-[#3A2A10] text-warn', approved: 'bg-[#182640] text-info', paid_back: 'bg-[#123330] text-accent', declined: 'bg-[#16282B] text-muted' }
  const text: Record<ClaimStatus, string> = { waiting: 'Waiting', approved: 'Approved', paid_back: 'Paid back', declined: 'Declined' }
  const waiting = claims.filter((c) => c.status === 'waiting').reduce((s, c) => s + Number(c.amount), 0)
  const owed = claims.filter((c) => c.status === 'approved').reduce((s, c) => s + Number(c.amount), 0)

  return (
    <>
      <p className="flex flex-wrap gap-x-5 gap-y-1 px-5 pt-4 pb-1 text-sm text-soft">
        <span>To approve: <b className="text-warn">{rand(waiting)}</b></span>
        <span>To pay back: <b className="text-text">{rand(owed)}</b></span>
        <span className="text-muted">Staff submit claims from My HR → My claims.</span>
      </p>
      {claims.length === 0 ? <p className="p-5 text-sm text-muted">No claims yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse">
            <thead><tr><th className="th">Who</th><th className="th">For</th><th className="th">Bill to</th><th className="th">Amount</th><th className="th">Status</th><th className="th"></th></tr></thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id}>
                  <td className="td">{c.person?.full_name || '—'}</td>
                  <td className="td">{c.description}<p className="text-xs text-muted">{c.category} · {shortDate(c.created_at)}</p></td>
                  <td className="td text-soft">{c.client?.name ?? 'Internal'}</td>
                  <td className="td font-semibold">{rand(Number(c.amount))}</td>
                  <td className="td"><span className={`pill ${tone[c.status]}`}>● {text[c.status]}</span></td>
                  <td className="td">
                    <div className="flex justify-end gap-2">
                      {c.status === 'waiting' && (
                        <>
                          <button className="btn-ghost h-8 px-3 text-xs" onClick={() => setStatus(c, 'declined')}>Decline</button>
                          <button className="btn-primary h-8 px-3 text-xs" onClick={() => setStatus(c, 'approved')}>Approve</button>
                        </>
                      )}
                      {c.status === 'approved' && <button className="btn-ghost h-8 px-3 text-xs text-accent" onClick={() => setStatus(c, 'paid_back')}>Mark paid back</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

interface BuilderStart { kind?: DocKind; doc?: DocRow; lines?: DocLine[] }
interface EditLine { key: number; description: string; qty: string; unit_price: string }

/** Create or edit a quote / invoice, with a live preview of what the client will see. */
function DocBuilder({
  start, clients, onDone, onClose,
}: { start: BuilderStart; clients: Pick<Client, 'id' | 'name'>[]; onDone: () => void; onClose: () => void }) {
  const editing = start.doc ?? null
  const [kind, setKind] = useState<DocKind>(editing?.kind ?? start.kind ?? 'invoice')
  const [clientId, setClientId] = useState(editing?.client_id ?? '')
  const [title, setTitle] = useState(editing?.title ?? '')
  const [dueDate, setDueDate] = useState(editing?.due_date ?? todayISO(7))
  const [vat, setVat] = useState(editing?.include_vat ?? true)
  const [lines, setLines] = useState<EditLine[]>(
    start.lines?.length
      ? start.lines.map((l, i) => ({ key: i, description: l.description, qty: String(l.qty), unit_price: String(l.unit_price) }))
      : [{ key: 0, description: '', qty: '1', unit_price: '' }],
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const num = (v: string) => Number(v.replace(',', '.')) || 0
  const subtotal = lines.reduce((s, l) => s + num(l.qty) * num(l.unit_price), 0)
  const vatAmount = vat ? Math.round(subtotal * 0.15 * 100) / 100 : 0
  const clientName = clients.find((c) => c.id === clientId)?.name ?? 'Choose a client'
  const setLine = (key: number, field: keyof EditLine, value: string) =>
    setLines((cur) => cur.map((l) => (l.key === key ? { ...l, [field]: value } : l)))

  async function save(send: boolean) {
    if (!clientId) { setError('Choose a client first.'); return }
    const clean = lines.filter((l) => l.description.trim())
    if (clean.length === 0) { setError('Add at least one item.'); return }
    setBusy(true)
    setError(null)
    const docRow = {
      kind, client_id: clientId, title: title.trim() || clean[0].description.trim(), due_date: dueDate || null, include_vat: vat,
      ...(send ? { status: 'sent' as const, sent_at: new Date().toISOString() } : {}),
    }
    let id = editing?.id
    if (editing) {
      const { error } = await supabase.from('documents').update(docRow).eq('id', editing.id)
      if (error) { setBusy(false); setError(error.message); return }
      await supabase.from('document_lines').delete().eq('document_id', editing.id)
    } else {
      const { data, error } = await supabase.from('documents').insert(docRow).select('id').single()
      if (error) { setBusy(false); setError(error.message); return }
      id = data.id
    }
    const { error } = await supabase.from('document_lines').insert(
      clean.map((l, i) => ({ document_id: id, position: i, description: l.description.trim(), qty: num(l.qty), unit_price: num(l.unit_price) })),
    )
    setBusy(false)
    if (error) setError(error.message)
    else onDone()
  }

  const seg = (on: boolean) => `h-8 cursor-pointer rounded-lg px-3.5 text-sm ${on ? 'bg-[#16282B] font-semibold text-text' : 'text-muted'}`

  return (
    <div className="flex flex-wrap items-start gap-4">
      <section aria-label="Create document" className="card flex min-w-0 flex-[1.2_1_460px] flex-col gap-3.5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{editing ? `Edit ${editing.number}` : `New ${kind}`}</h2>
          <div className="flex items-center gap-2">
            {!editing && (
              <div role="group" aria-label="Document type" className="flex gap-1 rounded-xl bg-well p-1">
                <button aria-pressed={kind === 'quote'} className={seg(kind === 'quote')} onClick={() => setKind('quote')}>Quote</button>
                <button aria-pressed={kind === 'invoice'} className={seg(kind === 'invoice')} onClick={() => setKind('invoice')}>Invoice</button>
              </div>
            )}
            <button className="btn-ghost h-9" onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <label className="label flex-[2_1_200px]">Client
            <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Choose…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="label flex-[1_1_150px]">{kind === 'invoice' ? 'Payment due' : 'Valid until'}
            <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          <label className="label basis-full">Title (optional)
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Homepage redesign — 50% deposit" />
          </label>
        </div>
        <p className="text-xs text-muted">Sending puts it in this client's portal under Quotes &amp; invoices. Only people from this client can see it.</p>

        <div className="grid grid-cols-[minmax(160px,1fr)_64px_110px_100px_36px] gap-2 text-[11px] tracking-widest text-muted">
          <span>ITEM</span><span>QTY</span><span>PRICE (R)</span><span className="text-right">TOTAL</span><span />
        </div>
        {lines.map((l) => (
          <div key={l.key} className="grid grid-cols-[minmax(160px,1fr)_64px_110px_100px_36px] items-center gap-2">
            <input aria-label="Item" className="input h-10 min-w-0" value={l.description} onChange={(e) => setLine(l.key, 'description', e.target.value)} placeholder="What is it for?" />
            <input aria-label="Quantity" className="input h-10 min-w-0 px-2" inputMode="decimal" value={l.qty} onChange={(e) => setLine(l.key, 'qty', e.target.value)} />
            <input aria-label="Price" className="input h-10 min-w-0 px-2" inputMode="decimal" value={l.unit_price} onChange={(e) => setLine(l.key, 'unit_price', e.target.value)} />
            <span className="text-right text-sm font-semibold">{rand(num(l.qty) * num(l.unit_price))}</span>
            <button aria-label="Remove item" className="h-9 w-9 cursor-pointer rounded-lg text-muted hover:text-text" onClick={() => setLines((cur) => cur.filter((x) => x.key !== l.key))}>✕</button>
          </div>
        ))}
        <button
          className="btn h-9 w-fit border border-dashed border-[#3A5256] font-normal text-soft"
          onClick={() => setLines((cur) => [...cur, { key: Math.max(0, ...cur.map((x) => x.key)) + 1, description: '', qty: '1', unit_price: '' }])}
        >
          + Add item
        </button>

        <label className="flex items-center gap-2.5 text-sm text-soft">
          <input type="checkbox" className="h-4 w-4 accent-[#3FD0B5]" checked={vat} onChange={(e) => setVat(e.target.checked)} />
          Add VAT (15%) — turn off if you're not VAT-registered
        </label>
        <div className="grid gap-1.5 border-t border-line pt-3 text-sm">
          <div className="flex justify-between"><span className="text-soft">Subtotal</span><span>{rand(subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-soft">VAT</span><span>{rand(vatAmount)}</span></div>
          <div className="flex justify-between text-lg font-semibold"><span>Total</span><span>{rand(subtotal + vatAmount)}</span></div>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn-ghost" disabled={busy} onClick={() => save(false)}>Save draft</button>
          <button className="btn-primary" disabled={busy} onClick={() => save(true)}>Send {kind} to client</button>
        </div>
      </section>

      <section aria-label="Preview" className="flex min-w-0 flex-[1_1_360px] flex-col gap-3 rounded-2xl bg-[#F4F7F6] p-6 text-[#14201F]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs tracking-wider text-[#4E6366]">{BUSINESS.name}</p>
            <p className="mt-1 text-2xl font-bold">{kind === 'invoice' ? (BUSINESS.vatNumber && vat ? 'TAX INVOICE' : 'INVOICE') : 'QUOTE'}</p>
            <p className="text-xs text-[#4E6366]">{editing?.number ?? 'Number given when saved'} · {shortDate(todayISO())}</p>
          </div>
          <div className="text-right text-xs"><p className="text-[#4E6366]">For</p><b className="text-sm">{clientName}</b></div>
        </div>
        <div className="border-t border-[#DDE5E4]" />
        {lines.filter((l) => l.description.trim()).map((l) => (
          <div key={l.key} className="flex justify-between gap-3 text-sm">
            <span>{l.description} <span className="text-[#4E6366]">× {l.qty}</span></span>
            <b>{rand(num(l.qty) * num(l.unit_price))}</b>
          </div>
        ))}
        <div className="grid gap-1 border-t border-[#DDE5E4] pt-2.5 text-sm">
          <div className="flex justify-between"><span>Subtotal</span><span>{rand(subtotal)}</span></div>
          <div className="flex justify-between"><span>VAT</span><span>{rand(vatAmount)}</span></div>
          <div className="flex justify-between text-base font-bold"><span>Total</span><span>{rand(subtotal + vatAmount)}</span></div>
        </div>
        <p className="rounded-lg border border-[#DDE5E4] bg-white p-2.5 text-xs leading-relaxed text-[#2C3B3A]">
          {kind === 'invoice'
            ? `Please pay by EFT by ${shortDate(dueDate)}, using the invoice number as the reference. ${BUSINESS.bankDetails}`
            : `This quote is valid until ${shortDate(dueDate)}. You can accept it in your portal.`}
        </p>
      </section>
    </div>
  )
}
