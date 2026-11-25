-- =====================================================================
-- Work Hub — step 6: vendors (the services and suppliers you pay for)
-- Paste into Supabase → SQL Editor → New query → Run (after 005).
--
-- Keeps track of things like Resend, Cloudflare, Supabase, domains,
-- Divi licences and hosting: what it's for, what it costs, when it
-- renews, which client it's for, and which email the account is under.
-- Passwords do NOT belong here — keep those in a password manager.
--
-- Admins only. Every morning at 08:00 (South Africa) admins get one
-- email listing anything that renews soon.
-- =====================================================================

create table public.vendors (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,                       -- e.g. Resend
  category           text,                                -- e.g. Email sending
  purpose            text,                                -- what we use it for
  website            text,
  account_email      text,                                -- which login owns the account
  client_id          uuid references public.clients (id) on delete set null,  -- null = internal
  cost               numeric(12,2) not null default 0,
  currency           text not null default 'ZAR' check (currency in ('ZAR', 'USD', 'EUR', 'GBP')),
  billing_cycle      text not null default 'monthly' check (billing_cycle in ('monthly', 'yearly', 'once', 'free')),
  renewal_date       date,
  remind_days_before int not null default 14 check (remind_days_before between 0 and 90),
  status             text not null default 'active' check (status in ('active', 'cancelled')),
  notes              text,
  created_at         timestamptz not null default now()
);

alter table public.vendors enable row level security;
create policy "vendors: admin all" on public.vendors for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create index on public.vendors (renewal_date);


-- One email to admins listing what renews soon (each vendor uses its own
-- "remind me X days before"). Sends nothing if nothing is due.
create or replace function public.email_vendor_renewals()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  rows_html text;
  n int;
begin
  select count(*),
         string_agg(
           '<tr><td style="padding:6px 12px 6px 0">' || public.html_escape(v.name) || '</td>'
           || '<td style="padding:6px 12px 6px 0;color:#8FA3A5">' || public.html_escape(coalesce(c.name, 'Internal')) || '</td>'
           || '<td style="padding:6px 12px 6px 0">' || to_char(v.renewal_date, 'DD Mon YYYY')
           || ' (' || (v.renewal_date - current_date) || ' days)</td>'
           || '<td style="padding:6px 0">' || v.currency || ' ' || replace(to_char(v.cost, 'FM999,999,990.00'), ',', ' ') || '</td></tr>',
           '' order by v.renewal_date)
    into n, rows_html
  from public.vendors v
  left join public.clients c on c.id = v.client_id
  where v.status = 'active'
    and v.renewal_date is not null
    and v.renewal_date >= current_date
    and v.renewal_date <= current_date + v.remind_days_before;

  if n = 0 then
    return 0;
  end if;

  perform public.send_email('vendor_renewals', public.emails_for_role('admin'),
    n || case when n = 1 then ' vendor renews soon' else ' vendors renew soon' end,
    public.email_layout('Coming up for renewal',
      '<table style="font-size:14px;color:#C9D6D7;border-collapse:collapse">' || rows_html || '</table>'
      || '<p>Cancel anything you no longer need before it renews.</p>',
      'Open Vendors', '/app/vendors'));
  return n;
end;
$$;
revoke execute on function public.email_vendor_renewals() from public, anon, authenticated;


-- Run the check every day at 06:00 UTC (08:00 in South Africa).
create extension if not exists pg_cron;
select cron.schedule('vendor-renewal-reminders', '0 6 * * *', 'select public.email_vendor_renewals()');
