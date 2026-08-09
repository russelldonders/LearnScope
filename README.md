# LearnScope

A personal, lifelong skills and learning tracker. Log the skills you're building, how proficient you
are, and the training or experience behind them — shown as growth rings, not progress bars.

## Stack

- React (Vite) + Tailwind CSS
- Supabase (Postgres + email/password auth + row-level security)
- Vercel (frontend hosting)

## Local setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create a Supabase project** at [supabase.com](https://supabase.com) (free tier is fine).

3. **Run the database migration**

   In the Supabase dashboard, open the SQL editor and run the contents of
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql). This creates the `skills`
   table and its row-level security policy, so each user can only see and edit their own rows.

4. **Set environment variables**

   Copy `.env.example` to `.env` and fill in your project's URL and anon key (Supabase dashboard →
   Project Settings → API):

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
3. Add the same two environment variables from `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
   under Project Settings → Environment Variables.
4. Deploy. Build command `npm run build`, output directory `dist` (Vercel detects these automatically
   for Vite).
5. Add the production `/welcome` and `/reset-password` URLs to Supabase's Redirect URLs allow list (see
   step 6 above).

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
