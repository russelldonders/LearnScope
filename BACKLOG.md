# Backlog

Running list of ideas, gaps, and improvements to pick up later. Add items under
"Open" as plain bullets (any detail is fine, doesn't need to be polished).
When picked up, move the item to "In progress"; when done, move it to "Done"
or just delete it.

## Open

- Expand Playwright e2e coverage — `e2e/auth.spec.ts` now covers signup/
  forgot-password forms and unauthenticated redirects for dashboard/profile/
  connections/actions, on top of the original landing-page/login test. Still
  no coverage of any *authenticated* flow (dashboard content, profile edits,
  connections, the video editor, course-progress) — that needs a seeded test
  backend/session, which the current Playwright setup deliberately avoids
  (see playwright.config.ts's placeholder-credentials comment).

- general
1. Multi-language: infrastructure now exists (LanguageContext.jsx, a
   lightweight custom t() translator rather than a new dependency, a
   profiles.language_preference column mirroring theme_preference, a picker
   on Profile). Only AppHeader nav/menu and the Login/Signup/ForgotPassword
   pages are actually translated (en/es) as a proof it works end to end —
   the rest of the app's strings (skills, courses, every admin console,
   etc.) still need translating, key by key, surface by surface. That's a
   large amount of ongoing work, not something to treat as finished.
2. "Proxy as another user" — deliberately NOT built as literal session
   impersonation. The only way to make RLS-scoped queries genuinely return
   another learner's data is to hold a real, fully-privileged session as
   them (e.g. via a minted magic-link/OTP session) -- that's an
   account-takeover-capable primitive (a valid session can write, not just
   read), and building it unsupervised, with no interactive human security
   review available in this session, isn't a call to make alone. Instead,
   AdminUserDetail.jsx already covered most of the underlying need (a
   platform admin's full read-only view of one learner's profile, skills,
   courses, experience, connections) before this session started -- I added
   a GrowthRing to each skill row there so it reads more like the learner's
   own view rather than a bare data table. If true "become this user in
   their own session" impersonation is still wanted, it needs a deliberate
   security design pass (session scope/expiry, write-blocking, audit
   logging, exclusion of other platform admins as targets) with a human in
   the loop -- not something to pick up as a routine backlog item.

## In progress

## Done
