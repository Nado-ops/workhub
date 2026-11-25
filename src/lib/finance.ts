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
  draft: 'bg-raised text-soft', sent: 'bg-info-soft text-info', accepted: 'bg-success-soft text-success', declined: 'bg-raised text-muted',
  invoiced: 'bg-raised text-muted', paid: 'bg-success-soft text-success', cancelled: 'bg-raised text-muted', overdue: 'bg-danger-soft text-danger',
}

