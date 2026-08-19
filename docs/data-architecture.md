# LearnScope data architecture

This document classifies LearnScope's data and records the conventions
that keep learner-owned, organisation-owned, and global/reference data
cleanly separated — logically, not via physical Postgres schemas — while
keeping the door open to regional data hosting later without a rewrite.

Governing principle: **a learner has a persistent, portable lifelong
learning and skills record.** Organisations, coaches, and learning
providers may contribute to or be granted access to parts of that record,
but participation must never make them the owner of it.

## Domains

### Learner-owned

Every row traces to exactly one learner via a direct or one-hop
`auth.users` foreign key: `profiles`, `skills`, `courses`, `experience`,
`skill_assessments`, `connection_invites`, `course_experience_links`,
`skill_experience_links`, `xapi_statements`, `skill_course_links`,
`skill_tags`, `skill_baseline_quizzes`, `skill_targets`.

### Ambiguous/shared (genuinely cross-person)

`skill_peer_ratings` and `skill_validation_requests` both involve two
people acting on one learner's record — a rater/validator, and the skill
owner whose record it is. Both already use **explicit, distinct column
names** rather than a generic `user_id` (`skill_owner_id`/`rater_id`,
`requester_id`/`validator_id`) — see "Ownership column convention" below.
They're narrow, purpose-built, working access mechanisms — early
instances of ownership-vs-access separation, not something needing to
change now.

### Global/reference

Zero user-ownership column, read-open to any authenticated user,
write-restricted: `skill_library`, `tags`, `course_catalogue`,
`course_catalogue_skills`, `course_catalogue_tags`. `skill_diagnostic_content`
is a subtype of this — platform-*generated* shared content (AI diagnostic
quizzes, cached and reused across every learner doing the same skill+level
check) rather than hand-curated reference data, written only by a
service-role endpoint (`api/generate-diagnostic-quiz.js`), but the same
access tier: nobody in the app owns it, everyone reads it.

**This is intentional, not a gap.** Every `using (true)` SELECT policy on
these tables is deliberate shared-content behavior — flagging this
explicitly so a future security review doesn't mistake it for a hole.

### Organisation-owned

**Does not exist yet.** No `organisations` table, no `organisation_id`
anywhere, no membership/tenancy concept. (`experience.organization` is a
free-text employer/institution name on a learner's own timeline row — not
a tenant.) Built only when a real feature needs it — see "Deferred, by
design" below.

### Auth/system

`auth.users` (Supabase-managed). `profiles` already sits outside
`auth.users` as its own table, so "don't store profile info directly on
auth.users" is already satisfied.

## Ownership column convention

- **`user_id`** = "this row belongs to this one learner." Used wherever a
  table has exactly one relevant person.
- **Explicit named columns**, not a generic `user_id`, wherever a row has
  more than one distinct relationship to a user — e.g.
  `skill_owner_id`/`rater_id` (`skill_peer_ratings`),
  `requester_id`/`validator_id` (`skill_validation_requests`),
  `inviter_id`/`accepted_by` (`connection_invites`). The schema already
  follows this correctly; it's now a documented rule for every future
  table, not a retrofit.
- `created_by` on `skill_library`/`tags` is audit-only (nullable, never
  used in RLS as an ownership scope) — don't read it as ownership.

`user_id` is functionally identical to an `owner_user_id` concept: a
direct, non-nullable `auth.users` FK, never repointed to anything else.
Renaming it across ~15 tables was considered and **rejected** — no
functional gain, touches every RLS policy and query in the app for a
purely cosmetic change.

## RLS

Every learner-owned table has a `user_id = auth.uid()` (or explicit
equivalent) owner policy. The few legitimate cross-user operations are
security-definer RPCs, not permissive RLS holes: `accept_invite_and_rate`,
`decide_validation_request`, `get_peer_rater_progress`,
`get_validation_request_contact`.

Two cross-cutting checks were previously duplicated verbatim across 6+
policies each; migration `0051` centralized them as SQL functions
(`is_connected(a, b)`, `is_skill_validator(skill_id, user_id)`) so a
future change to what "connected" or "validating" means only has to
happen in one place. Both are plain `SECURITY INVOKER` functions (no
elevated privilege) — every call site already only ever evaluates them
with `auth.uid()` as one of the two parties, so they remain correctly
scoped by the querying user's own RLS on the tables they read.

## Data access

One Supabase client singleton exists (`src/lib/supabaseClient.js`),
imported everywhere — the one deliberate chokepoint for introducing
indirection. Today it isn't used as one: ~35 files call `supabase.*`
directly, and only 12 `src/lib/*.js` files act as data-access helpers
(and even those files' callers also query tables directly alongside using
them). `src/data/` is the intended home for table-scoped repository
modules going forward, and `getDataClient()` is the intended replacement
for direct `supabase` singleton imports in new code — see
`src/data/README.md`. Migrating the existing ~35 files is **not** part of
this pass (large, high-regression-risk, no automated test suite exists to
catch mistakes) — proposed as an incremental Phase 2, done opportunistically
as those files are next touched for other reasons.

## Deferred, by design

These are designed conceptually but **not built** — each waits for a real
feature to need it, rather than being scaffolded ahead of use:

- **`data_grants`** — a generalized access-grant table for future
  organisation/coach/training-provider access
  (`grantee_type`, `grantee_id`, `resource_type`, `resource_id`,
  `permission_level`, `granted_by`, `valid_from`, `valid_until`,
  `revoked_at`). `skill_peer_ratings`/`skill_validation_requests` are
  existing narrow-purpose precedents a future generalization *could*
  migrate onto this table — not a requirement to do so.
- **Organisation domain** — `organisations`/`organisation_memberships` (or
  similar), referencing learner records via grants, never owning them.
- **Regional data hosting** — the boundary is `getDataClient()` (today:
  returns the single existing client). When a second region is real, that
  function gains the ability to inspect a region marker (proposed home: a
  `profiles` column, e.g. `data_region`) and return a client pointed at
  the right Supabase project. Not building the marker column or routing
  logic now — this is where it lands when it's needed.
- **Physical Postgres schema separation** — logical/conventional
  separation (this document + the data-access boundary) was chosen over
  moving tables into separate Postgres schemas, which would need Supabase
  dashboard config changes (exposed schemas) and rewriting every query/policy
  touching the ~15 learner-owned tables, for a benefit the logical approach
  already mostly delivers. Remains available later if a real driver (e.g.
  differing compliance/backup requirements per domain) emerges.
