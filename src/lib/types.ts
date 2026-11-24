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
