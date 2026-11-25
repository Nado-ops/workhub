-- =====================================================================
-- 007 — CRM: contacts, activity history, lead source, won deal → client
-- Run this once in the Supabase SQL Editor (after 001–006).
--
-- What it adds:
--   • deals.source        — where the lead came from (referral, website, …)
--   • contacts            — the people at a company (on a deal, and later on the client)
--   • deal_activities     — calls, emails, meetings and notes logged on a deal
--   • convert_deal()      — one click: won deal → new client (+ draft quote for admins)
-- Rules: CRM is team-only (admin + staff), same as deals. Clients see none of this.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Where each lead came from
-- ---------------------------------------------------------------------
alter table public.deals
  add column source text
    check (source in ('referral', 'website', 'social_media', 'cold_outreach', 'event', 'existing_client', 'other'));


-- ---------------------------------------------------------------------
-- 2. Contacts — a person belongs to a deal, a client, or both
--    (when a deal is converted, its contacts are linked to the new client)
-- ---------------------------------------------------------------------
create table public.contacts (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid references public.deals (id) on delete set null,
  client_id   uuid references public.clients (id) on delete cascade,
  full_name   text not null,
  job_title   text,
  email       text,
  phone       text,
  is_primary  boolean not null default false,   -- the main person to talk to
  notes       text,
  created_at  timestamptz not null default now(),
  constraint contacts_belong_somewhere check (deal_id is not null or client_id is not null)
);
create index contacts_deal_idx   on public.contacts (deal_id);
create index contacts_client_idx on public.contacts (client_id);

-- When a deal is deleted: its contacts that never became client contacts go with it;
-- contacts already linked to a client stay (deal_id just becomes empty).
create or replace function public.delete_deal_only_contacts()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.contacts where deal_id = old.id and client_id is null;
  return old;
end;
$$;
create trigger deals_delete_contacts before delete on public.deals
  for each row execute function public.delete_deal_only_contacts();

alter table public.contacts enable row level security;
create policy "contacts: team all" on public.contacts for all to authenticated
  using (public.is_staff()) with check (public.is_staff());


-- ---------------------------------------------------------------------
-- 3. Activity history on a deal
-- ---------------------------------------------------------------------
create table public.deal_activities (
  id           uuid primary key default gen_random_uuid(),
  deal_id      uuid not null references public.deals (id) on delete cascade,
  kind         text not null check (kind in ('call', 'email', 'meeting', 'note')),
  summary      text not null,
  happened_at  timestamptz not null default now(),
  user_id      uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index deal_activities_deal_idx on public.deal_activities (deal_id, happened_at desc);

alter table public.deal_activities enable row level security;
-- The whole team can read and add; you can only change or delete your own (admin can do any).
create policy "activities: team reads"  on public.deal_activities for select to authenticated using (public.is_staff());
create policy "activities: team adds"   on public.deal_activities for insert to authenticated
  with check (public.is_staff() and user_id = auth.uid());
create policy "activities: own or admin updates" on public.deal_activities for update to authenticated
  using (public.is_admin() or (public.is_staff() and user_id = auth.uid()))
  with check (public.is_admin() or (public.is_staff() and user_id = auth.uid()));
create policy "activities: own or admin deletes" on public.deal_activities for delete to authenticated
  using (public.is_admin() or (public.is_staff() and user_id = auth.uid()));


-- ---------------------------------------------------------------------
-- 4. Won deal → client (+ draft quote)
--    Staff can convert. Only admins get the draft quote, because Finance is admin-only.
--    Safe to click twice: it reuses the client if the deal is already linked.
-- ---------------------------------------------------------------------
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

  -- Reuse the client if this deal was converted before; otherwise create one.
  v_client := d.client_id;
  if v_client is null then
    insert into public.clients (name, plan, notes)
    values (d.company, 'Project only',
            'Won from the CRM pipeline' || coalesce(' (' || d.description || ')', ''))
    returning id into v_client;
  end if;

  -- Mark the deal as won and link it to the client.
  update public.deals set stage = 'won', client_id = v_client where id = d.id;

  -- The deal's people become the client's contacts.
  update public.contacts set client_id = v_client where deal_id = d.id and client_id is null;

  -- Draft quote with one line for the deal value (admins only).
  if p_make_quote and public.is_admin() then
    insert into public.documents (kind, client_id, title, status, due_date)
    values ('quote', v_client, coalesce(d.description, d.company), 'draft', current_date + 14)
    returning id into v_quote;

    insert into public.document_lines (document_id, position, description, qty, unit_price)
    values (v_quote, 0, coalesce(d.description, 'Work for ' || d.company), 1, d.amount);
  end if;

  return jsonb_build_object('client_id', v_client, 'quote_id', v_quote);
end;
$$;

revoke all on function public.convert_deal(uuid, boolean) from public, anon;
grant execute on function public.convert_deal(uuid, boolean) to authenticated;
