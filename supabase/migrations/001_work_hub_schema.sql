-- =====================================================================
-- Work Hub — database setup (step 1)
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run once on a NEW, empty project.
--
-- What it creates:
--   • 3 roles: admin, staff, client
--   • profiles (one per login) + a trigger that creates it on sign-up
--   • clients, projects, extras
--   • tickets, ticket messages (with internal notes), remote sessions
--   • CRM deals
--   • quotes & invoices (one "documents" table) + line items
--   • expense claims, leave requests, time entries, HR documents
--   • study reminders (private to each person)
--   • Row Level Security on EVERY table, matching the Team & roles screen
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Types
-- ---------------------------------------------------------------------
create type public.app_role        as enum ('admin', 'staff', 'client');
create type public.ticket_priority as enum ('low', 'normal', 'high', 'urgent');
create type public.ticket_status   as enum ('open', 'in_progress', 'waiting_on_client', 'escalated', 'resolved', 'closed');
create type public.project_status  as enum ('active', 'on_hold', 'done');
create type public.project_phase   as enum ('plan', 'design', 'build', 'launch');
create type public.deal_stage      as enum ('lead', 'contacted', 'proposal_sent', 'negotiation', 'won', 'lost');
create type public.doc_kind        as enum ('quote', 'invoice');
create type public.doc_status      as enum ('draft', 'sent', 'accepted', 'declined', 'invoiced', 'paid', 'cancelled');
create type public.decision_status as enum ('waiting', 'approved', 'declined');
create type public.claim_status    as enum ('waiting', 'approved', 'declined', 'paid_back');
create type public.leave_type      as enum ('annual', 'sick', 'family_responsibility', 'unpaid');


-- ---------------------------------------------------------------------
-- 2. Clients and profiles
-- ---------------------------------------------------------------------
create table public.clients (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  plan         text,                       -- e.g. 'Care plan', 'Nova SIS', 'Project only'
  monthly_fee  numeric(12,2) default 0,
  support_hours_per_month numeric(5,2) default 0,
  notes        text,                       -- internal only (clients cannot read this table's notes via the app)
  created_at   timestamptz not null default now()
);

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  full_name  text not null default '',
  job_title  text,
  role       public.app_role not null default 'client',
  client_id  uuid references public.clients (id) on delete set null,   -- only for role = client
  started_on date,
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 3. Helper functions (used by the security rules)
--    SECURITY DEFINER so they can read profiles without looping on RLS.
-- ---------------------------------------------------------------------
create or replace function public.my_role()
returns public.app_role
language sql stable security definer set search_path = ''
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false) $$;

create or replace function public.is_staff()   -- true for admin AND staff
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select role in ('admin', 'staff') from public.profiles where id = auth.uid()), false) $$;

create or replace function public.my_client_id()
returns uuid
language sql stable security definer set search_path = ''
as $$ select client_id from public.profiles where id = auth.uid() and role = 'client' $$;


-- Create a profile automatically when someone signs up / is invited.
-- Everyone starts as 'client' with no company → they can see nothing
-- until an admin links them to a client or makes them staff.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- Stop anyone except an admin from changing role / client link.
-- (auth.uid() is null in the SQL Editor, so you can still set your
--  first admin there.)
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role
       or new.client_id is distinct from old.client_id
       or new.email is distinct from old.email then
      raise exception 'Only an admin can change role, company or email';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_protect_fields
  before update on public.profiles
  for each row execute function public.protect_profile_fields();


-- Keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at = now(); return new; end; $$;


-- ---------------------------------------------------------------------
-- 4. Projects and extra work
-- ---------------------------------------------------------------------
create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references public.clients (id) on delete cascade,   -- null = internal project
  name        text not null,
  type        text,                                  -- 'Divi website', 'Nova SIS', ...
  phase       public.project_phase not null default 'plan',
  progress    int not null default 0 check (progress between 0 and 100),
  status      public.project_status not null default 'active',
  budget      numeric(12,2) default 0,
  quoted_hours numeric(7,2) default 0,
  due_date    date,
  waiting_on_client boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.extras (            -- work outside the original quote
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references public.projects (id) on delete cascade,
  client_id   uuid not null references public.clients (id) on delete cascade,
  name        text not null,
  note        text,
  amount      numeric(12,2) not null default 0,
  status      public.decision_status not null default 'waiting',
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 5. Tickets, messages, remote sessions
-- ---------------------------------------------------------------------
create table public.tickets (
  id           bigint generated always as identity (start with 1001) primary key,  -- shown as TCK-1001
  client_id    uuid not null references public.clients (id) on delete cascade,
  project_id   uuid references public.projects (id) on delete set null,
  title        text not null,
  description  text,
  priority     public.ticket_priority not null default 'normal',
  status       public.ticket_status not null default 'open',
  assignee_id  uuid references public.profiles (id) on delete set null,
  created_by   uuid references public.profiles (id) on delete set null default auth.uid(),
  due_at       timestamptz,                       -- the SLA deadline
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger tickets_touch before update on public.tickets
  for each row execute function public.touch_updated_at();

create table public.ticket_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   bigint not null references public.tickets (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null default auth.uid(),
  body        text not null,
  is_internal boolean not null default false,     -- internal notes: never shown to clients
  created_at  timestamptz not null default now()
);

create table public.remote_sessions (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   bigint references public.tickets (id) on delete set null,
  client_id   uuid not null references public.clients (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  tool        text not null default 'AnyDesk',    -- AnyDesk / TeamViewer / Other
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,                         -- null while the session is live
  note        text,
  created_at  timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);


-- ---------------------------------------------------------------------
-- 6. CRM pipeline
-- ---------------------------------------------------------------------
create table public.deals (
  id          uuid primary key default gen_random_uuid(),
  company     text not null,
  client_id   uuid references public.clients (id) on delete set null,  -- set once they become a client
  description text,
  amount      numeric(12,2) not null default 0,
  stage       public.deal_stage not null default 'lead',
  owner_id    uuid references public.profiles (id) on delete set null default auth.uid(),
  next_step   text,
  next_step_on date,
  created_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 7. Finance: quotes & invoices + lines
-- ---------------------------------------------------------------------
create sequence public.invoice_number_seq start 143;
create sequence public.quote_number_seq   start 32;

create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  kind          public.doc_kind not null,
  number        text unique,                     -- INV-0143 / Q-0032, filled in automatically
  client_id     uuid not null references public.clients (id) on delete restrict,
  project_id    uuid references public.projects (id) on delete set null,
  title         text,
  status        public.doc_status not null default 'draft',
  issue_date    date not null default current_date,
  due_date      date,                            -- invoice: pay by / quote: valid until
  include_vat   boolean not null default true,
  vat_rate      numeric(5,4) not null default 0.15,
  from_quote_id uuid references public.documents (id) on delete set null,
  sent_at       timestamptz,
  paid_at       timestamptz,
  created_by    uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);

create table public.document_lines (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  position    int not null default 0,
  description text not null,
  qty         numeric(10,2) not null default 1,
  unit_price  numeric(12,2) not null default 0
);

create or replace function public.set_document_number()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.number is null then
    if new.kind = 'invoice' then
      new.number := 'INV-' || lpad(nextval('public.invoice_number_seq')::text, 4, '0');
    else
      new.number := 'Q-'   || lpad(nextval('public.quote_number_seq')::text, 4, '0');
    end if;
  end if;
  return new;
end;
$$;
create trigger documents_number before insert on public.documents
  for each row execute function public.set_document_number();

-- Totals worked out by the database, so every screen shows the same number
create view public.document_totals
with (security_invoker = true) as
select d.id as document_id,
       coalesce(sum(l.qty * l.unit_price), 0)                                           as subtotal,
       case when d.include_vat then round(coalesce(sum(l.qty * l.unit_price), 0) * d.vat_rate, 2) else 0 end as vat,
       coalesce(sum(l.qty * l.unit_price), 0)
         + case when d.include_vat then round(coalesce(sum(l.qty * l.unit_price), 0) * d.vat_rate, 2) else 0 end as total
from public.documents d
left join public.document_lines l on l.document_id = d.id
group by d.id;


-- ---------------------------------------------------------------------
-- 8. Expense claims
-- ---------------------------------------------------------------------
create table public.claims (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  client_id         uuid references public.clients (id) on delete set null,  -- null = internal
  description       text not null,
  category          text not null default 'Other',   -- Travel, Software, Phone & data, ...
  amount            numeric(12,2) not null check (amount > 0),
  receipt_path      text,                            -- file in Supabase Storage (added in a later step)
  status            public.claim_status not null default 'waiting',
  billed_invoice_id uuid references public.documents (id) on delete set null,
  created_at        timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 9. HR: leave, time, documents
-- ---------------------------------------------------------------------
create table public.leave_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  type        public.leave_type not null default 'annual',
  start_date  date not null,
  end_date    date not null,
  days        numeric(4,1),
  reason      text,
  status      public.decision_status not null default 'waiting',
  decided_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  check (end_date >= start_date)
);

create table public.time_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  work_date   date not null default current_date,
  minutes     int not null check (minutes > 0),
  client_id   uuid references public.clients (id) on delete set null,   -- null = internal work
  project_id  uuid references public.projects (id) on delete set null,
  ticket_id   bigint references public.tickets (id) on delete set null,
  note        text,
  approved    boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.hr_documents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles (id) on delete cascade,  -- null = for everyone (policies)
  name        text not null,
  file_path   text,
  status      text not null default 'Up to date',  -- Signed / Not signed / Expires soon / ...
  expires_on  date,
  created_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 10. Study reminders (private to each person)
-- ---------------------------------------------------------------------
create table public.study_reminders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  title       text not null,
  goal        text,
  remind_at   timestamptz,
  minutes     int,
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);


-- =====================================================================
-- 11. ROW LEVEL SECURITY — who can see and change what
--     Matches the "What each role can do" table on Team & roles.
-- =====================================================================
alter table public.clients         enable row level security;
alter table public.profiles        enable row level security;
alter table public.projects        enable row level security;
alter table public.extras          enable row level security;
alter table public.tickets         enable row level security;
alter table public.ticket_messages enable row level security;
alter table public.remote_sessions enable row level security;
alter table public.deals           enable row level security;
alter table public.documents       enable row level security;
alter table public.document_lines  enable row level security;
alter table public.claims          enable row level security;
alter table public.leave_requests  enable row level security;
alter table public.time_entries    enable row level security;
alter table public.hr_documents    enable row level security;
alter table public.study_reminders enable row level security;

-- clients: team sees all, a client sees only their own company, admin edits
create policy "clients: team reads all"      on public.clients for select to authenticated using (public.is_staff());
create policy "clients: client reads own"    on public.clients for select to authenticated using (id = public.my_client_id());
create policy "clients: team adds and edits" on public.clients for insert to authenticated with check (public.is_staff());
create policy "clients: team updates"        on public.clients for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "clients: admin deletes"       on public.clients for delete to authenticated using (public.is_admin());

-- profiles: you see yourself; the team sees everyone; clients see the team
-- (so they can see who replied) and people from their own company
create policy "profiles: read"  on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff() or role in ('admin', 'staff')
         or (client_id is not null and client_id = public.my_client_id()));
create policy "profiles: edit own name" on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy "profiles: admin deletes" on public.profiles for delete to authenticated using (public.is_admin());

-- projects
create policy "projects: team all"         on public.projects for all    to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "projects: client reads own" on public.projects for select to authenticated using (client_id = public.my_client_id());

-- extras (clients approve/decline through the respond_to_extra function below)
create policy "extras: team all"         on public.extras for all    to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "extras: client reads own" on public.extras for select to authenticated using (client_id = public.my_client_id());

-- tickets
create policy "tickets: team all"           on public.tickets for all    to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "tickets: client reads own"   on public.tickets for select to authenticated using (client_id = public.my_client_id());
create policy "tickets: client raises own"  on public.tickets for insert to authenticated
  with check (client_id = public.my_client_id() and created_by = auth.uid()
              and assignee_id is null and status = 'open');

-- ticket messages: clients never see internal notes and can't write them
create policy "messages: team all" on public.ticket_messages for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "messages: client reads public" on public.ticket_messages for select to authenticated
  using (not is_internal and exists (select 1 from public.tickets t where t.id = ticket_id and t.client_id = public.my_client_id()));
create policy "messages: client replies" on public.ticket_messages for insert to authenticated
  with check (not is_internal and author_id = auth.uid()
              and exists (select 1 from public.tickets t where t.id = ticket_id and t.client_id = public.my_client_id()));

-- remote sessions: team logs their own, admin fixes any; clients see their times
create policy "sessions: team reads"        on public.remote_sessions for select to authenticated using (public.is_staff());
create policy "sessions: team logs own"     on public.remote_sessions for insert to authenticated with check (public.is_staff() and user_id = auth.uid());
create policy "sessions: own or admin edit" on public.remote_sessions for update to authenticated
  using (public.is_staff() and (user_id = auth.uid() or public.is_admin()))
  with check (public.is_staff() and (user_id = auth.uid() or public.is_admin()));
create policy "sessions: admin deletes"     on public.remote_sessions for delete to authenticated using (public.is_admin());
create policy "sessions: client reads own"  on public.remote_sessions for select to authenticated using (client_id = public.my_client_id());

-- CRM deals: team only
create policy "deals: team all" on public.deals for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- quotes & invoices: admin only creates; a client sees their own once sent
create policy "documents: admin all" on public.documents for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "documents: client reads own sent" on public.documents for select to authenticated
  using (client_id = public.my_client_id() and status <> 'draft');
create policy "lines: admin all" on public.document_lines for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "lines: client reads own sent" on public.document_lines for select to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id
                 and d.client_id = public.my_client_id() and d.status <> 'draft'));

-- claims: team submits and sees their own; admin approves and pays back
create policy "claims: own read"   on public.claims for select to authenticated using (user_id = auth.uid() and public.is_staff());
create policy "claims: own submit" on public.claims for insert to authenticated
  with check (public.is_staff() and user_id = auth.uid() and status = 'waiting');
create policy "claims: admin all"  on public.claims for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- leave: team requests and sees their own; admin approves
create policy "leave: own read"    on public.leave_requests for select to authenticated using (user_id = auth.uid());
create policy "leave: own request" on public.leave_requests for insert to authenticated
  with check (public.is_staff() and user_id = auth.uid() and status = 'waiting');
create policy "leave: admin all"   on public.leave_requests for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- "Who's out": team sees approved absences only — no type, no reason
create view public.team_absences as
  select l.user_id, p.full_name, l.start_date, l.end_date
  from public.leave_requests l
  join public.profiles p on p.id = l.user_id
  where l.status = 'approved' and public.is_staff();
-- This view runs with its owner's rights on purpose, so staff can see
-- WHO is away without seeing anyone's leave type or reason.
revoke all on public.team_absences from anon;
grant select on public.team_absences to authenticated;

-- time entries: own (until approved); admin all
create policy "time: own read"   on public.time_entries for select to authenticated using (user_id = auth.uid());
create policy "time: own add"    on public.time_entries for insert to authenticated
  with check (public.is_staff() and user_id = auth.uid() and approved = false);
create policy "time: own edit until approved" on public.time_entries for update to authenticated
  using (user_id = auth.uid() and approved = false) with check (user_id = auth.uid() and approved = false);
create policy "time: admin all"  on public.time_entries for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- HR documents: own + company-wide ones; admin all
create policy "hr docs: own and shared" on public.hr_documents for select to authenticated
  using (public.is_staff() and (user_id = auth.uid() or user_id is null));
create policy "hr docs: admin all" on public.hr_documents for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- study reminders: only the owner, nobody else (not even other admins)
create policy "study: owner only" on public.study_reminders for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());


-- =====================================================================
-- 12. Client actions (safe functions instead of letting clients edit rows)
-- =====================================================================

-- Client approves or declines an extra
create or replace function public.respond_to_extra(extra_id uuid, approve boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.extras
     set status = case when approve then 'approved'::public.decision_status else 'declined'::public.decision_status end,
         decided_at = now()
   where id = extra_id
     and client_id = public.my_client_id()
     and status = 'waiting';
  if not found then raise exception 'Extra not found or already decided'; end if;
end;
$$;

-- Client accepts or declines a quote
create or replace function public.respond_to_quote(quote_id uuid, accept boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.documents
     set status = case when accept then 'accepted'::public.doc_status else 'declined'::public.doc_status end
   where id = quote_id
     and kind = 'quote'
     and client_id = public.my_client_id()
     and status = 'sent';
  if not found then raise exception 'Quote not found or already answered'; end if;
end;
$$;

revoke execute on function public.respond_to_extra(uuid, boolean) from public, anon;
revoke execute on function public.respond_to_quote(uuid, boolean) from public, anon;
grant  execute on function public.respond_to_extra(uuid, boolean) to authenticated;
grant  execute on function public.respond_to_quote(uuid, boolean) to authenticated;


-- =====================================================================
-- 13. Helpful indexes
-- =====================================================================
create index on public.profiles (client_id);
create index on public.projects (client_id);
create index on public.extras (client_id);
create index on public.tickets (client_id);
create index on public.tickets (assignee_id);
create index on public.tickets (status);
create index on public.ticket_messages (ticket_id);
create index on public.remote_sessions (client_id);
create index on public.remote_sessions (ticket_id);
create index on public.documents (client_id);
create index on public.document_lines (document_id);
create index on public.claims (user_id);
create index on public.leave_requests (user_id);
create index on public.time_entries (user_id, work_date);

-- Done. Next: make yourself admin (see the README / chat instructions).
