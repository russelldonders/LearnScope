# LearnScope

A personal, lifelong skills and learning tracker. Log the skills you're building, how proficient you
are, and the training or experience behind them — shown as growth rings, not progress bars.

## Stack

- React (Vite) + Tailwind CSS
- Supabase (Postgres + email/password auth + row-level security)
- Vercel (frontend hosting)

## Environments

LearnScope uses **two separate Supabase projects**:

- **Staging** — used for local development (`npm run dev`) and manual testing. Local `.env` should
  always point here, never at production.
- **Production** — used only by the live Vercel deployment. Its URL/anon key live in Vercel's
  **Production** environment variables, not in any file in this repo.

Never point local `.env` at the production project — there is no sandboxing between local dev and
whatever Supabase project `.env` names, so doing so means every local action (self-assessments,
deletes, test data) happens against real learner data.

## Local setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Use (or create) the Staging Supabase project** at [supabase.com](https://supabase.com) — this is
   what local dev talks to. Don't reuse the production project here.

3. **Bootstrap the schema** (first time only, on a fresh Staging project)

   In the Staging project's Supabase dashboard, open the SQL editor and run the contents of
   [`supabase/migrations/stage_bootstrap_consolidated.sql`](supabase/migrations/stage_bootstrap_consolidated.sql) —
   a single-pass bundle of every migration in `supabase/migrations/`, in order. Do not run this against
   a database that already has some of these migrations applied individually (e.g. production); use the
   numbered files under `supabase/migrations/` for that instead, applied one at a time in order. See the
   comment at the top of that file, and regenerate it (re-concatenate the numbered migrations) whenever a
   new one is added.

4. **Set environment variables**

   Copy `.env.example` to `.env` and fill in the **Staging** project's URL and anon key (Supabase
   dashboard → Staging project → Project Settings → API):

   ```bash
   cp .env.example .env
   ```

5. **Run the dev server**

   ```bash
   npm run dev
   ```

   Visit `http://localhost:5173`. Sign up with an email/password — by default Supabase requires email
   confirmation before you can log in, so check your inbox (or disable confirmation in Authentication →
   Providers → Email while developing).

6. **Configure auth redirect URLs**

   The app sends users to `/welcome` after confirming their email, and to `/reset-password` after
   requesting a password reset. Supabase only allows redirecting to URLs you've explicitly listed, so in
   the Supabase dashboard go to **Authentication → URL Configuration → Redirect URLs** and add:

   ```
   http://localhost:5173/welcome
   http://localhost:5173/reset-password
   https://<your-vercel-domain>/welcome
   https://<your-vercel-domain>/reset-password
   ```

   Without this, confirmation and reset links will fail to redirect back into the app.

## Deploying to Vercel

1. Push this repo to GitHub.
2. In Vercel, import the repo as a new project (framework preset: Vite).
3. Under Project Settings → Environment Variables, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
   for the **Production** environment only, using the **production** Supabase project's URL/anon key
   (Supabase dashboard → production project → Project Settings → API) — not the Staging project's values
   from local `.env`. Bootstrap/maintain its schema the same way as Staging (see Local setup step 3), but
   apply new migrations here individually as they're added, never via the consolidated bootstrap file.
4. Deploy. Build command `npm run build`, output directory `dist` (Vercel detects these automatically
   for Vite).
5. Add the production `/welcome` and `/reset-password` URLs to the **production** Supabase project's
   Redirect URLs allow list (see step 6 above, but in the production project's dashboard).

## Project structure

```
src/
  components/   GrowthRing, SkillCard, SkillModal, ProtectedRoute
  context/      AuthContext (Supabase session state)
  lib/          supabaseClient, level labels
  pages/        Landing, Login, Signup, ForgotPassword, ResetPassword, Welcome, Dashboard
supabase/
  migrations/   SQL schema + RLS policy
```

## Stretch goals

- Public/shareable read-only profile view (opt-in)
- Timeline view of skills logged over time
- Export skills as PDF or CSV
- Mobile app (React Native / Expo) reusing the same Supabase backend
