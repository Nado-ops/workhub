import type { Doc } from './types'
import { todayISO } from './format'

/** Shows "Overdue" for sent invoices past their due date. */
export function docStatus(d: Doc) {
  if (d.kind === 'invoice' && d.status === 'sent' && d.due_date && d.due_date < todayISO()) return 'overdue'
  return d.status
}
export const STATUS_TEXT: Record<string, string> = {
  draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined', invoiced: 'Invoiced', paid: 'Paid', cancelled: 'Cancelled', overdue: 'Overdue',
}
export const STATUS_TONE: Record<string, string> = {
  draft: 'bg-[#16282B] text-soft', sent: 'bg-[#182640] text-info', accepted: 'bg-[#123330] text-accent', declined: 'bg-[#16282B] text-muted',
  invoiced: 'bg-[#16282B] text-muted', paid: 'bg-[#123330] text-accent', cancelled: 'bg-[#16282B] text-muted', overdue: 'bg-[#3A1618] text-danger',
}

