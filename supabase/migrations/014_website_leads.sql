-- =====================================================================
-- 014 — Website contact forms send leads straight into the CRM pipeline
-- Run this once in the Supabase SQL Editor (after 013).
--
-- • lead_sources   — each website that may send leads (its domains + a form key)
-- • intake_lead()  — turns one form submission into a deal + contact + note, and tells the team.
--   Only the Work Hub server can call it (service_role), after checking the website and spam traps.
-- =====================================================================

create table public.lead_sources (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,                          -- e.g. "nanotechnology6.co.za"
  domains        text[] not null,                        -- websites allowed to send, e.g. {nanotechnology6.co.za}
  form_key       uuid not null unique default gen_random_uuid(),  -- goes in the form; not a secret, just an ID
  default_owner  uuid references public.profiles (id) on delete set null,  -- who new leads are assigned to
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  check (cardinality(domains) between 1 and 10)
);

alter table public.lead_sources enable row level security;
create policy "lead sources: team reads"    on public.lead_sources for select to authenticated using (public.is_staff());
create policy "lead sources: admin manages" on public.lead_sources for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.deals add column lead_source_id uuid references public.lead_sources (id) on delete set null;

create trigger audit_lead_sources after insert or update or delete on public.lead_sources
  for each row execute function public.audit_row();

-- "https://www.Example.co.za/contact" → "example.co.za"
create or replace function public.bare_host(p_url text)
returns text language sql immutable set search_path = ''
as $$ select regexp_replace(lower(split_part(split_part(regexp_replace(coalesce(p_url, ''), '^[a-z]+://', '', 'i'), '/', 1), ':', 1)), '^www\.', '') $$;


-- ---------------------------------------------------------------------
-- One form submission → a lead in the pipeline.
-- Same email from the same website within an hour adds a note to the existing lead instead of a new one.
-- ---------------------------------------------------------------------
create or replace function public.intake_lead(
  p_key uuid, p_origin text, p_name text, p_email text, p_phone text,
  p_company text, p_message text, p_page text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  src     public.lead_sources%rowtype;
  host    text := public.bare_host(p_origin);
  v_deal  uuid;
  v_name  text := left(trim(coalesce(p_name, '')), 120);
  v_email text := lower(left(trim(coalesce(p_email, '')), 200));
  v_phone text := left(trim(coalesce(p_phone, '')), 40);
  v_comp  text := left(trim(coalesce(p_company, '')), 160);
  v_msg   text := left(trim(coalesce(p_message, '')), 5000);
  r       record;
begin
  select * into src from public.lead_sources where form_key = p_key and active;
  if not found then
    raise exception 'unknown_form';
  end if;
  -- The website sending must be one of this source's domains (or a subdomain of one).
  if not exists (select 1 from unnest(src.domains) d
                 where host = public.bare_host(d) or host like '%.' || public.bare_host(d)) then
    raise exception 'wrong_website';
  end if;
  if v_name = '' or (v_email = '' and v_phone = '') then
    raise exception 'missing_details';
  end if;
  -- Flood protection: at most 30 leads per website per 10 minutes.
  if (select count(*) from public.deals where lead_source_id = src.id and created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'too_many';
  end if;

  -- Same person again within an hour? Add to that lead.
  if v_email <> '' then
    select d.id into v_deal from public.deals d join public.contacts c on c.deal_id = d.id
    where d.lead_source_id = src.id and c.email = v_email and d.created_at > now() - interval '1 hour'
    order by d.created_at desc limit 1;
  end if;

  if v_deal is null then
    insert into public.deals (company, description, stage, owner_id, next_step, next_step_on, lead_source_id)
    values (coalesce(nullif(v_comp, ''), v_name), nullif(left(regexp_replace(v_msg, '\s+', ' ', 'g'), 120), ''),
            'lead', src.default_owner, 'Reply to website enquiry', current_date, src.id)
    returning id into v_deal;
    -- deals.source (migration 007) says where leads come from
    update public.deals set source = 'website' where id = v_deal;

    insert into public.contacts (deal_id, full_name, email, phone, is_primary)
    values (v_deal, v_name, nullif(v_email, ''), nullif(v_phone, ''), true);
  end if;

  insert into public.deal_activities (deal_id, kind, summary, user_id)
  values (v_deal, 'email',
          'Website enquiry (' || src.name || coalesce(', ' || nullif(left(p_page, 200), ''), '') || '): '
            || coalesce(nullif(v_msg, ''), '(no message)')
            || case when v_phone <> '' then E'\nPhone: ' || v_phone else '' end,
          null);

  -- Tell the lead's owner, or every admin if nobody owns this website's leads.
  for r in select id from public.profiles where (src.default_owner is not null and id = src.default_owner)
                                            or (src.default_owner is null and role = 'admin') loop
    perform public.notify(r.id, 'lead', 'New lead from ' || src.name || ': ' || v_name,
      left(coalesce(nullif(v_msg, ''), v_email), 140), '/app/pipeline');
  end loop;

  return jsonb_build_object('deal_id', v_deal);
end;
$$;
revoke all on function public.intake_lead(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.intake_lead(uuid, text, text, text, text, text, text, text) to service_role;

-- The server needs to know which websites may send (for the browser's CORS check). Service role only.
create or replace function public.lead_source_domains(p_key uuid)
returns text[] language sql stable security definer set search_path = ''
as $$ select domains from public.lead_sources where form_key = p_key and active $$;
revoke all on function public.lead_source_domains(uuid) from public, anon, authenticated;
grant execute on function public.lead_source_domains(uuid) to service_role;


-- New leads also go by email (like tasks and announcements), unless the person switched emails off.
create or replace function public.notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text)
returns void language plpgsql security definer set search_path = ''
as $$
declare p public.profiles%rowtype;
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  insert into public.notifications (user_id, kind, title, body, link) values (p_user, p_kind, p_title, p_body, p_link);

  if p_kind in ('task', 'announcement', 'leave', 'claim', 'event', 'lead') then
    select * into p from public.profiles where id = p_user;
    if p.email_notifications and p.email is not null then
      perform public.send_email('notification_' || p_kind, array[p.email], p_title,
        public.email_layout(p_title, coalesce('<p>' || public.html_escape(p_body) || '</p>', ''), 'Open Work Hub', p_link));
    end if;
  end if;
end;
$$;
revoke all on function public.notify(uuid, text, text, text, text) from public, anon, authenticated;
