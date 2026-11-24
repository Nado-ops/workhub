-- =====================================================================
-- Work Hub — step 2: automatic ticket deadlines
-- Paste into Supabase → SQL Editor → New query → Run (after 001).
--
-- Every new ticket gets a response deadline from its priority:
--   urgent 1 hour · high 4 hours · normal 24 hours · low 3 days
-- The database sets it, so a client can't pick their own deadline.
-- Staff can still change due_at on a ticket afterwards.
-- =====================================================================

create or replace function public.set_ticket_deadline()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.due_at := now() + case new.priority
    when 'urgent' then interval '1 hour'
    when 'high'   then interval '4 hours'
    when 'normal' then interval '24 hours'
    else               interval '3 days'
  end;
  return new;
end;
$$;

create trigger tickets_deadline
  before insert on public.tickets
  for each row execute function public.set_ticket_deadline();
