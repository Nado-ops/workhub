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
- Keep the dark teal look: use the shared classes in `src/index.css` (`card`, `input`, `label`,
  `btn-primary`, `btn-ghost`, `pill`, `th`, `td`) and the colour tokens there.
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
- Built: Overview, Tickets, Ticket detail, Clients, Team, Projects, Finance (quotes, invoices, claims approval),
  client Dashboard, Tickets, Projects, Quotes & invoices.
- Designed but not built yet: CRM pipeline, Reports, HR (incl. staff claim submission), Study.
  Build each one against the existing tables in 001.
- Shared helpers: `src/components/Tabs.tsx`, `src/components/PhaseSteps.tsx`, `src/lib/finance.ts`, `src/lib/business.ts`.
