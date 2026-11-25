-- =====================================================================
-- 015 — Plainer email wording (no em dashes, no passive "was assigned" / "was accepted")
-- Run this once in the Supabase SQL Editor (after 014). Same emails, same triggers; only the words change.
-- =====================================================================

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
          '<p>Thanks. We logged <b>' || public.html_escape(new.title) || '</b> as ' || ref || ' and will keep you updated in your portal and by email.</p>',
          'View your ticket', '/portal/tickets/' || new.id));
    end if;

  elsif tg_op = 'UPDATE' and new.assignee_id is distinct from old.assignee_id
        and new.assignee_id is not null and new.assignee_id is distinct from auth.uid() then
    perform public.send_email('ticket_assigned',
      array[(select email from public.profiles where id = new.assignee_id)],
      'You have a new ticket, ' || ref || ': ' || new.title,
      public.email_layout(public.actor_name() || ' gave you ' || ref,
        '<p><b>' || public.html_escape(new.title) || '</b><br>' || public.html_escape(coalesce(client_name, '')) || ' · ' || new.priority::text || ' priority</p>',
        'Open ' || ref, '/app/tickets/' || new.id));
  end if;
  return new;
end;
$$;

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
      'New ' || word || ' ' || new.number || coalesce(': ' || new.title, ''),
      public.email_layout('You have a new ' || word,
        '<p><b>' || new.number || '</b>' || coalesce(' · ' || public.html_escape(new.title), '') || '<br>'
        || 'Total: <b>' || public.rand_text(total) || '</b><br>'
        || case when new.kind = 'invoice' then 'Due ' else 'Valid until ' end || coalesce(to_char(new.due_date, 'DD Mon YYYY'), '—') || '</p>'
        || case when new.kind = 'quote' then '<p>You can accept or decline it in your portal.</p>' else '<p>You''ll find the payment details on the invoice in your portal.</p>' end,
        'View ' || word, '/portal/invoices'));

  elsif tg_op = 'UPDATE' and new.kind = 'quote' and old.status = 'sent' and new.status in ('accepted', 'declined') then
    perform public.send_email('quote_' || new.status::text, public.emails_for_role('admin'),
      coalesce(client_name, 'A client') || ' ' || new.status::text || ' quote ' || new.number,
      public.email_layout(coalesce(client_name, 'The client') || ' ' || new.status::text || ' quote ' || new.number,
        '<p>' || public.html_escape(coalesce(client_name, 'The client')) || ' ' || new.status::text || ' <b>' || new.number || '</b>'
        || coalesce(' (' || public.html_escape(new.title) || ')', '') || ', worth ' || public.rand_text(total) || '.</p>'
        || case when new.status = 'accepted' then '<p>Next step: turn it into an invoice in Finance.</p>' else '' end,
        'Open Finance', '/app/finance'));
  end if;
  return new;
end;
$$;
