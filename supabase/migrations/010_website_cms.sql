-- =====================================================================
-- 010 — Website CMS: clients edit their own websites from the portal
-- Run this once in the Supabase SQL Editor (after 001–009).
--
-- How it fits together:
--   • sites          — a client's website (GitHub + Cloudflare HTML site, WordPress, or other)
--   • site_fields    — the editable parts of each page (found by scanning the HTML for data-cms="…")
--   • site_changes   — edits and change requests from clients or the team, with review status
--   • site-images    — private Storage bucket for photos clients upload before they're published
-- The actual saving to GitHub happens in the Work Hub server (worker/index.ts), which holds the
-- GitHub key as a Cloudflare secret. The browser never sees that key.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Websites
-- ---------------------------------------------------------------------
create table public.sites (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients (id) on delete cascade,
  name               text not null,                 -- e.g. "Harbour Dental website"
  url                text,                          -- the live address, e.g. https://harbourdental.co.za
  kind               text not null default 'github' check (kind in ('github', 'wordpress', 'other')),
  repo               text,                          -- GitHub "owner/name", for kind = github
  branch             text not null default 'main',
  folder             text not null default 'public', -- where the HTML files live in the repo ('' = repo root)
  requires_approval  boolean not null default true, -- client edits wait for the team to approve
  last_scanned_at    timestamptz,
  created_at         timestamptz not null default now(),
  check (kind <> 'github' or repo ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')
);

alter table public.sites enable row level security;
create policy "sites: team reads"        on public.sites for select to authenticated using (public.is_staff());
create policy "sites: client reads own"  on public.sites for select to authenticated using (client_id = public.my_client_id());
create policy "sites: admin manages"     on public.sites for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ---------------------------------------------------------------------
-- 2. Editable fields on each page
--    value: text / rich text = the HTML inside the element;
--           image = JSON {"src": "...", "alt": "..."}; link = JSON {"href": "...", "text": "..."}
-- ---------------------------------------------------------------------
create table public.site_fields (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid not null references public.sites (id) on delete cascade,
  page        text not null,                  -- file path inside the folder, e.g. "index.html", "about/index.html"
  key         text not null,                  -- the data-cms name, e.g. "hero-title"
  type        text not null check (type in ('text', 'richtext', 'image', 'link')),
  label       text,                           -- friendly name shown to the client
  value       text,
  position    int not null default 0,         -- order on the page
  updated_at  timestamptz not null default now(),
  unique (site_id, page, key)
);
create index site_fields_site_idx on public.site_fields (site_id, page, position);

alter table public.site_fields enable row level security;
create policy "fields: team reads"       on public.site_fields for select to authenticated using (public.is_staff());
create policy "fields: client reads own" on public.site_fields for select to authenticated
  using (exists (select 1 from public.sites s where s.id = site_id and s.client_id = public.my_client_id()));
-- Scanning (team) writes these; labels can be renamed by the team.
create policy "fields: team writes"      on public.site_fields for all to authenticated
  using (public.is_staff()) with check (public.is_staff());


-- ---------------------------------------------------------------------
-- 3. Changes and requests
--    kind 'edit'    = a new value for one field (can be published automatically)
--    kind 'request' = "please change this" in words + photos (the team does it)
-- ---------------------------------------------------------------------
create table public.site_changes (
  id            uuid primary key default gen_random_uuid(),
  site_id       uuid not null references public.sites (id) on delete cascade,
  kind          text not null default 'edit' check (kind in ('edit', 'request')),
  page          text,
  field_key     text,
  field_type    text check (field_type in ('text', 'richtext', 'image', 'link')),
  old_value     text,
  new_value     text,                          -- same format as site_fields.value
  note          text,                          -- the client's message
  images        text[] not null default '{}',  -- Storage paths in site-images (for requests)
  status        text not null default 'submitted'
                check (status in ('submitted', 'approved', 'published', 'rejected', 'done', 'failed')),
  review_note   text,                          -- why it was rejected / what went wrong
  created_by    uuid references public.profiles (id) on delete set null default auth.uid(),
  reviewed_by   uuid references public.profiles (id) on delete set null,
  reviewed_at   timestamptz,
  published_at  timestamptz,
  commit_sha    text,                          -- the GitHub commit that published it
  created_at    timestamptz not null default now(),
  check (kind <> 'edit' or (page is not null and field_key is not null and field_type is not null))
);
create index site_changes_site_idx on public.site_changes (site_id, created_at desc);

alter table public.site_changes enable row level security;
create policy "changes: team all" on public.site_changes for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy "changes: client reads own site" on public.site_changes for select to authenticated
  using (exists (select 1 from public.sites s where s.id = site_id and s.client_id = public.my_client_id()));
-- Clients can only add new, unreviewed changes for their own website.
create policy "changes: client adds" on public.site_changes for insert to authenticated
  with check (
    created_by = auth.uid() and status = 'submitted' and reviewed_by is null and commit_sha is null
    and exists (select 1 from public.sites s where s.id = site_id and s.client_id = public.my_client_id())
  );
-- …and withdraw (delete) their own change while it's still waiting.
create policy "changes: client withdraws" on public.site_changes for delete to authenticated
  using (created_by = auth.uid() and status = 'submitted');

-- Record that a change went live. Called by the Work Hub server after a successful GitHub commit,
-- using the logged-in person's own login. Team: any change. Client: only their own edits on a
-- site that doesn't require approval.
create or replace function public.cms_mark_published(p_change_ids uuid[], p_commit text)
returns void language plpgsql security definer set search_path = ''
as $$
declare ch record;
begin
  for ch in
    select c.*, s.client_id as site_client, s.requires_approval
    from public.site_changes c join public.sites s on s.id = c.site_id
    where c.id = any (p_change_ids)
  loop
    if not (public.is_staff()
            or (ch.site_client = public.my_client_id() and not ch.requires_approval
                and ch.created_by = auth.uid() and ch.kind = 'edit')) then
      raise exception 'Not allowed to publish this change';
    end if;
    if ch.status not in ('submitted', 'approved', 'failed') then
      continue;   -- already handled
    end if;

    update public.site_changes
       set status = 'published', published_at = now(), commit_sha = p_commit, review_note = null,
           reviewed_by = coalesce(reviewed_by, case when public.is_staff() then auth.uid() end),
           reviewed_at = coalesce(reviewed_at, case when public.is_staff() then now() end)
     where id = ch.id;

    if ch.kind = 'edit' then
      update public.site_fields set value = ch.new_value, updated_at = now()
       where site_id = ch.site_id and page = ch.page and key = ch.field_key;
    end if;
  end loop;
end;
$$;
revoke all on function public.cms_mark_published(uuid[], text) from public, anon;
grant execute on function public.cms_mark_published(uuid[], text) to authenticated;

-- Record that publishing failed, so the person sees why (same permission check).
create or replace function public.cms_mark_failed(p_change_ids uuid[], p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.site_changes c
     set status = 'failed', review_note = left(p_reason, 500)
    from public.sites s
   where s.id = c.site_id and c.id = any (p_change_ids)
     and c.status in ('submitted', 'approved')
     and (public.is_staff() or (s.client_id = public.my_client_id() and c.created_by = auth.uid()));
end;
$$;
revoke all on function public.cms_mark_failed(uuid[], text) from public, anon;
grant execute on function public.cms_mark_failed(uuid[], text) to authenticated;


-- ---------------------------------------------------------------------
-- 4. Tell people what's happening
-- ---------------------------------------------------------------------
create or replace function public.notify_on_site_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  s public.sites%rowtype;
  r record;
begin
  select * into s from public.sites where id = new.site_id;

  -- A client sent something: tell the admins (a request, or an edit waiting for approval).
  if tg_op = 'INSERT' and new.status = 'submitted'
     and exists (select 1 from public.profiles where id = new.created_by and role = 'client')
     and (new.kind = 'request' or s.requires_approval) then
    for r in select id from public.profiles where role = 'admin' loop
      perform public.notify(r.id, 'website',
        case when new.kind = 'request' then 'Website change request: ' else 'Website edit to approve: ' end || s.name,
        coalesce(left(new.note, 140), new.page || ' · ' || new.field_key), '/app/websites');
    end loop;
    perform public.send_email('website_change', public.emails_for_role('admin'),
      case when new.kind = 'request' then 'Change request for ' else 'Edit to approve on ' end || s.name,
      public.email_layout(case when new.kind = 'request' then 'New website change request' else 'A website edit needs your approval' end,
        '<p><b>' || public.html_escape(s.name) || '</b></p>' || coalesce('<p>' || public.html_escape(new.note) || '</p>', ''),
        'Open Websites', '/app/websites'));
  end if;

  -- The team handled a client's change: tell the person who sent it.
  if tg_op = 'UPDATE' and new.status is distinct from old.status
     and new.status in ('published', 'rejected', 'done') and new.created_by is not null then
    perform public.notify(new.created_by, 'website',
      case new.status when 'rejected' then 'Your website change was not published'
                      else 'Your website change is live' end,
      coalesce(new.review_note, s.name), '/portal/website');
    -- Clients have no bell in their portal, so they also get an email.
    if new.created_by is distinct from auth.uid()
       and exists (select 1 from public.profiles where id = new.created_by and role = 'client') then
      perform public.send_email('website_change_result',
        array[(select email from public.profiles where id = new.created_by)],
        case new.status when 'rejected' then 'Your website change: not published' else 'Your website change is live' end,
        public.email_layout(
          case new.status when 'rejected' then 'We didn''t publish your change' else 'Your change is live' end,
          '<p>' || public.html_escape(s.name) || '</p>'
            || coalesce('<p>' || public.html_escape(new.review_note) || '</p>', '')
            || case when new.status <> 'rejected' then '<p>It can take a minute or two to show on the website.</p>' else '' end,
          'Open my website', '/portal/website'));
    end if;
  end if;
  return new;
end;
$$;
create trigger notify_on_site_change after insert or update of status on public.site_changes
  for each row execute function public.notify_on_site_change();

-- Clients get bell notifications too, so the portal can show them (link goes to /portal/…).
-- (notify() skips the person who did the action, so nobody is told about their own change.)


-- ---------------------------------------------------------------------
-- 5. Photos clients upload for their website (private; published copies go into the site's repo)
--    Path: <site_id>/<file name>
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-images', 'site-images', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'])
on conflict (id) do nothing;

create policy "site images: team all" on storage.objects for all to authenticated
  using (bucket_id = 'site-images' and public.is_staff())
  with check (bucket_id = 'site-images' and public.is_staff());
create policy "site images: client reads own" on storage.objects for select to authenticated
  using (bucket_id = 'site-images' and exists (
    select 1 from public.sites s where s.id::text = (storage.foldername(name))[1] and s.client_id = public.my_client_id()));
create policy "site images: client uploads own" on storage.objects for insert to authenticated
  with check (bucket_id = 'site-images' and exists (
    select 1 from public.sites s where s.id::text = (storage.foldername(name))[1] and s.client_id = public.my_client_id()));


-- ---------------------------------------------------------------------
-- 6. Keep a history of website settings in the activity log (migration 009)
-- ---------------------------------------------------------------------
create trigger audit_sites after insert or update or delete on public.sites
  for each row execute function public.audit_row();
create trigger audit_site_changes after insert or update or delete on public.site_changes
  for each row execute function public.audit_row();
