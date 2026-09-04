# Claude handoff: account portability and profile transfer

## Canonical takeover point

- Remote branch: `codex/domain-foundation`
- Takeover commit before this handoff document: `49628af`
- The Claude UI branch `worktree-bridge-cse_01K7uabydyhoJq7rrT6Wvmks`
  ends at `d87cc6c`; all of its relevant commits are already cherry-picked into
  `codex/domain-foundation`. Do not merge that branch again.
- Remote `staging` is currently at `0294380`.
- Supabase staging already has migration
  `20260903210000_profile_transfer_plans.sql` applied. The migration is
  additive and the older staging frontend does not use it yet.
- The working tree used for the integrated implementation is
  `C:\Google Drive\LearnScope\role-integration-worktree`. The repository's
  main checkout may contain unrelated user changes; do not reset, clean, or
  overwrite them.

Start from the canonical remote branch, not the older Claude UI branch:

```powershell
git fetch origin
git switch codex/domain-foundation
git pull --ff-only origin codex/domain-foundation
```

If the existing checkout cannot switch safely, create a new worktree from
`origin/codex/domain-foundation` instead of modifying a dirty checkout.

## Implemented and integrated

### Identity and workspaces

- `people`, `person_auth_accounts`, `learning_profiles`, `workspaces`, and
  `workspace_access` establish separate person, login, profile, and workspace
  concepts.
- Personal, manager, employer, and provider contexts remain distinct.
- Existing learner tables still use the legacy `auth.users.id` ownership
  columns. This compatibility constraint is the principal remaining blocker
  for transfer execution.

### Independent manager and employer role features

- Independent manager workspace, manager-team consent, collaborative learning,
  and manager/company linking are implemented and wired.
- Employer role profiles and learner-controlled role alignment are implemented.
- Managers only see explicitly shared skills/evidence and team-scoped learning;
  they do not receive full learner-profile access.

### Verified account linking

- Email-bound, short-lived invitation tokens establish proof of control for two
  distinct Supabase Auth users.
- Links do not merge identities, profiles, permissions, or learner data.
- Account-linking UI is mounted in `ConnectedAccounts.jsx`.
- SAML SSO accounts use this application-layer mechanism because Supabase Auth
  manual identity linking does not support SAML identities.

Relevant files:

- `src/lib/accountLinks.js`
- `src/pages/account-linking/`
- `supabase/migrations/20260903190000_verified_account_links.sql`
- `docs/account-portability.md`

### Consent-gated profile comparison

- Either linked account can request a comparison.
- Both accounts must approve before profile counts or potential conflicts are
  returned.
- Comparison is read-only and revocable; it performs no transfer.

Relevant files:

- `src/lib/profileTransferPreviews.js`
- `src/pages/account-linking/transfer/`
- `supabase/migrations/20260903200000_profile_transfer_preview_consent.sql`

### Immutable transfer-plan review

- A plan can be created only from a mutually approved preview.
- The learner explicitly selects the durable profile; the other becomes the
  source profile.
- Skills, courses, and experience are projected as plan items.
- Duplicate items require an explicit `keep_durable` or `use_source`
  resolution.
- Submitting a resolved plan freezes a SHA-256 version hash and records the
  submitter's approval.
- The other linked account must approve the exact same hash.
- Approvals can be withdrawn before execution.
- Plan creation, resolution, submission, approval, withdrawal, and cancellation
  produce append-only audit events.
- Source and durable records carry fingerprints in the plan so a future
  executor can reject stale data.
- RLS and RPC authorization prevent unrelated accounts from reading or changing
  plans.
- There is deliberately no execution RPC or execution button.

Relevant files:

- `src/lib/profileTransferPlans.js`
- `src/pages/account-linking/transfer-plan/`
- `src/pages/ConnectedAccounts.jsx`
- `supabase/migrations/20260903210000_profile_transfer_plans.sql`
- `supabase/tests/verified_account_links.sql`

## Last verified evidence

At commit `49628af` plus its committed predecessors:

- `npm test -- --run`: 49 test files, 302 tests passed.
- `npm run build`: succeeded; 308 modules transformed.
- `npm run lint`: exit 0, with only the repository's existing warnings.
- `npx supabase db reset --local --no-seed`: full migration history replayed.
- `npx supabase db lint --local --level error`: no schema errors.
- The transactional SQL test proves wrong-email rejection, comparison denial
  before mutual consent, outsider plan denial, conflict-resolution enforcement,
  post-submission immutability, exact-version approval, two-party completion,
  audit-event creation, and link revocation.
- The Impeccable detector returned no findings for the integrated account UI.

Rerun these checks after changes; do not rely on the historic result.

## Immediate next step (done 2026-09-04)

The already-integrated review phase was deployed to staging:

1. Confirmed `origin/staging` (`0294380`) was an ancestor of the canonical
   branch (`84a6f3d`, 4 commits ahead, no divergence).
2. Ran the full frontend suite and local database checks: `npm run lint`
   (exit 0, pre-existing warnings only), `npm run build` (308 modules),
   `npm test -- --run` (1247 tests, 214 files, all passed -- the wider count
   reflects the full suite rather than the narrower set run at `49628af`),
   `npx supabase db reset --local --no-seed`, `npx supabase db lint --local
   --level error` (no errors), and `supabase/tests/verified_account_links.sql`
   (passed, rolled back).
3. Fast-forwarded `staging` to `84a6f3d` and pushed.
4. Vercel commit status returned `success`.
5. Skipped the `/profile/connected-accounts` smoke test: no staging test
   credentials were available in the repo (checked `.env.example`, `e2e/`).
   Not created or modified any real user data.

The database migration `20260903210000_profile_transfer_plans.sql` was not
reapplied or edited; it stays deployed and immutable.

## Session update: learning-profile access helper (2026-09-04)

First domain-by-domain increment of "Replace login-ID ownership with profile
ownership" below. Added in `20260904090000_learning_profile_access_helper.sql`
and `20260904100000_grant_connections_select.sql`:

- `private.can_view_learning_profile(p_legacy_user_id uuid)`: SECURITY
  DEFINER helper (bypass is required -- see the migration's comment on why a
  linked account's own RLS context can never see another person's
  `learning_profiles`/`workspaces` rows to evaluate access against). Returns
  true for the profile's own owner, or for another auth account that holds
  *both* an active `workspace_access` grant on the profile's personal
  workspace *and* an active `verified_account_links` row to the owner's
  personal auth account. Either fact alone is insufficient (defense in
  depth); revoking either denies access.
- `skills` gained one new additive, SELECT-only policy using that helper.
  Its existing "for all" owner policy is unchanged.
- `profiles` was deliberately **not** converted: it already carries a
  pre-existing, unrelated `using (true)` SELECT policy ("Authenticated users
  can view profile names"), so any narrower additive policy on it is a
  no-op.
- Found and fixed an unrelated pre-existing bug while writing the SQL
  allow/deny tests: `connections` (from `0058_skill_discovery_and_
  connections.sql`) had RLS and a scoping policy but no table-level `GRANT
  SELECT` for `authenticated`. Any RLS evaluation needing `is_connected()`
  for a row that wasn't the caller's own threw "permission denied for table
  connections" instead of evaluating true/false -- silently breaking the
  connections-based skill-sharing feature for exactly the rows it was meant
  to allow. Fixed with a plain grant; `connections`' own RLS policy already
  scopes rows correctly.
- New test: `supabase/tests/learning_profile_access.sql`, covering personal
  login, linked work login (via directly-seeded `workspace_access` +
  `verified_account_links` rows -- no production grant RPC exists yet, see
  below), unrelated login, revoked `workspace_access`, and revoked
  `verified_account_links`, against `skills`. All pass; rolls back.
- There is still no RPC or UI for a learner to actually grant their linked
  account `workspace_access` -- that remains the separate "Grant controlled
  cross-account access" phase in `docs/account-portability.md`, deliberately
  still not built.
- Only `skills` is converted so far. Courses, experience, actions, evidence,
  connections, xAPI, manager sharing, employer sharing, and skills' own ~15
  dependent tables (assessments, quizzes, peer ratings, targets, tags,
  course/experience links, validation requests, xAPI statements, etc.) still
  rely solely on `auth.uid() = user_id` and need their own reviewable,
  domain-by-domain conversions before a transfer executor can be considered.

Rerun the full frontend, migration-reset, database-lint, and transactional
security suites after any further change; do not rely on this record.

## Remaining product and engineering work

### 1. Replace login-ID ownership with profile ownership

Do this before implementing transfer execution. The current learner domain is
still built around `auth.uid() = user_id`. Simply changing source rows to the
durable auth user's UUID would make those rows inaccessible when the learner
signs in through the linked work SSO account.

Implement an additive, reversible transition:

1. Introduce profile ownership for learner-owned records, preferably an
   explicit `learning_profile_id` compatibility column backfilled from
   `learning_profiles.legacy_user_id`.
2. Add a narrowly scoped helper that answers whether the current active auth
   account may access a learning profile through `workspace_access`.
3. Convert RLS policies domain by domain. Never authorize from editable user
   metadata, email domain, or employer membership alone.
4. Update frontend data access to resolve the active learning profile rather
   than assuming `session.user.id` is the profile owner.
5. Preserve the existing personal-account behavior throughout the transition.
6. Add allow-and-deny SQL tests for personal login, linked work login,
   unrelated login, revoked workspace access, revoked account link, and ended
   employer membership.

Avoid a global search-and-replace. Skills, courses, experience, actions,
learning, privacy, connections, evidence, xAPI, manager sharing, and employer
sharing have different access semantics.

### 2. Define domain-specific execution rules

The executor must handle roots and every dependent foreign key in one database
transaction. The local catalog identified these dependencies:

- Skills: assessments/evidence, baseline quizzes, peer ratings, targets, tags,
  course links, experience links, validation requests, connection invitations
  and requests, xAPI statements and statement-skill links, searchable skills,
  employer-shared skills, manager-shared skills, and public share-link skills.
- Courses: course-experience links, skill-course links, assessments, xAPI
  statements, and xAPI launch sessions.
- Experience: parent/child experience links, course-experience links,
  skill-experience links, assessments, xAPI statements, and employer role
  alignment references.
- Connections and external integrations are counted in the preview but are not
  yet represented as executable plan items.

For every plan action specify what survives and where dependants point:

- `move`: retain the source record UUID and provenance, change its owning
  learning profile, and migrate dependent ownership safely.
- `keep_durable`: retain the durable canonical record; merge or explicitly
  preserve source dependants before retiring the duplicate source root.
- `use_source`: retain the source content and provenance as canonical while
  safely reconciling durable dependants.

Do not silently delete duplicate evidence, validation history, employer
provenance, manager sharing, or course completion history. Resolve partial
unique indexes such as pending invitations and pending validation requests
with explicit business rules and audit events.

### 3. Add a guarded transactional executor

Execution must:

1. Lock the plan, account link, approvals, and affected roots.
2. Require status `approved`, two approvals for the stored version hash, an
   active verified account link, unexpired plan, and appropriate durable
   personal-profile authority.
3. Recompute the immutable plan hash.
4. Recompute source/durable fingerprints and abort on any stale record.
5. Use an idempotency key and make retries return the prior result.
6. Apply all domain operations in one transaction or roll back all of them.
7. Record old-to-canonical record mappings and counts in a durable audit table.
8. Grant the linked work login access to the durable personal workspace only
   through explicit, revocable `workspace_access`.
9. Mark execution complete only after a postcondition check proves both logins
   have their intended access and the source records are fully accounted for.
10. Never delete the source Auth user or remove the personal recovery login.

Add a separate final execution confirmation. The existing review UI truthfully
states that mutual plan approval does not itself execute anything.

### 4. Employer departure and recovery checks

After shared profile access and execution exist:

- End employer membership and organisation-workspace access independently.
- Revoke employer-only profile sharing.
- Preserve completed employer training and role provenance in the learner's
  durable profile.
- Prove the personal login still reaches the durable profile before completing
  departure.
- Keep the work login's revocation independent from the personal login and
  historical learner records.

## Safety rules for continuing

- Treat `20260903210000_profile_transfer_plans.sql` as deployed and immutable.
- Create a new timestamped migration for every schema correction or extension.
- Use `SECURITY DEFINER` only where RLS bypass is required, set
  `search_path = ''`, fully qualify relations, revoke default execution, and
  grant only the intended authenticated RPC surface.
- Enable RLS and set grants explicitly on every exposed table.
- Keep raw transfer tables read-only to clients; mutations go through narrow
  RPCs.
- Never infer account ownership from matching names, domains, employer
  membership, or unverified email.
- Do not implement blanket `user_id` reassignment.
- Preserve unrelated changes in dirty worktrees.

## Suggested first Claude prompt

> Continue account portability from remote branch `codex/domain-foundation`.
> Read `docs/claude-account-portability-handoff.md` and
> `docs/account-portability.md` completely before editing. Verify that the
> branch includes `49628af` and do not merge the older
> `worktree-bridge-cse_01K7uabydyhoJq7rrT6Wvmks` branch because its UI commits
> are already incorporated. First verify and fast-forward the integrated
> transfer-plan review phase to staging, noting that migration
> `20260903210000_profile_transfer_plans.sql` is already applied there. Then
> design and implement the additive learning-profile ownership/access
> transition required before any transfer executor. Do not add an execution
> RPC until personal-login, linked-work-login, unrelated-login, revocation, and
> employer-departure RLS tests prove the new access model. Preserve all
> provenance and dependent records; never blanket-reassign `user_id`. Use new
> migrations for all further database changes and run the complete frontend,
> migration-reset, database-lint, and transactional security suites before
> each deployment.
