-- =====================================================================
-- Work Hub — step 4: file uploads (Supabase Storage)
-- Paste into Supabase → SQL Editor → New query → Run (after 003).
--
-- Three PRIVATE storage buckets. Nothing in them is public: the app
-- asks for a short-lived link each time someone opens a file.
--
--   receipts       claim receipts      → path: <user id>/<file>
--   hr-docs        HR document files   → path: <user id>/<file>  or  everyone/<file>
--   ticket-files   ticket screenshots  → path: <ticket number>/<file>
--
-- Images and PDFs only, up to 10 MB each.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('receipts',     'receipts',     false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','application/pdf']),
  ('hr-docs',      'hr-docs',      false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf']),
  ('ticket-files', 'ticket-files', false, 10485760, array['image/jpeg','image/png','image/webp','image/gif','application/pdf'])
on conflict (id) do nothing;


-- Can the current login see this ticket? (team: any ticket; client: their company's)
create or replace function public.can_see_ticket(ticket_ref text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when ticket_ref !~ '^[0-9]+$' then false
    when public.is_staff() then true
    else exists (
      select 1 from public.tickets t
      where t.id = ticket_ref::bigint and t.client_id = public.my_client_id()
    )
  end
$$;


-- ---------- receipts: staff upload into their own folder; admin sees all ----------
create policy "receipts: own upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_staff()
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy "receipts: own or admin read" on storage.objects for select to authenticated
  using (bucket_id = 'receipts'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy "receipts: admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and public.is_admin());


-- ---------- hr-docs: admin uploads; staff read their own and "everyone" files ----------
create policy "hr-docs: admin all" on storage.objects for all to authenticated
  using (bucket_id = 'hr-docs' and public.is_admin())
  with check (bucket_id = 'hr-docs' and public.is_admin());
create policy "hr-docs: staff read own and shared" on storage.objects for select to authenticated
  using (bucket_id = 'hr-docs' and public.is_staff()
         and ((storage.foldername(name))[1] = auth.uid()::text or (storage.foldername(name))[1] = 'everyone'));


-- ---------- ticket-files: anyone who can see the ticket can view and add files ----------
create policy "ticket-files: read" on storage.objects for select to authenticated
  using (bucket_id = 'ticket-files' and public.can_see_ticket((storage.foldername(name))[1]));
create policy "ticket-files: upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'ticket-files' and public.can_see_ticket((storage.foldername(name))[1]));
create policy "ticket-files: team delete" on storage.objects for delete to authenticated
  using (bucket_id = 'ticket-files' and public.is_staff());
