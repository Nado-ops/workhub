// Shapes of the rows we read from Supabase.
// They mirror the tables in supabase/migrations/001_work_hub_schema.sql.

export type Role = 'admin' | 'staff' | 'client'
export type Priority = 'low' | 'normal' | 'high' | 'urgent'
export type TicketStatus = 'open' | 'in_progress' | 'waiting_on_client' | 'escalated' | 'resolved' | 'closed'

export interface Profile {
  id: string
  email: string | null
  full_name: string
  job_title: string | null
  role: Role
  client_id: string | null
}

export interface Client {
  id: string
  name: string
  plan: string | null
  monthly_fee: number | null
  support_hours_per_month: number | null
  notes: string | null
  created_at: string
}

export interface Ticket {
  id: number
  client_id: string
  project_id: string | null
  title: string
  description: string | null
  priority: Priority
  status: TicketStatus
  assignee_id: string | null
  created_by: string | null
  due_at: string | null
  created_at: string
  updated_at: string
}

export interface TicketMessage {
  id: string
  ticket_id: number
  author_id: string | null
  body: string
  is_internal: boolean
  created_at: string
}

export interface RemoteSession {
  id: string
  ticket_id: number | null
  client_id: string
  user_id: string
  tool: string
  started_at: string
  ended_at: string | null
  note: string | null
}

export type ProjectPhase = 'plan' | 'design' | 'build' | 'launch'
export type ProjectStatus = 'active' | 'on_hold' | 'done'
export type Decision = 'waiting' | 'approved' | 'declined'

export interface Project {
  id: string
  client_id: string | null
  name: string
  type: string | null
  phase: ProjectPhase
  progress: number
  status: ProjectStatus
  budget: number | null
  quoted_hours: number | null
  due_date: string | null
  waiting_on_client: boolean
  created_at: string
}

export interface Extra {
  id: string
  project_id: string | null
  client_id: string
  name: string
  note: string | null
  amount: number
  status: Decision
  decided_at: string | null
  created_at: string
}

export type DocKind = 'quote' | 'invoice'
export type DocStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'invoiced' | 'paid' | 'cancelled'

export interface Doc {
  id: string
  kind: DocKind
  number: string | null
  client_id: string
  project_id: string | null
  title: string | null
  status: DocStatus
  issue_date: string
  due_date: string | null
  include_vat: boolean
  vat_rate: number
  from_quote_id: string | null
  sent_at: string | null
  paid_at: string | null
  created_at: string
}

export interface DocLine {
  id?: string
  document_id?: string
  position: number
  description: string
  qty: number
  unit_price: number
}

export interface DocTotals { document_id: string; subtotal: number; vat: number; total: number }

export type ClaimStatus = 'waiting' | 'approved' | 'declined' | 'paid_back'

export interface Claim {
  id: string
  user_id: string
  client_id: string | null
  description: string
  category: string
  amount: number
  receipt_path: string | null
  status: ClaimStatus
  billed_invoice_id: string | null
  created_at: string
}
