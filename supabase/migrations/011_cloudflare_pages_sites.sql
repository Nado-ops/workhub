-- =====================================================================
-- 011 — Website CMS for Cloudflare Pages sites WITHOUT GitHub (direct upload)
-- Run this once in the Supabase SQL Editor (after 010).
--
-- For these sites Work Hub keeps its own copy of the website files (Storage bucket "site-files"
-- + the site_files list). You upload a new version in Work Hub, and Work Hub sends it to Cloudflare.
-- Client edits are applied on top of that copy and the site is re-deployed.
-- If someone uploads a newer version straight in the Cloudflare dashboard, Work Hub notices
-- (the latest deployment isn't the one it made) and asks for the new files before publishing.
-- =====================================================================

alter table public.sites drop constraint if exists sites_kind_check;
alter table public.sites add constraint sites_kind_check check (kind in ('github', 'cloudflare', 'wordpress', 'other'));

alter table public.sites
  add column cf_account_id    text,          -- Cloudflare account ID (from the dashboard URL / overview page)
  add column cf_project       text,          -- the Pages project name
  add column cf_deployment_id text,          -- the last deployment Work Hub made (to spot dashboard uploads)
  add column cf_deployed_at   timestamptz;

alter table public.sites add constraint sites_cloudflare_check
  check (kind <> 'cloudflare' or (cf_account_id ~ '^[0-9a-f]{32}$' and cf_project ~ '^[a-z0-9][a-z0-9-]{0,57}$'));


-- The value of each editable part as it is in the uploaded files. When you upload a new version,
-- parts you didn't change keep the client's edits; parts you did change take your new version.
alter table public.site_fields add column base_value text;


-- ---------------------------------------------------------------------
-- Work Hub's copy of each file on a Cloudflare Pages site.
--   hash          = the file as uploaded (Cloudflare's own fingerprint: blake3 of base64 + extension)
--   deployed_hash = what's live now (differs for pages with client edits on top)
--   source        = where the bytes are: 'site-files' (the uploaded copy) or 'site-images:<path>' (a client photo)
-- ---------------------------------------------------------------------
create table public.site_files (
  site_id        uuid not null references public.sites (id) on delete cascade,
  path           text not null,              -- e.g. "index.html", "css/style.css" (no leading slash)
  size           bigint not null default 0,
  content_type   text,
  hash           text not null,
  deployed_hash  text,
  source         text not null default 'site-files',
  updated_at     timestamptz not null default now(),
  primary key (site_id, path),
  check (path !~ '(^/|\.\./|^\.\.$)')
);

alter table public.site_files enable row level security;
create policy "site files: team reads"       on public.site_files for select to authenticated using (public.is_staff());
create policy "site files: client reads own" on public.site_files for select to authenticated
  using (exists (select 1 from public.sites s where s.id = site_id and s.client_id = public.my_client_id()));
create policy "site files: admin writes"     on public.site_files for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- After a deployment: remember what's live. Same permission rule as publishing a change
-- (team, or the client on a site that doesn't need approval).
create or replace function public.cms_record_deploy(p_site uuid, p_deployment text, p_files jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  s public.sites%rowtype;
  f jsonb;
begin
  select * into s from public.sites where id = p_site;
  if not found then raise exception 'Website not found'; end if;
  if not (public.is_staff() or (s.client_id = public.my_client_id() and not s.requires_approval)) then
    raise exception 'Not allowed';
  end if;

  update public.sites set cf_deployment_id = p_deployment, cf_deployed_at = now() where id = p_site;

  -- p_files: [{"path": "...", "deployed_hash": "...", "hash"?, "size"?, "content_type"?, "source"?}]
  for f in select * from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) loop
    -- Clients may only add photos under images/uploads/ (from their own uploads); pages they can only update.
    if not public.is_staff() and not exists (select 1 from public.site_files where site_id = p_site and path = f ->> 'path')
       and (f ->> 'path') !~ '^images/uploads/[\w.-]+$' then
      raise exception 'Not allowed to add %', f ->> 'path';
    end if;
    insert into public.site_files (site_id, path, size, content_type, hash, deployed_hash, source)
    values (p_site, f ->> 'path', coalesce((f ->> 'size')::bigint, 0), f ->> 'content_type',
            coalesce(f ->> 'hash', f ->> 'deployed_hash'), f ->> 'deployed_hash', coalesce(f ->> 'source', 'site-files'))
    on conflict (site_id, path) do update
      set deployed_hash = excluded.deployed_hash, updated_at = now();
  end loop;
end;
$$;
revoke all on function public.cms_record_deploy(uuid, text, jsonb) from public, anon;
grant execute on function public.cms_record_deploy(uuid, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- Storage: site-files/<site_id>/<path>. Only admins upload; the team and the site's client can read
-- (the files are on the public website anyway, and the server needs them when a client publishes).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('site-files', 'site-files', false, 52428800)
on conflict (id) do nothing;

create policy "site files bucket: admin writes" on storage.objects for all to authenticated
  using (bucket_id = 'site-files' and public.is_admin())
  with check (bucket_id = 'site-files' and public.is_admin());
create policy "site files bucket: team reads" on storage.objects for select to authenticated
  using (bucket_id = 'site-files' and public.is_staff());
create policy "site files bucket: client reads own" on storage.objects for select to authenticated
  using (bucket_id = 'site-files' and exists (
    select 1 from public.sites s where s.id::text = (storage.foldername(name))[1] and s.client_id = public.my_client_id()));
