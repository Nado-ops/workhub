# Notes for AI assistants (Claude, Codex) working on Work Hub

Owner: Nadeem. He is learning JavaScript/TypeScript — explain changes in plain language,
keep code readable, and add short comments where something isn't obvious.

## Stack
- Vite + React 19 + TypeScript (strict), react-router v7, Tailwind v4 (`src/index.css`)
- Supabase (database + auth) via `src/lib/supabase.ts` — browser uses the anon key only
- Cloudflare Workers hosting with static assets (`wrangler.jsonc`, `npm run build` → `dist`). No `_redirects` file.

## Rules
- Work on the `dev` branch. `main` is live.
- Database changes = a NEW numbered file in `supabase/migrations/` (e.g. `003_projects.sql`).
  Never edit a migration that has already been run. Tell Nadeem to run the new file in the Supabase SQL Editor.
- Every new table gets Row Level Security in the same migration, matching the role table below.
- Never put the service_role key or any secret in the repo.
- Client-facing actions that change data (approve an extra, accept a quote) go through
  SECURITY DEFINER functions (see `respond_to_extra`, `respond_to_quote`), not open UPDATE policies.
- Look: light inside the app (navy text, gold buttons, navy side menu `theme-navy`); login and reset password stay dark
  (`theme-dark`). Use the shared classes in `src/index.css` (`card`, `input`, `label`, `btn-primary`, `btn-ghost`, `pill`,
  `th`, `td`) and the colour tokens there (`accent-text` for gold text, `success`/`danger`/`warn`/`info` + `-soft`).
  Don't hard-code hex colours in pages.
- Run `npm run build` before committing; it must pass.

## Roles (source of truth: the Team & roles design + 001 migration)
| | Admin | Staff | Client |
|---|---|---|---|
| Tickets | all | all | own company, no internal notes |
| Clients, projects, CRM | all | all | own projects only |
| Finance (quotes/invoices) | all | none | own, once sent |
| Claims | approve/pay | submit own | none |
| HR (leave, time, docs) | all | own | none |
| Study reminders | own only | own only | none |
| Team & roles | yes | no | no |

## Layout
- `src/layouts/AdminLayout.tsx` — admin/staff menu (role-filtered)
- `src/layouts/ClientLayout.tsx` — client portal header
- `src/pages/admin/*`, `src/pages/client/*` — screens
- `src/auth/*` — session/profile and route guards
- Built: every designed screen. Admin/staff: Overview, Tickets, Ticket detail, Clients, Projects, CRM pipeline,
  Finance, Reports, Study, HR, Team. Client: Dashboard, Tickets, Projects, Quotes & invoices.
- File uploads: private Storage buckets `receipts`, `hr-docs`, `ticket-files` (migration 004); use `src/lib/files.ts`
  (`uploadFile`, `openFile` with 60-second signed links) — never make a bucket public.
- Emails: database triggers call Resend through pg_net (migration 005). Settings live in Supabase Vault
  (`resend_api_key`, `email_from`, `app_url`), read with `public.setting()`. Send with `public.send_email()`;
  every email is logged in `email_log`. Never email clients about internal notes.
- Vendors (admin only, migration 006): pg_cron runs `email_vendor_renewals()` daily at 06:00 UTC.
- CRM (migration 007): `contacts` (on a deal and/or client), `deal_activities` (call/email/meeting/note), `deals.source`.
  `convert_deal()` turns a deal into a client and, for admins, a draft quote. Team-only; clients see none of it.
- Internal work (migration 008, team-only): `tasks`, `kb_articles`, `announcements` (admins post), `notifications`.
  Notifications are only created by database triggers (`public.notify()`); the browser can read/mark/delete its own.
  Pages: My work, Tasks, Knowledge base, Announcements; bell = `src/components/NotificationBell.tsx`.
- Migration 009: `business_profile` (one row, edited on Team & settings, printed on PDFs; replaces the old
  constants), `clients.billing_details`, `tickets.resolved_at`, `client_month_report()` RPC (team: any client;
  client: own) + pg_cron monthly email on the 1st, `events` (calendar; private = creator only), `audit_log`
  (triggers on key tables, admin read-only, kept 1 year), `profiles.email_notifications` (notify() also emails
  task/event/announcement/leave/claim), emails in the navy/gold look.
- Printable pages (outside the layouts): `/print/doc/:id` (PrintDocument) and `/app/report` + `/portal/report`
  (MonthlyReport). "Download PDF" = `window.print()` → Save as PDF; `PrintBar` is hidden when printing.
- Calendar (`/app/calendar`) merges events, approved leave, task/project/invoice/renewal dates, CRM follow-ups,
  own study reminders and SA public holidays (`src/lib/holidays.ts`). Activity log (`/app/activity`, admin) has
  the JSON backup download.
- Not built yet: study reminder emails.
- Shared helpers: `src/lib/team.ts` (`useTeam`), `src/components/Tabs.tsx`, `src/components/PhaseSteps.tsx`, `src/lib/finance.ts`, `src/lib/business.ts` (`useBusiness`), `src/lib/files.ts`, `src/components/TicketFiles.tsx`, `src/components/EmailSettings.tsx`.
