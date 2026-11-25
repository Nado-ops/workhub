-- =====================================================================
-- Work Hub — step 5: email notifications (via Resend)
-- Paste into Supabase → SQL Editor → New query → Run (after 004).
--
-- Emails go out when:
--   • a client raises a ticket      → admins get an alert, the client gets a receipt
--   • someone replies on a ticket   → team reply: the client's people; client reply: the assignee (or admins)
--   • a ticket is assigned          → the person it was assigned to
--   • a quote or invoice is sent    → the client's people
--   • a client accepts/declines a quote → admins
-- Internal notes NEVER send emails to clients.
--
-- The database sends the email itself (pg_net), after the change is saved.
-- Settings live in Supabase Vault (encrypted), not in the code:
--   resend_api_key, email_from, app_url  → see README "Emails" for the 3 lines to run.
-- Until the key is set, nothing is sent; each email is logged as "not set up".
-- =====================================================================

create extension if not exists pg_net with schema extensions;


-- ---------------------------------------------------------------------
-- 1. A log of every email, so you can see what went out
-- ---------------------------------------------------------------------
create table public.email_log (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  kind        text not null,
  to_emails   text[] not null,
  subject     text not null,
  request_id  bigint,          -- pg_net request, to look up Resend's answer
  status      text not null    -- 'queued' or 'not set up'
);
alter table public.email_log enable row level security;
create policy "email log: admin reads" on public.email_log for select to authenticated using (public.is_admin());


-- ---------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------
create or replace function public.setting(setting_name text)
returns text
language sql stable security definer set search_path = ''
as $$ select decrypted_secret from vault.decrypted_secrets where name = setting_name limit 1 $$;
revoke execute on function public.setting(text) from public, anon, authenticated;

create or replace function public.html_escape(t text)
returns text language sql immutable set search_path = ''
as $$ select replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') $$;

-- Rand amounts the South African way: R2 760.00
create or replace function public.rand_text(n numeric)
returns text language sql immutable set search_path = ''
as $$ select 'R' || replace(to_char(coalesce(n, 0), 'FM999,999,990.00'), ',', ' ') $$;

-- Emails of everyone with a role (e.g. all admins)
create or replace function public.emails_for_role(r public.app_role)
returns text[] language sql stable security definer set search_path = ''
as $$ select coalesce(array_agg(email), '{}') from public.profiles where role = r and email is not null $$;

-- Emails of the people who log in for a client company
create or replace function public.emails_for_client(c uuid)
returns text[] language sql stable security definer set search_path = ''
as $$ select coalesce(array_agg(email), '{}') from public.profiles where role = 'client' and client_id = c and email is not null $$;

-- The same simple, branded layout for every email
create or replace function public.email_layout(heading text, body_html text, button_text text, button_path text)
returns text language plpgsql stable security definer set search_path = ''
as $$
declare
  base text := coalesce(public.setting('app_url'), '');
begin
  return '<div style="background:#0A1315;padding:32px 16px;font-family:Arial,Helvetica,sans-serif">'
    || '<div style="max-width:560px;margin:0 auto;background:#0F1B1E;border:1px solid #1C2C2F;border-radius:16px;padding:28px;color:#E6EEEE">'
    || '<div style="font-size:13px;color:#8FA3A5;margin-bottom:8px">Work Hub</div>'
    || '<h1 style="font-size:20px;margin:0 0 14px;color:#E6EEEE">' || public.html_escape(heading) || '</h1>'
    || '<div style="font-size:14px;line-height:1.6;color:#C9D6D7">' || body_html || '</div>'
    || case when base <> '' and button_path is not null then
         '<a href="' || public.html_escape(rtrim(base, '/') || button_path) || '" style="display:inline-block;margin-top:20px;background:#3FD0B5;color:#062421;text-decoration:none;font-weight:bold;padding:11px 18px;border-radius:10px">'
         || public.html_escape(button_text) || '</a>'
       else '' end
    || '</div><div style="max-width:560px;margin:12px auto 0;font-size:11px;color:#6E8487;text-align:center">You get this because you have a Work Hub login.</div></div>';
end;
$$;

-- Send one email (to up to 50 people). Never blocks or breaks the save that triggered it.
create or replace function public.send_email(kind text, recipients text[], subject text, html text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  api_key text := public.setting('resend_api_key');
  sender  text := coalesce(public.setting('email_from'), 'Work Hub <onboarding@resend.dev>');
  to_list text[];
  req     bigint;
begin
  select array_agg(distinct e) into to_list from unnest(recipients) e where e is not null and e <> '';
  if to_list is null or cardinality(to_list) = 0 then
    return;
  end if;
  to_list := to_list[1:50];

  if api_key is null or api_key = '' then
    insert into public.email_log (kind, to_emails, subject, status) values (kind, to_list, subject, 'not set up');
    return;
  end if;

  select net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || api_key),
    body    := jsonb_build_object('from', sender, 'to', to_list, 'subject', subject, 'html', html)
  ) into req;

  insert into public.email_log (kind, to_emails, subject, request_id, status) values (kind, to_list, subject, req, 'queued');
exception when others then
  -- An email problem must never stop a ticket or invoice from saving.
  insert into public.email_log (kind, to_emails, subject, status) values (kind, coalesce(to_list, recipients), subject, 'error: ' || sqlerrm);
end;
$$;
revoke execute on function public.send_email(text, text[], text, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. Ticket emails
-- ---------------------------------------------------------------------
create or replace function public.email_on_ticket()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  creator_role public.app_role;
  creator_email text;
  client_name text;
  ref text := 'TCK-' || new.id;
begin
  select name into client_name from public.clients where id = new.client_id;

  if tg_op = 'INSERT' then
    select role, email into creator_role, creator_email from public.profiles where id = new.created_by;
    if creator_role = 'client' then
      perform public.send_email('ticket_new', public.emails_for_role('admin'),
        'New ticket ' || ref || ' from ' || coalesce(client_name, 'a client') || ': ' || new.title,
        public.email_layout('New ' || new.priority::text || ' ticket from ' || coalesce(client_name, 'a client'),
          '<p><b>' || public.html_escape(new.title) || '</b></p><p>' || public.html_escape(coalesce(new.description, '')) || '</p>',
          'Open ' || ref, '/app/tickets/' || new.id));
      perform public.send_email('ticket_received', array[creator_email],
        'We''ve received your ticket ' || ref,
        public.email_layout('We''ve got your ticket',
          '<p>Thanks — <b>' || public.html_escape(new.title) || '</b> is logged as ' || ref || '. We''ll keep you updated in your portal and by email.</p>',
          'View your ticket', '/portal/tickets/' || new.id));
    end if;

  elsif tg_op = 'UPDATE' and new.assignee_id is distinct from old.assignee_id
        and new.assignee_id is not null and new.assignee_id is distinct from auth.uid() then
    perform public.send_email('ticket_assigned',
      array[(select email from public.profiles where id = new.assignee_id)],
      ref || ' was assigned to you: ' || new.title,
      public.email_layout('A ticket was assigned to you',
        '<p><b>' || public.html_escape(new.title) || '</b><br>' || public.html_escape(coalesce(client_name, '')) || ' · ' || new.priority::text || ' priority</p>',
        'Open ' || ref, '/app/tickets/' || new.id));
  end if;
  return new;
end;
$$;

create trigger tickets_email
  after insert or update of assignee_id on public.tickets
  for each row execute function public.email_on_ticket();


create or replace function public.email_on_message()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  t public.tickets;
  author_role public.app_role;
  author_name text;
  ref text;
  preview text;
begin
  if new.is_internal then
    return new;                       -- internal notes never email anyone
  end if;
  select * into t from public.tickets where id = new.ticket_id;
  select role, full_name into author_role, author_name from public.profiles where id = new.author_id;
  ref := 'TCK-' || t.id;
  preview := '<p style="border-left:3px solid #3FD0B5;padding-left:12px;white-space:pre-line">'
             || public.html_escape(left(new.body, 1500)) || '</p>';

  if author_role = 'client' then
    perform public.send_email('reply_from_client',
      case when t.assignee_id is not null
           then array[(select email from public.profiles where id = t.assignee_id)]
           else public.emails_for_role('admin') end,
      'Client replied on ' || ref || ': ' || t.title,
      public.email_layout(coalesce(nullif(author_name, ''), 'The client') || ' replied', preview, 'Open ' || ref, '/app/tickets/' || t.id));
  else
    perform public.send_email('reply_from_team', public.emails_for_client(t.client_id),
      'New reply on your ticket ' || ref || ': ' || t.title,
      public.email_layout('New reply on ' || ref, preview, 'Reply in your portal', '/portal/tickets/' || t.id));
  end if;
  return new;
end;
$$;

create trigger ticket_messages_email
  after insert on public.ticket_messages
  for each row execute function public.email_on_message();


-- ---------------------------------------------------------------------
-- 4. Quote & invoice emails
--    (The app saves the lines first and marks it "sent" last, so the total is right.)
-- ---------------------------------------------------------------------
create or replace function public.email_on_document()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  total numeric;
  client_name text;
  word text := case when new.kind = 'invoice' then 'invoice' else 'quote' end;
begin
  select dt.total into total from public.document_totals dt where dt.document_id = new.id;
  select name into client_name from public.clients where id = new.client_id;

  if new.status = 'sent' and (tg_op = 'INSERT' or old.status is distinct from 'sent') then
    perform public.send_email('document_sent', public.emails_for_client(new.client_id),
      'New ' || word || ' ' || new.number || coalesce(' — ' || new.title, ''),
      public.email_layout('You have a new ' || word,
        '<p><b>' || new.number || '</b>' || coalesce(' · ' || public.html_escape(new.title), '') || '<br>'
        || 'Total: <b>' || public.rand_text(total) || '</b><br>'
        || case when new.kind = 'invoice' then 'Due ' else 'Valid until ' end || coalesce(to_char(new.due_date, 'DD Mon YYYY'), '—') || '</p>'
        || case when new.kind = 'quote' then '<p>You can accept or decline it in your portal.</p>' else '<p>Payment details are on the invoice in your portal.</p>' end,
        'View ' || word, '/portal/invoices'));

  elsif tg_op = 'UPDATE' and new.kind = 'quote' and old.status = 'sent' and new.status in ('accepted', 'declined') then
    perform public.send_email('quote_' || new.status::text, public.emails_for_role('admin'),
      coalesce(client_name, 'A client') || ' ' || new.status::text || ' quote ' || new.number,
      public.email_layout('Quote ' || new.number || ' was ' || new.status::text,
        '<p>' || public.html_escape(coalesce(client_name, 'The client')) || ' ' || new.status::text || ' <b>' || new.number || '</b>'
        || coalesce(' (' || public.html_escape(new.title) || ')', '') || ' — ' || public.rand_text(total) || '.</p>'
        || case when new.status = 'accepted' then '<p>Next step: turn it into an invoice in Finance.</p>' else '' end,
        'Open Finance', '/app/finance'));
  end if;
  return new;
end;
$$;

create trigger documents_email
  after insert or update of status on public.documents
  for each row execute function public.email_on_document();


-- ---------------------------------------------------------------------
-- 5. Admin tools: send yourself a test email, and see recent emails
--    with Resend's answer (200 = accepted).
-- ---------------------------------------------------------------------
create or replace function public.send_test_email()
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  me text;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select email into me from public.profiles where id = auth.uid();
  perform public.send_email('test', array[me], 'Work Hub test email',
    public.email_layout('Emails are working', '<p>If you can read this, Work Hub can send emails.</p>', 'Open Work Hub', '/'));
  return coalesce((select status from public.email_log order by id desc limit 1), 'unknown');
end;
$$;
revoke execute on function public.send_test_email() from public, anon;
grant execute on function public.send_test_email() to authenticated;

create or replace function public.recent_emails()
returns table (id bigint, created_at timestamptz, kind text, to_emails text[], subject text, status text, status_code int, error text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query
    select l.id, l.created_at, l.kind, l.to_emails, l.subject, l.status,
           r.status_code,
           case when r.status_code is not null and r.status_code >= 300 then left(r.content::text, 300) else r.error_msg end
    from public.email_log l
    left join net._http_response r on r.id = l.request_id
    order by l.id desc
    limit 30;
end;
$$;
revoke execute on function public.recent_emails() from public, anon;
grant execute on function public.recent_emails() to authenticated;
