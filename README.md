# Work Hub

One place for clients, support tickets, projects, CRM, finance, HR and reports —
with separate logins for **admin**, **staff** and **clients**.

Built with React + TypeScript (Vite), Tailwind, and **Supabase** for the database
and logins. Hosted on **Cloudflare Pages**.

## What works today

| Area | Status |
|---|---|
| Login, forgot password, set password from invite | ✅ |
| Role-based menus (admin / staff / client) | ✅ |
| Overview (live counts, what's due today) | ✅ |
| Support tickets: queue, deadline clock, new ticket | ✅ |
| Ticket detail: replies, internal notes, status / assignee / priority | ✅ |
| Remote session timer (saved to the database) | ✅ |
| Clients: list, add, edit | ✅ |
| Team & roles: set role and company for each login | ✅ (admin only) |
| Client portal: dashboard, raise ticket, my tickets, reply | ✅ |
| Projects, CRM pipeline, Finance, Reports, HR, Study | 🔜 designed, coming next |

Designs for every screen: the "Work Hub" canvas in Claude.

## First-time setup

### 1. Database (Supabase)
In Supabase → **SQL Editor**, run each file in `supabase/migrations/` **in order**, once:

1. `001_work_hub_schema.sql` — tables, roles and security rules
2. `002_ticket_deadlines.sql` — automatic ticket deadlines from priority

Then make yourself admin:

```sql
update public.profiles set role = 'admin', full_name = 'Your Name' where email = 'you@example.com';
```

In **Authentication → URL Configuration**:
- **Site URL**: your live app address (e.g. `https://workhub.pages.dev`)
- **Redirect URLs**: add `https://workhub.pages.dev/reset-password` and `http://localhost:5173/**`

### 2. Run it on your PC
```bash
npm install
cp .env.example .env.local   # then paste your Supabase URL and anon key into .env.local
npm run dev                  # opens on http://localhost:5173
```

### 3. Put it live (Cloudflare Pages)
Cloudflare → **Workers & Pages → Create → Pages → Connect to Git** → pick this repo.

- Production branch: `main`
- Build command: `npm run build`
- Build output directory: `dist`
- Environment variables (Production **and** Preview):
  - `VITE_SUPABASE_URL` = your Supabase project URL
  - `VITE_SUPABASE_ANON_KEY` = your Supabase anon / public key
  - `NODE_VERSION` = `22`

`public/_redirects` makes page refreshes work on every route.

## Adding people
1. Supabase → **Authentication → Users → Invite user** (enter their email).
2. They get an email, click it, and choose a password.
3. In the app → **Team & roles**: set them to **Staff**, or **Client** + their company.

Until step 3, a new login sees a "not set up yet" message and no data.

## Branches
- `main` = live. Cloudflare deploys it automatically.
- `dev` = where new work happens (Claude, Codex, you). Cloudflare gives every push a preview link.
- When a preview looks good, open a pull request from `dev` into `main` and merge.

## Security, in short
- Every table has **Row Level Security**. The database itself decides what each login can see,
  so hiding a menu item is never the only protection.
- Clients only ever get their own company's data, and never see internal notes.
- Only the **anon** key goes in the app. The **service_role** key must never be in this repo,
  in Cloudflare's frontend settings, or pasted into chat.
