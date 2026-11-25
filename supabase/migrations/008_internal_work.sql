-- =====================================================================
-- 008 — Internal work: tasks, knowledge base, announcements, notifications
-- Run this once in the Supabase SQL Editor (after 001–007).
--
-- What it adds (all team-only: admin + staff; clients see none of it):
--   • tasks              — internal to-dos the team assigns to each other
--   • kb_articles        — the knowledge base: how-to guides and procedures
--   • announcements      — team news from admins (no more lost WhatsApp messages)
--   • notifications      — the bell in the menu; filled in automatically by triggers
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Tasks
-- ---------------------------------------------------------------------
create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  status       text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  priority     text not null default 'normal' check (priority in ('normal', 'high')),
  assignee_id  uuid references public.profiles (id) on delete set null,
  created_by   uuid references public.profiles (id) on delete set null default auth.uid(),
  due_on       date,
  client_id    uuid references public.clients (id) on delete set null,    -- optional: what it's for
  project_id   uuid references public.projects (id) on delete set null,
  done_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index tasks_assignee_idx on public.tasks (assignee_id, status);

-- Stamp done_at when a task is ticked off (and clear it if reopened).
create or replace function public.tasks_done_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then new.done_at := now(); end if;
  if new.status <> 'done' then new.done_at := null; end if;
  return new;
end;
$$;
create trigger tasks_done_at before insert or update on public.tasks
  for each row execute function public.tasks_done_at();

alter table public.tasks enable row level security;
-- The whole team can see and work on tasks (so nothing is hidden when someone is away).
create policy "tasks: team reads"   on public.tasks for select to authenticated using (public.is_staff());
create policy "tasks: team adds"    on public.tasks for insert to authenticated with check (public.is_staff() and created_by = auth.uid());
create policy "tasks: team updates" on public.tasks for update to authenticated using (public.is_staff()) with check (public.is_staff());
-- Only the person who made it, or an admin, can delete it.
create policy "tasks: creator or admin deletes" on public.tasks for delete to authenticated
  using (public.is_admin() or (public.is_staff() and created_by = auth.uid()));


-- ---------------------------------------------------------------------
-- 2. Knowledge base
-- ---------------------------------------------------------------------
create table public.kb_articles (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  category    text not null default 'General',   -- e.g. How-to, Client setup, Policies
  body        text not null default '',
  pinned      boolean not null default false,
  created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create or replace function public.kb_touch()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
create trigger kb_touch before update on public.kb_articles
  for each row execute function public.kb_touch();

alter table public.kb_articles enable row level security;
-- Like a shared wiki: anyone on the team can read, write and improve articles.
create policy "kb: team reads"   on public.kb_articles for select to authenticated using (public.is_staff());
create policy "kb: team adds"    on public.kb_articles for insert to authenticated with check (public.is_staff());
create policy "kb: team updates" on public.kb_articles for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "kb: author or admin deletes" on public.kb_articles for delete to authenticated
  using (public.is_admin() or (public.is_staff() and created_by = auth.uid()));


-- ---------------------------------------------------------------------
-- 3. Announcements (admins post, the team reads)
-- ---------------------------------------------------------------------
create table public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text,
  pinned      boolean not null default false,
  created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

alter table public.announcements enable row level security;
create policy "announcements: team reads" on public.announcements for select to authenticated using (public.is_staff());
create policy "announcements: admin writes" on public.announcements for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ---------------------------------------------------------------------
-- 4. Notifications — one row per person per event. Only the triggers below
--    create them (no insert policy), and you only ever see your own.
-- ---------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null,          -- task, ticket, message, announcement, leave, claim
  title       text not null,
  body        text,
  link        text,                   -- where clicking it goes, e.g. /app/tickets/1001
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
create policy "notifications: own reads"   on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "notifications: own updates" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "notifications: own deletes" on public.notifications for delete to authenticated using (user_id = auth.uid());

-- Send one notification. Never notifies you about something you did yourself.
create or replace function public.notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  insert into public.notifications (user_id, kind, title, body, link) values (p_user, p_kind, p_title, p_body, p_link);
end;
$$;
revoke all on function public.notify(uuid, text, text, text, text) from public, anon, authenticated;

-- Notify every admin (used for leave requests and claims).
create or replace function public.notify_admins(p_kind text, p_title text, p_body text, p_link text)
returns void language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  for r in select id from public.profiles where role = 'admin' loop
    perform public.notify(r.id, p_kind, p_title, p_body, p_link);
  end loop;
end;
$$;
revoke all on function public.notify_admins(text, text, text, text) from public, anon, authenticated;

-- Name of the person doing the action, for "Aisha assigned you…"
create or replace function public.actor_name()
returns text language sql stable security definer set search_path = ''
as $$ select coalesce(nullif((select full_name from public.profiles where id = auth.uid()), ''), 'Someone') $$;


-- 4a. Tasks: tell the person a task was given to them; tell the creator when it's done.
create or replace function public.notify_on_task()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    perform public.notify(new.assignee_id, 'task', public.actor_name() || ' gave you a task', new.title, '/app/tasks');
  end if;
  if tg_op = 'UPDATE' and new.status = 'done' and old.status <> 'done' then
    perform public.notify(new.created_by, 'task', public.actor_name() || ' finished a task', new.title, '/app/tasks');
  end if;
  return new;
end;
$$;
create trigger notify_on_task after insert or update on public.tasks
  for each row execute function public.notify_on_task();


-- 4b. Tickets: tell the person a ticket was assigned to them.
create or replace function public.notify_on_ticket_assign()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    perform public.notify(new.assignee_id, 'ticket', 'Ticket assigned to you',
      'TCK-' || new.id || ' · ' || new.title, '/app/tickets/' || new.id);
  end if;
  return new;
end;
$$;
create trigger notify_on_ticket_assign after insert or update of assignee_id on public.tickets
  for each row execute function public.notify_on_ticket_assign();


-- 4c. Ticket messages: a client reply goes to the assignee (or every admin if nobody is
--     assigned); a team message or internal note goes to the assignee.
create or replace function public.notify_on_ticket_message()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  t public.tickets%rowtype;
  author_role public.app_role;
  r record;
begin
  select * into t from public.tickets where id = new.ticket_id;
  select role into author_role from public.profiles where id = new.author_id;
  if author_role = 'client' then
    if t.assignee_id is not null then
      perform public.notify(t.assignee_id, 'message', 'Client replied on TCK-' || t.id, left(new.body, 140), '/app/tickets/' || t.id);
    else
      for r in select id from public.profiles where role = 'admin' loop
        perform public.notify(r.id, 'message', 'Client replied on TCK-' || t.id, left(new.body, 140), '/app/tickets/' || t.id);
      end loop;
    end if;
  else
    perform public.notify(t.assignee_id, 'message',
      public.actor_name() || case when new.is_internal then ' added a note on TCK-' else ' replied on TCK-' end || t.id,
      left(new.body, 140), '/app/tickets/' || t.id);
  end if;
  return new;
end;
$$;
create trigger notify_on_ticket_message after insert on public.ticket_messages
  for each row execute function public.notify_on_ticket_message();


-- 4d. Announcements: everyone on the team gets a notification.
create or replace function public.notify_on_announcement()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  for r in select id from public.profiles where role in ('admin', 'staff') loop
    perform public.notify(r.id, 'announcement', 'Announcement: ' || new.title, left(new.body, 140), '/app/announcements');
  end loop;
  return new;
end;
$$;
create trigger notify_on_announcement after insert on public.announcements
  for each row execute function public.notify_on_announcement();


-- 4e. Leave: admins hear about new requests; the person hears the decision.
create or replace function public.notify_on_leave()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.notify_admins('leave', public.actor_name() || ' asked for leave',
      to_char(new.start_date, 'DD Mon') || ' – ' || to_char(new.end_date, 'DD Mon'), '/app/hr');
  elsif new.status is distinct from old.status and new.status <> 'waiting' then
    perform public.notify(new.user_id, 'leave', 'Your leave was ' || new.status::text,
      to_char(new.start_date, 'DD Mon') || ' – ' || to_char(new.end_date, 'DD Mon'), '/app/hr');
  end if;
  return new;
end;
$$;
create trigger notify_on_leave after insert or update of status on public.leave_requests
  for each row execute function public.notify_on_leave();


-- 4f. Claims: admins hear about new claims; the person hears what happened to theirs.
create or replace function public.notify_on_claim()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.notify_admins('claim', public.actor_name() || ' sent a claim',
      new.description || ' · ' || public.rand_text(new.amount), '/app/finance');
  elsif new.status is distinct from old.status and new.status <> 'waiting' then
    perform public.notify(new.user_id, 'claim',
      'Your claim was ' || replace(new.status::text, '_', ' '),
      new.description || ' · ' || public.rand_text(new.amount), '/app/hr');
  end if;
  return new;
end;
$$;
create trigger notify_on_claim after insert or update of status on public.claims
  for each row execute function public.notify_on_claim();
