-- =====================================================================
-- 012 — Clear old or test log entries (admins only)
-- Run this once in the Supabase SQL Editor (after 011).
--
-- admin_clear_logs() empties the activity log, the email log and/or everyone's notifications,
-- either completely or only entries older than a date. Every clear is written to the activity log
-- (who, what, how many), so logs can't be wiped without a trace.
-- =====================================================================
create or replace function public.admin_clear_logs(p_logs text[], p_older_than timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  cutoff timestamptz := coalesce(p_older_than, 'infinity'::timestamptz);  -- null = everything
  n_activity int := 0;
  n_emails int := 0;
  n_notes int := 0;
begin
  if not public.is_admin() then
    raise exception 'Only admins can clear logs';
  end if;
  if p_logs is null or cardinality(p_logs) = 0 or not (p_logs <@ array['activity', 'emails', 'notifications']) then
    raise exception 'Choose activity, emails and/or notifications';
  end if;

  if 'activity' = any (p_logs) then
    delete from public.audit_log where at < cutoff;
    get diagnostics n_activity = row_count;
  end if;
  if 'emails' = any (p_logs) then
    delete from public.email_log where created_at < cutoff;
    get diagnostics n_emails = row_count;
  end if;
  if 'notifications' = any (p_logs) then
    delete from public.notifications where created_at < cutoff;
    get diagnostics n_notes = row_count;
  end if;

  -- Leave a note of the clear itself (this row is new, so it survives the clear above).
  insert into public.audit_log (user_id, table_name, row_id, label, action, changes)
  values (auth.uid(), 'logs', null, 'Logs cleared', 'deleted', jsonb_build_object(
    'cleared', p_logs,
    'older_than', p_older_than,
    'activity_entries', n_activity, 'emails', n_emails, 'notifications', n_notes));

  return jsonb_build_object('activity', n_activity, 'emails', n_emails, 'notifications', n_notes);
end;
$$;
revoke all on function public.admin_clear_logs(text[], timestamptz) from public, anon;
grant execute on function public.admin_clear_logs(text[], timestamptz) to authenticated;
