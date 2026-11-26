import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import type { Doc, DocLine, DocTotals } from '../../lib/types'
import { rand, shortDate } from '../../lib/format'
import { STATUS_TEXT, STATUS_TONE, docStatus } from '../../lib/finance'
import { useBusiness } from '../../lib/business'
import { Link } from 'react-router-dom'

/** A client's quotes and invoices. Drafts never reach this page — the
 *  database only shows a client documents that have been sent. */
export default function ClientInvoices() {
  const [docs, setDocs] = useState<Doc[]>([])
  const [totals, setTotals] = useState<Record<string, DocTotals>>({})
  const [open, setOpen] = useState<string | null>(null)
  const business = useBusiness()
  const [lines, setLines] = useState<DocLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [thanks, setThanks] = useState<string | null>(null)

  async function load() {
    const [d, t] = await Promise.all([
      supabase.from('documents').select('*').order('issue_date', { ascending: false }),
      supabase.from('document_totals').select('*'),
    ])
    if (d.error) setError(d.error.message)
    setDocs((d.data as Doc[] | null) ?? [])
    setTotals(Object.fromEntries(((t.data as DocTotals[] | null) ?? []).map((x) => [x.document_id, x])))
  }
  useEffect(() => { load() }, [])

  async function toggle(id: string) {
    if (open === id) { setOpen(null); return }
    setOpen(id)
    const { data } = await supabase.from('document_lines').select('*').eq('document_id', id).order('position')
    setLines((data as DocLine[] | null) ?? [])
  }

  async function respond(q: Doc, accept: boolean) {
    const { error } = await supabase.rpc('respond_to_quote', { quote_id: q.id, accept })
    if (error) { setError(error.message); return }
    setThanks(accept ? `Thank you! ${q.number} is accepted. We'll send the invoice and get started.` : `${q.number} declined. We'll be in touch.`)
    load()
  }

  const total = (id: string) => Number(totals[id]?.total ?? 0)
  const quotes = docs.filter((d) => d.kind === 'quote')
  const invoices = docs.filter((d) => d.kind === 'invoice')
  const toPay = invoices.filter((d) => d.status === 'sent')
  const overdue = toPay.filter((d) => docStatus(d) === 'overdue')

  const Row = ({ d, actions }: { d: Doc; actions?: ReactNode }) => {
    const s = docStatus(d)
    return (
      <div className="border-t border-line">
        <div className="flex flex-wrap items-center gap-3 px-5 py-3.5">
          <button className="min-w-0 flex-[1_1_240px] cursor-pointer text-left" onClick={() => toggle(d.id)} aria-expanded={open === d.id}>
            <span className="block text-xs text-muted">{d.number} · {shortDate(d.issue_date)} · {d.kind === 'invoice' ? 'due' : 'valid until'} {shortDate(d.due_date)}</span>
            <span className="block font-medium">{d.title || (d.kind === 'quote' ? 'Quote' : 'Invoice')}</span>
          </button>
          <b>{rand(total(d.id))}</b>
          <span className={`pill ${STATUS_TONE[s]}`}>● {STATUS_TEXT[s]}</span>
          {actions}
        </div>
        {open === d.id && (
          <div className="mx-5 mb-4 rounded-xl bg-raised p-4 text-sm text-text">
            {lines.map((l) => (
              <div key={l.id} className="flex justify-between gap-3 py-0.5"><span>{l.description} <span className="text-muted">× {l.qty}</span></span><b>{rand(Number(l.qty) * Number(l.unit_price))}</b></div>
            ))}
            <div className="mt-2 grid gap-0.5 border-t border-line pt-2">
              <div className="flex justify-between"><span>Subtotal</span><span>{rand(Number(totals[d.id]?.subtotal ?? 0))}</span></div>
              <div className="flex justify-between"><span>VAT</span><span>{rand(Number(totals[d.id]?.vat ?? 0))}</span></div>
              <div className="flex justify-between font-bold"><span>Total</span><span>{rand(total(d.id))}</span></div>
            </div>
            {d.kind === 'invoice' && d.status !== 'paid' && (
              <p className="mt-3 text-xs text-soft">Pay by EFT using <b>{d.number}</b> as the reference. {business.bank_details}</p>
            )}
            <Link to={`/print/doc/${d.id}`} className="btn-ghost mt-3 h-9 px-3 text-xs no-underline">Download PDF</Link>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="pt-2">
        <h1 className="text-2xl font-semibold">Quotes &amp; invoices</h1>
        <p className="mt-1 text-sm text-muted">Your quotes and invoices from us. Tap one to see the details.</p>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {thanks && <p role="status" className="card border-success/30 bg-success-soft p-4 text-sm text-accent-text">{thanks}</p>}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
        <div className={`card p-4 ${overdue.length ? 'border-danger/30 bg-danger-soft' : ''}`}>
          <p className="text-sm text-muted">To pay</p>
          <p className="mt-1.5 text-2xl font-semibold">{rand(toPay.reduce((s, d) => s + total(d.id), 0))}</p>
          <p className="mt-1 text-xs text-soft">{overdue.length ? `${overdue.length} overdue` : toPay.length ? `${toPay.length} invoice(s)` : 'All paid up'}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-muted">Quotes waiting for you</p>
          <p className="mt-1.5 text-2xl font-semibold">{quotes.filter((q) => q.status === 'sent').length}</p>
        </div>
      </div>

      <section className="card overflow-hidden">
        <h2 className="px-5 pt-5 pb-3 text-lg font-semibold">Quotes</h2>
        {quotes.length === 0 && <p className="px-5 pb-5 text-sm text-muted">No quotes yet.</p>}
        {quotes.map((q) => (
          <Row
            key={q.id}
            d={q}
            actions={q.status === 'sent' && (
              <span className="flex gap-2">
                <button className="btn-ghost h-9" onClick={() => respond(q, false)}>Decline</button>
                <button className="btn-primary h-9" onClick={() => respond(q, true)}>Accept quote</button>
              </span>
            )}
          />
        ))}
      </section>

      <section className="card overflow-hidden">
        <h2 className="px-5 pt-5 pb-3 text-lg font-semibold">Invoices</h2>
        {invoices.length === 0 && <p className="px-5 pb-5 text-sm text-muted">No invoices yet.</p>}
        {invoices.map((d) => <Row key={d.id} d={d} />)}
      </section>
    </div>
  )
}
