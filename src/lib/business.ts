import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Your business details now live in the database (migration 009) and are edited in the app:
// Team & settings → Business details. They're printed on quotes, invoices and reports.
export interface Business {
  name: string
  email: string | null
  phone: string | null
  address: string | null
  vat_number: string | null
  bank_details: string | null
  invoice_note: string | null
}

const EMPTY: Business = { name: '', email: null, phone: null, address: null, vat_number: null, bank_details: null, invoice_note: null }

/** Loads the business details once per page. */
export function useBusiness() {
  const [business, setBusiness] = useState<Business>(EMPTY)
  useEffect(() => {
    supabase.from('business_profile').select('*').maybeSingle()
      .then(({ data }) => { if (data) setBusiness(data as Business) })
  }, [])
  return business
}

/** "email · phone" on one line, skipping empty parts. */
export const contactLine = (b: Business) => [b.email, b.phone].filter(Boolean).join(' · ')

// Leave allowance per year, used for the balances on HR & people.
// Set these to match your own leave policy.
export const LEAVE_POLICY = {
  annualDaysPerYear: 15,
}
