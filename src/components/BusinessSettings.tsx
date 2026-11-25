import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { Business } from '../lib/business'

/** Admin: the business details printed on quotes, invoices and monthly reports (migration 009). */
export default function BusinessSettings() {
  const [b, setB] = useState<Business | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('business_profile').select('*').maybeSingle().then(({ data }) => setB(data as Business | null))
  }, [])
  if (!b) return null

  const set = (k: keyof Business, v: string) => { setB({ ...b, [k]: v }); setSaved(false) }
  async function save(e: FormEvent) {
    e.preventDefault()
    if (!b) return
    const { error } = await supabase.from('business_profile').update({
      name: b.name.trim(), email: b.email?.trim() || null, phone: b.phone?.trim() || null, address: b.address?.trim() || null,
      vat_number: b.vat_number?.trim() || null, bank_details: b.bank_details?.trim() || null, invoice_note: b.invoice_note?.trim() || null,
    }).eq('id', true)
    if (error) setError(error.message)
    else { setError(null); setSaved(true) }
  }

  return (
    <form onSubmit={save} className="card flex flex-wrap items-end gap-3 p-5">
      <div className="basis-full">
        <h2 className="text-lg font-semibold">Business details</h2>
        <p className="text-sm text-muted">Printed on your quotes, invoices and monthly reports.</p>
      </div>
      <label className="label flex-[2_1_220px]">Business name<input className="input" required value={b.name} onChange={(e) => set('name', e.target.value)} /></label>
      <label className="label flex-[2_1_220px]">Email<input className="input" type="email" value={b.email ?? ''} onChange={(e) => set('email', e.target.value)} /></label>
      <label className="label flex-[1_1_160px]">Phone<input className="input" type="tel" value={b.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></label>
      <label className="label flex-[1_1_160px]">VAT number<input className="input" value={b.vat_number ?? ''} onChange={(e) => set('vat_number', e.target.value)} placeholder="Leave empty if not VAT-registered" /></label>
      <label className="label flex-[2_1_260px]">Address<textarea className="input h-20 py-2" value={b.address ?? ''} onChange={(e) => set('address', e.target.value)} /></label>
      <label className="label flex-[2_1_260px]">Bank details (for invoices)<textarea className="input h-20 py-2" value={b.bank_details ?? ''} onChange={(e) => set('bank_details', e.target.value)} placeholder={'Bank · Account name\nAccount number · Branch code'} /></label>
      <label className="label basis-full">Note at the bottom of invoices (optional)<input className="input" value={b.invoice_note ?? ''} onChange={(e) => set('invoice_note', e.target.value)} placeholder="Thank you! Payment terms: 14 days." /></label>
      <button className="btn-primary">Save details</button>
      {saved && <span className="text-sm text-success">Saved</span>}
      {error && <p className="basis-full text-sm text-danger">{error}</p>}
    </form>
  )
}
