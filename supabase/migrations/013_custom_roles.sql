-- =====================================================================
-- 013 — Custom roles (e.g. "Finance", "Manager") for staff
-- Run this once in the Supabase SQL Editor (after 012).
--
-- The three base roles stay: admin (everything), staff (the team's normal access), client (their portal).
-- A custom role is STAFF + extra powers. The powers are real database rules, not just hidden screens:
--   finance        — quotes, invoices, claims (approve / pay), vendors, money reports
--   hr             — everyone's leave, timesheets and HR documents; approve leave and hours
--   websites       — connect client websites, change their settings, upload files, auto-mark pages
--   announcements  — post and manage team announcements
-- Admins can do all of these anyway. Team & settings, the activity log and business details stay admin-only.
-- =====================================================================

create table public.roles (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  description  text,
  permissions  text[] not null default '{}'
               check (permissions <@ array['finance', 'hr', 'websites', 'announcements']),
  created_at   timestamptz not null default now()
);

alter table public.roles enable row level security;
create policy "roles: team reads"    on public.roles for select to authenticated using (public.is_staff());
create policy "roles: admin manages" on public.roles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Each staff member can have one custom role (empty = plain staff).
alter table public.profiles add column role_id uuid references public.roles (id) on delete set null;

-- Only admins may change someone's custom role (same as role, company and email).
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role
       or new.client_id is distinct from old.client_id
       or new.email is distinct from old.email
       or new.role_id is distinct from old.role_id then
      raise exception 'Only an admin can change role, company or email';
    end if;
  end if;
  return new;
end;
$$;

-- Starter roles you can rename, change or delete on Team & settings.
insert into public.roles (name, description, permissions) values
  ('Finance', 'Quotes, invoices, claims and vendors', array['finance']),
  ('Manager', 'Runs the team: HR approvals, finance, announcements', array['finance', 'hr', 'announcements']),
  ('Web team', 'Looks after client websites', array['websites']);


-- ---------------------------------------------------------------------
-- can('finance') — true for admins, and for staff whose role includes that power.
-- ---------------------------------------------------------------------
create or replace function public.can(p_permission text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_admin() or exists (
    select 1 from public.profiles p join public.roles r on r.id = p.role_id
    where p.id = auth.uid() and p.role = 'staff' and p_permission = any (r.permissions)
  )
$$;
revoke all on function public.can(text) from public, anon;
grant execute on function public.can(text) to authenticated;


-- ---------------------------------------------------------------------
-- Extra rules. Postgres combines rules with OR, so these ADD access next to the existing admin rules.
-- ---------------------------------------------------------------------
-- finance
create policy "documents: finance all" on public.documents      for all to authenticated using (public.can('finance')) with check (public.can('finance'));
create policy "lines: finance all"     on public.document_lines for all to authenticated using (public.can('finance')) with check (public.can('finance'));
create policy "claims: finance all"    on public.claims         for all to authenticated using (public.can('finance')) with check (public.can('finance'));
create policy "vendors: finance all"   on public.vendors        for all to authenticated using (public.can('finance')) with check (public.can('finance'));
create policy "receipts: finance read" on storage.objects for select to authenticated using (bucket_id = 'receipts' and public.can('finance'));

-- hr
create policy "leave: hr all"   on public.leave_requests for all to authenticated using (public.can('hr')) with check (public.can('hr'));
create policy "time: hr all"    on public.time_entries   for all to authenticated using (public.can('hr')) with check (public.can('hr'));
create policy "hr docs: hr all" on public.hr_documents   for all to authenticated using (public.can('hr')) with check (public.can('hr'));
create policy "hr-docs: hr all" on storage.objects for all to authenticated
  using (bucket_id = 'hr-docs' and public.can('hr')) with check (bucket_id = 'hr-docs' and public.can('hr'));

-- websites
create policy "sites: websites manages"      on public.sites      for all to authenticated using (public.can('websites')) with check (public.can('websites'));
create policy "site files: websites writes"  on public.site_files for all to authenticated using (public.can('websites')) with check (public.can('websites'));
create policy "site files bucket: websites writes" on storage.objects for all to authenticated
  using (bucket_id = 'site-files' and public.can('websites')) with check (bucket_id = 'site-files' and public.can('websites'));

-- announcements
create policy "announcements: poster writes" on public.announcements for all to authenticated
  using (public.can('announcements')) with check (public.can('announcements'));


-- ---------------------------------------------------------------------
-- Leave requests and claims also notify people with the matching power, not only admins.
-- ---------------------------------------------------------------------
create or replace function public.notify_admins(p_kind text, p_title text, p_body text, p_link text)
returns void language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  for r in
    select p.id from public.profiles p left join public.roles ro on ro.id = p.role_id
    where p.role = 'admin'
       or (p.role = 'staff' and ((p_kind = 'leave' and 'hr' = any (ro.permissions))
                              or (p_kind = 'claim' and 'finance' = any (ro.permissions))))
  loop
    perform public.notify(r.id, p_kind, p_title, p_body, p_link);
  end loop;
end;
$$;
revoke all on function public.notify_admins(text, text, text, text) from public, anon, authenticated;

-- Won deal → client: people with the finance power also get the draft quote.
create or replace function public.convert_deal(p_deal_id uuid, p_make_quote boolean default true)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  d        public.deals%rowtype;
  v_client uuid;
  v_quote  uuid;
begin
  if not public.is_staff() then
    raise exception 'Only the team can convert deals';
  end if;

  select * into d from public.deals where id = p_deal_id for update;
  if not found then
    raise exception 'Deal not found';
  end if;

  v_client := d.client_id;
  if v_client is null then
    insert into public.clients (name, plan, notes)
    values (d.company, 'Project only',
            'Won from the CRM pipeline' || coalesce(' (' || d.description || ')', ''))
    returning id into v_client;
  end if;

  update public.deals set stage = 'won', client_id = v_client where id = d.id;
  update public.contacts set client_id = v_client where deal_id = d.id and client_id is null;

  if p_make_quote and public.can('finance') then
    insert into public.documents (kind, client_id, title, status, due_date)
    values ('quote', v_client, coalesce(d.description, d.company), 'draft', current_date + 14)
    returning id into v_quote;

    insert into public.document_lines (document_id, position, description, qty, unit_price)
    values (v_quote, 0, coalesce(d.description, 'Work for ' || d.company), 1, d.amount);
  end if;

  return jsonb_build_object('client_id', v_client, 'quote_id', v_quote);
end;
$$;

create trigger audit_roles after insert or update or delete on public.roles
  for each row execute function public.audit_row();
