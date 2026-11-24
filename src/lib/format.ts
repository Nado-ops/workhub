import type { Priority, TicketStatus } from './types'

export const ticketRef = (id: number) => `TCK-${id}`

export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_on_client: 'Waiting on client',
  escalated: 'Escalated',
  resolved: 'Resolved',
  closed: 'Closed',
}

// What a client sees instead of our internal status names
export const CLIENT_STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Received',
  in_progress: 'In progress',
  waiting_on_client: 'Waiting for you',
  escalated: 'Top priority',
  resolved: 'Resolved',
  closed: 'Closed',
}

export const STATUS_STYLE: Record<TicketStatus, string> = {
  open: 'bg-[#182640] text-info',
  in_progress: 'bg-[#123330] text-accent',
  waiting_on_client: 'bg-[#16282B] text-soft',
  escalated: 'bg-[#3A1618] text-danger',
  resolved: 'bg-[#16282B] text-muted',
  closed: 'bg-[#16282B] text-muted',
}

export const PRIORITY_LABEL: Record<Priority, string> = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' }

export const PRIORITY_STYLE: Record<Priority, string> = {
  urgent: 'bg-[#3A1618] text-danger',
  high: 'bg-[#3A2A10] text-warn',
  normal: 'bg-[#16282B] text-soft',
  low: 'bg-[#16282B] text-muted',
}

export function timeAgo(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

export function formatDuration(totalMinutes: number) {
  const m = Math.max(0, Math.round(totalMinutes))
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}

/** The deadline clock: how long is left (or how late it is) and how risky that is. */
export function slaClock(dueAt: string | null, status: TicketStatus) {
  if (status === 'waiting_on_client') return { text: 'Paused', tone: 'text-muted', risk: 'paused' as const }
  if (status === 'resolved' || status === 'closed') return { text: 'Done', tone: 'text-muted', risk: 'done' as const }
  if (!dueAt) return { text: '—', tone: 'text-muted', risk: 'later' as const }
  const mins = (new Date(dueAt).getTime() - Date.now()) / 60000
  if (mins < 0) return { text: `Late by ${formatDuration(-mins)}`, tone: 'text-danger font-semibold', risk: 'breach' as const }
  if (mins <= 240) return { text: `${formatDuration(mins)} left`, tone: 'text-warn font-semibold', risk: 'soon' as const }
  if (mins <= 24 * 60) return { text: `${formatDuration(mins)} left`, tone: 'text-[#E8D77A]', risk: 'today' as const }
  return { text: `${Math.round(mins / 1440)} days left`, tone: 'text-soft', risk: 'later' as const }
}

export const rand = (n: number) =>
  'R' + n.toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
