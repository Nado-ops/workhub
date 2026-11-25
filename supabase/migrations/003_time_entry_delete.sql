-- =====================================================================
-- Work Hub — step 3: let people remove their own time entries
-- Paste into Supabase → SQL Editor → New query → Run (after 002).
--
-- Staff can delete a time entry they logged by mistake, but only
-- until the admin has approved that week. Admins can already delete any.
-- =====================================================================

create policy "time: own delete until approved" on public.time_entries
  for delete to authenticated
  using (user_id = auth.uid() and approved = false);
