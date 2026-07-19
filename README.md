# Panther Equity Training Portal

The web app for Panther Equity's analyst bootcamps. Built with **Next.js (App Router)**
+ **Supabase** (auth + database) + **Vercel** (hosting). Design matches the approved
prototype.

This is the **first build chunk: authentication + app skeleton.** Sign-in, sign-up,
role-based routing (student → learner view, admin/owner → console), and the on-brand
shell all work. The full admin console and learner player are the next chunks.

---

## What you need
- **Node.js 18.17+** (check with `node -v`). Get it from https://nodejs.org if needed.
- The Supabase project you already created (schema already run, Email auth on).

## 1. Run it locally (5 min)

```bash
# from inside this folder
npm install
cp .env.local.example .env.local
```

Open `.env.local` and paste your two values from
**Supabase → Project Settings → API**:

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your anon public key>
```

(The **anon** key is safe in the browser. Never put the **service_role** key here.)

Then:

```bash
npm run dev
```

Visit **http://localhost:3000**. You'll be redirected to `/login`.

## 2. Make your first account + become owner
1. On `/login`, click **Sign up**, use `osh7@pitt.edu`, set a password.
2. Confirm via the email Supabase sends (confirmation is on).
3. In the Supabase **SQL Editor**, run once:
   ```sql
   update public.profiles set role = 'owner' where email = 'osh7@pitt.edu';
   ```
4. Sign in. As owner you'll land on **/admin**; students land on **/learn**.

## 3. Deploy to Vercel (free)
1. Push this folder to a GitHub repo (private is fine), or install the Vercel CLI.
2. On https://vercel.com → **Add New → Project** → import the repo.
3. In the project's **Environment Variables**, add the same two keys
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
4. **Deploy.** You'll get a free `https://<name>.vercel.app` URL.
5. In **Supabase → Authentication → URL Configuration**, set the **Site URL** to your
   Vercel URL (so confirmation links point to the live site, not localhost).

> Heads-up: Supabase's built-in email is rate-limited on the free tier (a few per hour).
> Fine for testing. Before inviting the whole roster, we'll add a free email sender
> (Resend) or switch off email confirmation for the internal rollout — covered next.

---

## Project structure
```
app/
  layout.jsx          fonts + global styles
  globals.css         design system (colors, type, components)
  page.jsx            role-based landing redirect
  login/page.jsx      sign in / sign up
  learn/page.jsx      learner view (skeleton for now)
  admin/page.jsx      admin console (skeleton; student-guarded)
  auth/signout/route.js
components/
  TopBar.jsx
utils/supabase/
  client.js           browser client
  server.js           server client
  middleware.js       session refresh + auth gate
middleware.js         wires the above to every route
```

## What's next
- **Admin console:** dashboard, bootcamp builder (videos, drills, quizzes, workbook
  upload), people/roster, and bulk assign.
- **Learner player:** bootcamp cards + the video / drill / knowledge-check flow.
