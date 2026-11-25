-- =====================================================================
-- 009 — Business details, monthly client reports, shared calendar,
--       audit log, and email for notifications
-- Run this once in the Supabase SQL Editor (after 001–008).
--
-- What it adds:
--   1. business_profile        — your business details for PDFs, edited in the app (Team & settings)
--   2. tickets.resolved_at     — when a ticket was solved (for reports)
--   3. client_month_report()   — everything for a client's monthly report, in one call
--      + a monthly email to clients on the 1st (pg_cron)
--   4. events                  — meetings and events for the shared calendar
--   5. audit_log               — who changed what, and when (admin only)
--   6. Notifications by email  — tasks, announcements, leave and claims also go by email
--      (each person can switch this off), and emails now use the navy + gold look
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Business details (one row). Everyone logged in can read it, because
--    clients' PDFs show it. Only admins can change it.
-- ---------------------------------------------------------------------
create table public.business_profile (
  id            boolean primary key default true check (id),   -- only ever one row
  name          text not null default 'Your business name',
  email         text,
  phone         text,
  address       text,
  vat_number    text,                 -- empty = not VAT-registered
  bank_details  text,                 -- printed on invoices
  invoice_note  text,                 -- e.g. "Please use the invoice number as reference."
  updated_at    timestamptz not null default now()
);
insert into public.business_profile (id) values (true);

alter table public.business_profile enable row level security;
create policy "business: everyone reads" on public.business_profile for select to authenticated using (true);
create policy "business: admin edits"    on public.business_profile for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Client billing details for the "Bill to" box (address, VAT number, ...).
alter table public.clients add column billing_details text;


-- ---------------------------------------------------------------------
-- 2. When a ticket was solved
-- ---------------------------------------------------------------------
alter table public.tickets add column resolved_at timestamptz;
update public.tickets set resolved_at = updated_at where status in ('resolved', 'closed');

create or replace function public.tickets_resolved_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.status in ('resolved', 'closed') and (old.status not in ('resolved', 'closed')) then
    new.resolved_at := now();
  elsif new.status not in ('resolved', 'closed') then
    new.resolved_at := null;           -- reopened
  end if;
  return new;
end;
$$;
create trigger tickets_resolved_at before update of status on public.tickets
  for each row execute function public.tickets_resolved_at();


-- ---------------------------------------------------------------------
-- 3. Monthly client report
--    The team can see any client's report; a client can only see their own.
-- ---------------------------------------------------------------------
create or replace function public.client_month_report(p_client uuid, p_month date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  m_start timestamptz := date_trunc('month', p_month::timestamptz);
  m_end   timestamptz := date_trunc('month', p_month::timestamptz) + interval '1 month';
  c       public.clients%rowtype;
begin
  if not (public.is_staff() or p_client = public.my_client_id()) then
    raise exception 'Not allowed';
  end if;
  select * into c from public.clients where id = p_client;
  if not found then
    raise exception 'Client not found';
  end if;

  return jsonb_build_object(
    'client', jsonb_build_object('name', c.name, 'plan', c.plan, 'support_hours', c.support_hours_per_month),
    'month', to_char(m_start, 'YYYY-MM'),

    'tickets', jsonb_build_object(
      'opened',   (select count(*) from public.tickets where client_id = p_client and created_at >= m_start and created_at < m_end),
      'resolved', (select count(*) from public.tickets where client_id = p_client and resolved_at >= m_start and resolved_at < m_end),
      'resolved_on_time', (select count(*) from public.tickets where client_id = p_client and resolved_at >= m_start and resolved_at < m_end
                                                               and (due_at is null or resolved_at <= due_at)),
      'open_now', (select count(*) from public.tickets where client_id = p_client and status not in ('resolved', 'closed')),
      'list', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', t.id, 'title', t.title, 'status', t.status, 'priority', t.priority,
                 'created_at', t.created_at, 'resolved_at', t.resolved_at) order by t.created_at), '[]'::jsonb)
               from public.tickets t
               where t.client_id = p_client
                 and ((t.created_at >= m_start and t.created_at < m_end) or (t.resolved_at >= m_start and t.resolved_at < m_end)))
    ),

    'support', (select jsonb_build_object(
                  'sessions', count(*),
                  'minutes',  coalesce(round(sum(extract(epoch from (ended_at - started_at)) / 60)), 0))
                from public.remote_sessions
                where client_id = p_client and ended_at is not null and started_at >= m_start and started_at < m_end),

    'projects', (select coalesce(jsonb_agg(jsonb_build_object(
                   'name', p.name, 'phase', p.phase, 'progress', p.progress, 'status', p.status,
                   'due_date', p.due_date, 'waiting_on_client', p.waiting_on_client) order by p.created_at), '[]'::jsonb)
                 from public.projects p
                 where p.client_id = p_client and (p.status <> 'done' or p.created_at >= m_start)),

    'billing', jsonb_build_object(
      'invoiced', (select coalesce(sum(dt.total), 0) from public.documents d join public.document_totals dt on dt.document_id = d.id
                   where d.client_id = p_client and d.kind = 'invoice' and d.status in ('sent', 'paid')
                     and d.issue_date >= m_start::date and d.issue_date < m_end::date),
      'paid',     (select coalesce(sum(dt.total), 0) from public.documents d join public.document_totals dt on dt.document_id = d.id
                   where d.client_id = p_client and d.kind = 'invoice' and d.paid_at >= m_start and d.paid_at < m_end),
      'outstanding', (select coalesce(sum(dt.total), 0) from public.documents d join public.document_totals dt on dt.document_id = d.id
                      where d.client_id = p_client and d.kind = 'invoice' and d.status = 'sent'),
      'invoices', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', d.id, 'number', d.number, 'title', d.title, 'status', d.status,
                     'issue_date', d.issue_date, 'due_date', d.due_date, 'total', dt.total) order by d.issue_date), '[]'::jsonb)
                   from public.documents d join public.document_totals dt on dt.document_id = d.id
                   where d.client_id = p_client and d.kind = 'invoice' and d.status in ('sent', 'paid')
                     and d.issue_date >= m_start::date and d.issue_date < m_end::date)
    )
  );
end;
$$;
revoke all on function public.client_month_report(uuid, date) from public, anon;
grant execute on function public.client_month_report(uuid, date) to authenticated;

-- On the 1st of each month: email each client with activity a link to last month's report.
create or replace function public.email_monthly_client_reports()
returns void language plpgsql security definer set search_path = ''
as $$
declare
  last_month date := (date_trunc('month', now()) - interval '1 month')::date;
  label text := to_char(last_month, 'FMMonth YYYY');
  c record;
begin
  for c in
    select cl.id, cl.name from public.clients cl
    where exists (select 1 from public.tickets t where t.client_id = cl.id
                    and (t.created_at >= last_month or t.resolved_at >= last_month)
                    and t.created_at < date_trunc('month', now()))
       or exists (select 1 from public.projects p where p.client_id = cl.id and p.status = 'active')
       or exists (select 1 from public.remote_sessions s where s.client_id = cl.id and s.started_at >= last_month
                    and s.started_at < date_trunc('month', now()))
  loop
    perform public.send_email('monthly_report', public.emails_for_client(c.id),
      'Your ' || label || ' report from ' || (select name from public.business_profile limit 1),
      public.email_layout('Your ' || label || ' report',
        '<p>Hi ' || public.html_escape(c.name) || ',</p><p>Your monthly report is ready: the support we did, your projects and your invoices for '
          || public.html_escape(label) || '.</p>',
        'Open my report', '/portal/report?month=' || to_char(last_month, 'YYYY-MM')));
  end loop;
end;
$$;
revoke all on function public.email_monthly_client_reports() from public, anon, authenticated;

select cron.schedule('monthly-client-reports', '0 7 1 * *', $$select public.email_monthly_client_reports()$$);


-- ---------------------------------------------------------------------
-- 4. Calendar events (meetings, reminders, team events)
-- ---------------------------------------------------------------------
create table public.events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  all_day     boolean not null default false,
  location    text,                   -- a room, an address or a Teams/Meet link
  notes       text,
  client_id   uuid references public.clients (id) on delete set null,
  private     boolean not null default false,   -- private = only you see it
  created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create index events_starts_idx on public.events (starts_at);

alter table public.events enable row level security;
create policy "events: team reads shared and own" on public.events for select to authenticated
  using (public.is_staff() and (not private or created_by = auth.uid()));
create policy "events: team adds" on public.events for insert to authenticated
  with check (public.is_staff() and created_by = auth.uid());
create policy "events: creator or admin edits" on public.events for update to authenticated
  using (public.is_staff() and (created_by = auth.uid() or (public.is_admin() and not private)))
  with check (public.is_staff());
create policy "events: creator or admin deletes" on public.events for delete to authenticated
  using (public.is_staff() and (created_by = auth.uid() or (public.is_admin() and not private)));

-- Tell the team about new shared events.
create or replace function public.notify_on_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  if new.private then return new; end if;
  for r in select id from public.profiles where role in ('admin', 'staff') loop
    perform public.notify(r.id, 'event', public.actor_name() || ' added ' || new.title,
      to_char(new.starts_at at time zone 'Africa/Johannesburg', case when new.all_day then 'Dy DD Mon' else 'Dy DD Mon, HH24:MI' end),
      '/app/calendar');
  end loop;
  return new;
end;
$$;
create trigger notify_on_event after insert on public.events
  for each row execute function public.notify_on_event();


-- ---------------------------------------------------------------------
-- 5. Audit log — every add, change and delete on the important tables.
--    Only the changed fields are kept for updates. Admins can read it; nobody can edit it.
-- ---------------------------------------------------------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  user_id     uuid,                    -- who did it (empty = the system, e.g. a scheduled job)
  table_name  text not null,
  row_id      text,
  label       text,                    -- a readable name for the row (title / name / number)
  action      text not null check (action in ('added', 'changed', 'deleted')),
  changes     jsonb                    -- changed: {"field": {"from": x, "to": y}}; added/deleted: the row
);
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_row_idx on public.audit_log (table_name, row_id);

alter table public.audit_log enable row level security;
create policy "audit: admin reads" on public.audit_log for select to authenticated using (public.is_admin());

create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  diff jsonb := '{}'::jsonb;
  k text;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      -- skip bookkeeping columns that change on every save
      if k not in ('updated_at', 'updated_by') and (o -> k) is distinct from (n -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_object('from', o -> k, 'to', n -> k));
      end if;
    end loop;
    if diff = '{}'::jsonb then return null; end if;
  end if;

  insert into public.audit_log (user_id, table_name, row_id, label, action, changes)
  values (
    auth.uid(), tg_table_name, r ->> 'id',
    left(coalesce(r ->> 'number', r ->> 'title', r ->> 'name', r ->> 'company', r ->> 'full_name', r ->> 'description'), 120),
    case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'changed' else 'deleted' end,
    case tg_op when 'UPDATE' then diff else r end
  );
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['clients', 'profiles', 'projects', 'extras', 'tickets', 'deals', 'contacts', 'documents',
                           'document_lines', 'claims', 'leave_requests', 'time_entries', 'vendors', 'tasks',
                           'kb_articles', 'announcements', 'events', 'business_profile'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- Keep a year of history.
select cron.schedule('audit-log-cleanup', '30 2 * * 0', $$delete from public.audit_log where at < now() - interval '365 days'$$);


-- ---------------------------------------------------------------------
-- 6. Notifications by email too (for things the older email triggers don't
--    already cover). Each person can switch it off from the bell.
-- ---------------------------------------------------------------------
alter table public.profiles add column email_notifications boolean not null default true;

create or replace function public.notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text)
returns void language plpgsql security definer set search_path = ''
as $$
declare p public.profiles%rowtype;
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  insert into public.notifications (user_id, kind, title, body, link) values (p_user, p_kind, p_title, p_body, p_link);

  -- Tickets and ticket replies are already emailed by migration 005, so they're skipped here.
  if p_kind in ('task', 'announcement', 'leave', 'claim', 'event') then
    select * into p from public.profiles where id = p_user;
    if p.email_notifications and p.email is not null then
      perform public.send_email('notification_' || p_kind, array[p.email], p_title,
        public.email_layout(p_title, coalesce('<p>' || public.html_escape(p_body) || '</p>', ''), 'Open Work Hub', p_link));
    end if;
  end if;
end;
$$;
revoke all on function public.notify(uuid, text, text, text, text) from public, anon, authenticated;

-- Emails in the new look: light card, navy text, gold button.
create or replace function public.email_layout(heading text, body_html text, button_text text, button_path text)
returns text language plpgsql stable security definer set search_path = ''
as $$
declare
  base text := coalesce(public.setting('app_url'), '');
begin
  return '<div style="background:#F4F6FA;padding:32px 16px;font-family:Arial,Helvetica,sans-serif">'
    || '<div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E3E8EF;border-radius:16px;padding:28px;color:#0B1733">'
    || '<div style="font-size:13px;font-weight:bold;color:#0B1733;margin-bottom:10px">Work Hub <span style="color:#C4A060">&#8599;</span></div>'
    || '<h1 style="font-size:20px;margin:0 0 14px;color:#0B1733">' || public.html_escape(heading) || '</h1>'
    || '<div style="font-size:14px;line-height:1.6;color:#334155">' || body_html || '</div>'
    || case when base <> '' and button_path is not null then
         '<a href="' || public.html_escape(rtrim(base, '/') || button_path) || '" style="display:inline-block;margin-top:20px;background:#D4AF6A;color:#0B1733;text-decoration:none;font-weight:bold;padding:11px 18px;border-radius:10px">'
         || public.html_escape(button_text) || '</a>'
       else '' end
    || '</div><div style="max-width:560px;margin:12px auto 0;font-size:11px;color:#5B6577;text-align:center">Small steps. Real progress. · You get this because you have a Work Hub login.</div></div>';
end;
$$;
