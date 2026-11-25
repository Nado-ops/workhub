# Work Hub

One place for clients, support tickets, projects, CRM, finance, HR and reports —
with separate logins for **admin**, **staff** and **clients**.

Built with React + TypeScript (Vite), Tailwind, and **Supabase** for the database
and logins. Hosted on **Cloudflare Workers** (static assets).

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
| Projects: cards by status, add/edit, phases, budget, extra work | ✅ |
| Finance: quotes & invoices (builder, preview, send, mark paid, quote → invoice), claims approval | ✅ (admin only) |
| Client portal: my projects (approve extras), quotes & invoices (accept quotes) | ✅ |
| CRM pipeline: deals by stage, move, lost/reopen | ✅ |
| HR: people, leave (request/approve, who's out), timesheets, claims, documents | ✅ (staff see their own) |
| Reports: tickets, remote support, projects, money (admin) | ✅ |
| Study reminders (private) | ✅ |
| File uploads: receipt photos, HR document files, ticket screenshots (private, images & PDFs, 10 MB) | ✅ |
| Email notifications: new ticket, replies, assignment, quote/invoice sent, quote answered | ✅ (after the Emails setup) |
| Vendors: services you pay for, costs, renewals, daily reminder email (admin only) | ✅ |
| Animated login page with rotating motivational lines | ✅ |
| Client monthly reports, PDF downloads | 🔜 next |

Designs for every screen: the "Work Hub" canvas in Claude.

## First-time setup

### 1. Database (Supabase)
In Supabase → **SQL Editor**, run each file in `supabase/migrations/` **in order**, once:

1. `001_work_hub_schema.sql` — tables, roles and security rules
2. `002_ticket_deadlines.sql` — automatic ticket deadlines from priority
3. `003_time_entry_delete.sql` — staff can remove their own unapproved time entries
4. `004_file_uploads.sql` — private file storage for receipts, HR documents and ticket screenshots
5. `005_email_notifications.sql` — email notifications (then follow "Emails" below)
6. `006_vendors.sql` — vendors list and a daily renewal-reminder email
7. `007_crm_contacts.sql` — CRM: people (contacts), activity history, lead source, and "won deal → client + draft quote"
8. `008_internal_work.sql` — internal tasks, knowledge base, announcements and in-app notifications (the bell)
9. `009_reports_calendar_audit.sql` — business details, monthly client reports (+ email on the 1st), shared calendar, audit log, notification emails
10. `010_website_cms.sql` — website CMS: client websites, editable fields, changes and requests, `site-images` bucket
11. `011_cloudflare_pages_sites.sql` — website CMS for Cloudflare Pages sites without GitHub (direct upload): `site_files`, `site-files` bucket
12. `012_clear_logs.sql` — admins can clear the activity log, email log and notifications (Activity log → Clear logs)
13. `013_custom_roles.sql` — custom roles for staff (Finance, Manager, Web team…) with real database permissions

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

### 3. Put it live (Cloudflare Workers)
Cloudflare → **Workers & Pages → Create → Import a repository** → pick this repo.

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy` (uses `wrangler.jsonc` in this repo)
- Build variables:
  - `VITE_SUPABASE_URL` = your Supabase project URL
  - `VITE_SUPABASE_ANON_KEY` = your Supabase anon / public key

`wrangler.jsonc` tells Cloudflare to serve `dist` and to send every address to the app,
so refreshing any page works. Don't add a `public/_redirects` file — Cloudflare rejects it.

### 4. Your business details
Edit `src/lib/business.ts` with your business name, contact details and bank details
(they print on every quote and invoice) and your annual leave allowance.

## Emails

Work Hub sends emails through **Resend** (free: 3,000 emails a month, 100 a day).
The database sends them by itself, so there's nothing extra to host.

| When | Who gets it |
|---|---|
| A client raises a ticket | All admins, plus a "we've got your ticket" email to the client |
| The team replies on a ticket | The people who log in for that client |
| A client replies | The person the ticket is assigned to (or all admins if nobody) |
| A ticket is assigned | The person it's assigned to |
| A quote or invoice is sent | The people who log in for that client |
| A client accepts or declines a quote | All admins |

Internal notes never send an email.

### Setup (once)
1. Sign up at resend.com.
2. **Domains → Add domain.** Use a domain you own, ideally a subdomain like `mail.yourdomain.co.za`.
   Add the DNS records Resend shows you at your DNS host, and wait until it says **Verified**.
   (Until then Resend only delivers to your own email address.)
3. **API Keys → Create API key** with "Sending access". Copy it (it starts with `re_`).
4. In Supabase → **SQL Editor**, run these three lines with your own values:
   ```sql
   select vault.create_secret('re_YOUR_KEY', 'resend_api_key');
   select vault.create_secret('Work Hub <support@mail.yourdomain.co.za>', 'email_from');
   select vault.create_secret('https://YOUR-APP.workers.dev', 'app_url');
   ```
   They're stored encrypted in Supabase Vault, never in this repo.
5. In the app → **Team & roles → Send me a test email**. The list below the button shows every email and whether Resend accepted it.

To change a value later:
```sql
select vault.update_secret((select id from vault.secrets where name = 'resend_api_key'), 're_NEW_KEY');
```

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

## Website CMS (clients edit their websites from the portal)

How it works: each client website is an HTML site in its own GitHub repo (files in a folder such as `public`),
deployed by Cloudflare whenever that repo changes. Editable parts of a page carry a `data-cms="name"` marker.
Work Hub reads those parts, lets the client (or you) change them, and saves the change back to GitHub as a commit.
Cloudflare then rebuilds the client's site — usually within a minute or two.

Three kinds of website:
- **HTML on GitHub** (Cloudflare Pages or Workers connected to a GitHub repo): changes are committed to the repo and Cloudflare rebuilds.
- **Cloudflare Pages, uploaded directly (no GitHub):** Work Hub keeps its own copy of the files. You upload new versions in
  Work Hub (Websites → Files → Upload folder / Upload .zip) and Work Hub deploys them. Client edits are applied to that copy
  and the site is re-deployed. If someone uploads straight in the Cloudflare dashboard instead, Work Hub notices and pauses
  publishing until you upload the same files in Work Hub — so a client edit can never bring back an old version.
- **WordPress and others:** for now their clients send **change requests** (words + photos) that you do yourself.

### One-time setup
1. **Database:** run `supabase/migrations/010_website_cms.sql` in the Supabase SQL Editor.
2. **GitHub key** (lets Work Hub save changes to the client website repos):
   GitHub → your picture → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
   - Resource owner: the account/organisation that owns the client website repos (e.g. `Nado-ops`)
   - Repository access: **Only select repositories** → pick the client website repos
   - Permissions → Repository permissions → **Contents: Read and write**
   - Copy the token. Don't paste it anywhere except the next step.
3. **Cloudflare secrets:** Workers & Pages → `workhub` → Settings → Variables and secrets → **Add** (type **Secret**) for each:
   - `GITHUB_TOKEN` — the token from step 2
   - `SUPABASE_URL` — same value as `VITE_SUPABASE_URL`
   - `SUPABASE_ANON_KEY` — same value as `VITE_SUPABASE_ANON_KEY`
   - `CLOUDFLARE_API_TOKEN` — only for direct-upload Pages sites. Cloudflare → My Profile → API Tokens → Create Token →
     Custom token → Permissions: **Account · Cloudflare Pages · Edit** → Account resources: your account → Create.
4. Merge the pull request. Cloudflare deploys the app and the small server part (`worker/`) together.

### Adding a client website
1. **Websites → Connect a website:** pick the client and give the live address. Then either
   - GitHub: the repo (`owner/name`), branch and folder — then press **Scan website**, or
   - Cloudflare Pages (direct upload): the account ID (in the dashboard address) and the Pages project name — then on
     **Files**, upload the website folder or a .zip (the folder with `index.html` in it). The project must already exist.
2. Work Hub reads every `.html` page.
3. **Pages → Auto-mark page** for each page the client should edit (e.g. `index.html`, `about/index.html`).
   It marks headings, paragraphs, photos and buttons (not menus, forms or scripts) and saves that to GitHub.
   You can also add markers yourself: `<h1 data-cms="hero-title" data-cms-label="Main heading">…</h1>`.
4. **Rename** fields so the client sees friendly names ("Opening hours" instead of "text-3").
5. Leave "I review client edits" on (recommended) or switch it off so edits go live immediately.

Photos clients upload are copied into the site at `/images/uploads/…` when published.

**Uploading a new version of a direct-upload site:** edit your files as usual and upload them on **Files**. Parts you
didn't change keep the client's edits; parts you changed use your new version. Editable markers are added back
automatically, and client photos are kept. Server code (`functions/`, `_worker.js`) isn't supported in this upload.
Rich text only keeps simple formatting (bold, italic, lists, links) — scripts and styles are always removed.

### Testing the server part locally (optional)
Create `.dev.vars` (never commit it) with `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `GITHUB_TOKEN`, run `npm run build`,
then `npx wrangler dev`. `npm run check:worker` type-checks the server code.

## Team: adding people and roles

**Add a person** on Team & settings: name, email and role (admin, staff, or client + company; staff can also get a
custom role). They get an email with a link to set their password. You can also **Send login link** (for a lost
password or an invite that expired) and **Remove access** (blocks the login; their history stays) / **Give access back**.

One-time setup: Cloudflare → Workers & Pages → `workhub` → Settings → Variables and secrets → **Add** (type **Secret**):
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Project Settings → API keys → the **service_role** (secret) key.
  This key can do anything in your database: only ever paste it into Cloudflare, never into chat, code or the browser.

Invite emails are sent by Supabase itself. Its built-in sender only allows a few emails per hour, so set up your own
sender: Supabase → Authentication → Emails → **SMTP Settings** → use Resend (host `smtp.resend.com`, port `465`,
user `resend`, password = your Resend API key, sender e.g. `Work Hub <hello@mail.nanobridgeedu.org>`).

**Roles:** every staff member sees tickets, clients, projects, the CRM, tasks and their own HR. A custom role adds:
Finance (quotes, invoices, claims, vendors, money reports), HR (everyone's leave, timesheets, HR documents),
Websites (connect and manage client websites) and/or Announcements. Create and change roles under **Roles**.
