import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useBusiness, contactLine } from '../lib/business'
import { rand, shortDate } from '../lib/format'
import PrintBar from '../components/PrintBar'

interface Doc {
  id: string
  kind: 'quote' | 'invoice'
  number: string | null
  title: string | null
  status: string
  issue_date: string
  due_date: string | null
  include_vat: boolean
  vat_rate: number
  client: { name: string; billing_details: string | null } | null
}
interface Line { id: string; description: string; qty: number; unit_price: number }
interface Totals { subtotal: number; vat: number; total: number }

/**
 * A quote or invoice laid out as an A4 page. "Download PDF" opens the browser's print window,
 * where you choose "Save as PDF" (works on computers and phones, no extra software).
 * Admins can open any document; clients only their own sent ones (the database rules decide).
 */
export default function PrintDocument() {
  const { id } = useParams()
  const { profile } = useAuth()
  const business = useBusiness()
  const [doc, setDoc] = useState<Doc | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    if (!id) return
    Promise.all([
      supabase.from('documents').select('*, client:clients(name, billing_details)').eq('id', id).maybeSingle(),
      supabase.from('document_lines').select('*').eq('document_id', id).order('position'),
      supabase.from('document_totals').select('*').eq('document_id', id).maybeSingle(),
    ]).then(([d, l, t]) => {
      if (!d.data) return setMissing(true)
      setDoc(d.data as Doc)
      setLines((l.data as Line[] | null) ?? [])
      setTotals(t.data as Totals | null)
    })
  }, [id])

  // Name the PDF file after the document, e.g. "INV-0143 Harbour Dental".
  useEffect(() => {
    if (doc) document.title = `${doc.number ?? (doc.kind === 'quote' ? 'Quote' : 'Invoice')} ${doc.client?.name ?? ''}`.trim()
    return () => { document.title = 'Work Hub' }
  }, [doc])

  const back = profile?.role === 'client' ? '/portal/invoices' : '/app/finance'
  if (missing) return <p className="p-10 text-center text-muted">This document isn't available. <Link to={back} className="text-accent-text">Go back</Link></p>
  if (!doc) return <p className="p-10 text-center text-muted">Loading…</p>

  const isInvoice = doc.kind === 'invoice'
  const heading = isInvoice ? (business.vat_number && doc.include_vat ? 'TAX INVOICE' : 'INVOICE') : 'QUOTE'

  return (
    <div className="min-h-screen bg-ink print:bg-white">
      <PrintBar back={back} />
      <main className="print-page mx-auto my-6 w-full max-w-[210mm] bg-white px-[14mm] py-[14mm] text-[13px] text-text shadow-sm print:my-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6">
          <div>
            <img src="/logo-wordmark.png" alt="Work Hub" className="h-9 w-auto" />
            <p className="mt-3 font-semibold">{business.name}</p>
            {business.address && <p className="whitespace-pre-line text-soft">{business.address}</p>}
            {contactLine(business) && <p className="text-soft">{contactLine(business)}</p>}
            {business.vat_number && <p className="text-soft">VAT no. {business.vat_number}</p>}
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold tracking-wide">{heading}</p>
            <p className="mt-1 font-semibold">{doc.number}</p>
            <p className="text-soft">Date: {shortDate(doc.issue_date)}</p>
            {doc.due_date && <p className="text-soft">{isInvoice ? 'Due' : 'Valid until'}: {shortDate(doc.due_date)}</p>}
          </div>
        </header>

        <section className="mt-8 flex flex-wrap justify-between gap-6">
          <div>
            <p className="text-[11px] font-semibold tracking-widest text-muted uppercase">{isInvoice ? 'Bill to' : 'Prepared for'}</p>
            <p className="mt-1 font-semibold">{doc.client?.name}</p>
            {doc.client?.billing_details && <p className="whitespace-pre-line text-soft">{doc.client.billing_details}</p>}
          </div>
          {doc.title && (
            <div className="text-right">
              <p className="text-[11px] font-semibold tracking-widest text-muted uppercase">For</p>
              <p className="mt-1">{doc.title}</p>
            </div>
          )}
        </section>

        <table className="mt-8 w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-text text-left text-[11px] tracking-widest text-muted uppercase">
              <th className="py-2 font-semibold">Description</th>
              <th className="py-2 text-right font-semibold">Qty</th>
              <th className="py-2 text-right font-semibold">Price</th>
              <th className="py-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-line align-top">
                <td className="py-2.5 pr-4">{l.description}</td>
                <td className="py-2.5 text-right">{Number(l.qty)}</td>
                <td className="py-2.5 text-right">{rand(Number(l.unit_price))}</td>
                <td className="py-2.5 text-right">{rand(Number(l.qty) * Number(l.unit_price))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 ml-auto w-full max-w-[260px] text-sm">
          <div className="flex justify-between py-1"><span className="text-soft">Subtotal</span><span>{rand(Number(totals?.subtotal ?? 0))}</span></div>
          {doc.include_vat && <div className="flex justify-between py-1"><span className="text-soft">VAT ({Math.round(Number(doc.vat_rate) * 100)}%)</span><span>{rand(Number(totals?.vat ?? 0))}</span></div>}
          <div className="mt-1 flex justify-between border-t-2 border-text py-2 text-base font-bold"><span>Total</span><span>{rand(Number(totals?.total ?? 0))}</span></div>
        </div>

        <footer className="mt-10 rounded-lg border border-line p-4 text-xs leading-relaxed text-soft">
          {isInvoice ? (
            <>
              <p className="font-semibold text-text">How to pay</p>
              <p>Please pay by EFT{doc.due_date ? ` by ${shortDate(doc.due_date)}` : ''}, using <b>{doc.number}</b> as the reference.</p>
              {business.bank_details && <p className="mt-1 whitespace-pre-line">{business.bank_details}</p>}
            </>
          ) : (
            <p>This quote is valid{doc.due_date ? ` until ${shortDate(doc.due_date)}` : ''}. You can accept it in your Work Hub portal.</p>
          )}
          {business.invoice_note && <p className="mt-2 whitespace-pre-line">{business.invoice_note}</p>}
        </footer>
        <p className="mt-6 text-center text-[11px] text-muted">Thank you for your business.</p>
      </main>
    </div>
  )
}
