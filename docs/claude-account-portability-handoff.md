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
   `npm test -- --run` (reported 1247 tests/214 files at the time -- see the
   "vitest.config.js worktree leak" note below; the real, correctly-scoped
   count is 302 tests/49 files, matching `49628af`'s own record exactly),
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
- Found and fixed a local-environment gap while writing the SQL allow/deny
  tests: `connections` (from `0058_skill_discovery_and_connections.sql`) had
  RLS and a scoping policy but no table-level `GRANT SELECT` for
  `authenticated` in any migration. A fresh local `supabase db reset` throws
  "permission denied for table connections" from `is_connected()` for any
  row that wasn't the caller's own, instead of evaluating true/false.
  **Checked directly against the linked Staging project** (`npx supabase db
  query --linked`) and this is *not* actually broken there: Staging's
  Postgres instance has an ambient default ACL (`pg_default_acl`, not
  captured in any migration) that grants `authenticated` full
  SELECT/INSERT/UPDATE/DELETE on every new table automatically, so
  connections-based skill-sharing works fine for real users today. The fix
  (a plain grant) still matters for local dev and for
  `stage_bootstrap_consolidated.sql`'s "bootstrap a brand-new Staging project
  from empty" use case (CLAUDE.md #17) -- a genuinely fresh project would not
  have Staging's undocumented default and would inherit this gap for real.
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

## Session update: courses/experience access helper (2026-09-04, continued)

Second domain-by-domain increment, same session. Added in
`20260904110000_courses_experience_access_helper.sql` and
`20260904111500_grant_courses_select.sql`:

- Converted `courses` and `experience` the same way as `skills`: one new
  additive, SELECT-only policy each using the existing
  `private.can_view_learning_profile(uuid)` helper; existing "for all" owner
  policies untouched. Checked first that neither table has a `using (true)`
  policy and that every existing policy on both is permissive, not
  restrictive.
- Found and fixed a second, structurally identical local-environment gap
  while extending the SQL allow/deny tests: `courses` (from
  `0003_courses_experience.sql`) was missing `GRANT SELECT` for
  `authenticated` in any migration -- unlike `experience` (created in the
  same original migration), which picked one up incidentally via
  `20260903170000_employer_role_profiles.sql`. Same root cause and same
  verdict as the `connections` gap above: confirmed via `npx supabase db
  query --linked` that Staging already has full grants on `courses` through
  its ambient default ACL, so "Validators can view courses linked to skills
  they're validating" and "Provider admins can view their course
  participants" are not currently broken for real users. Fixed with a plain
  grant for the same local-dev/fresh-bootstrap reasons.
- Extended `supabase/tests/learning_profile_access.sql` to assert the same
  six scenarios across skills, courses, and experience together. All pass;
  rolls back.
- `skills`, `courses`, and `experience` are now converted. Still unconverted:
  actions, evidence, connections, xAPI, manager sharing, employer sharing,
  and every dependent table listed in "Define domain-specific execution
  rules" below (assessments, quizzes, peer ratings, targets, tags,
  course/experience links, validation requests, xAPI statements/launch
  sessions, employer role alignment references).

## Session update: skills/courses/experience dependent tables (2026-09-04, continued)

Third domain-by-domain increment, same session. Added in
`20260904120000_skills_courses_experience_dependents_access_helper.sql` and
`20260904121500_grant_skills_courses_experience_dependents_select.sql`:

- Converted 11 more tables that are direct dependents of skills/courses/
  experience and share the exact same shape (a direct, not-null `user_id`
  column; every existing policy confirmed permissive via
  `pg_policy.polpermissive` before writing the migration): `skill_
  assessments`, `skill_baseline_quizzes`, `skill_tags`, `skill_targets`,
  `skill_course_links`, `skill_experience_links`, `course_experience_links`,
  `course_content_progress`, `xapi_statements`, `xapi_statement_skills`,
  `xapi_launch_sessions`. Same pattern as before: one new additive,
  SELECT-only policy per table using the unmodified
  `private.can_view_learning_profile(uuid)` helper.
- All 11 also lacked a `GRANT SELECT` for `authenticated` locally -- by now
  an expected instance of the same local/Staging default-ACL divergence
  documented above, not re-verified against Staging table-by-table since the
  root cause is structural/environmental rather than per-table. Fixed with
  one grant migration covering all 11.
- Deliberately NOT included (different access semantics): peer ratings,
  validation requests, connection invitations/requests, searchable skills,
  employer-shared skills, manager-shared skills, public share-link skills,
  parent/child experience links, employer role alignment references, and
  `employer_members`/`organisation_members`/`profile_share_links` (membership
  and account-setting records, not learning-profile content).
- Extended `supabase/tests/learning_profile_access.sql` with one
  representative table per family (`skill_targets`, `course_experience_
  links`, `xapi_statements`) rather than exhaustively fixturing all 11 --
  they share the identical, already-proven policy shape and helper, so this
  is proportionate coverage, not full per-table testing. All pass; rolls
  back.
- **A security review of this increment caught a real issue before commit**:
  `xapi_launch_sessions` matches the same `user_id`/permissive-policy shape
  as the other 10 tables, but its `token` column is a live bearer credential
  -- `api/xapi/[...path].js` authenticates the entire xAPI LRS proxy purely
  by looking up this token via the service role, no further check. Adding
  the same "read-only" SELECT policy to it would have actually granted a
  linked account the ability to read up to 200 of the owner's real xAPI
  statements *and forge new ones* (persisted with the real owner's
  `user_id`) for the token's up-to-4-hour lifetime -- a write/impersonation
  capability wearing a read-only label, and squarely against this project's
  "historical accuracy"/"evidence over unsupported claims" principles.
  Excluded `xapi_launch_sessions` from the policy migration entirely (kept
  its existing owner-only policies untouched); the grant migration still
  covers it since granting the coarse table privilege exposes nothing new
  when no additional policy exists to use it. Verified directly via
  `pg_policy` that only the two original owner-only policies remain on it --
  a full functional negative test was judged not worth the fixture cost
  (`xapi_launch_sessions.resource_id` requires a `content_resources` row,
  which itself requires a valid `organisation_id`). **Any future domain
  conversion must check whether a "read-only" column is actually a
  credential/secret before reusing this same mechanical pattern** --
  `token`-like columns don't announce themselves via `\d` the way validator/
  rater ownership columns do.

**Important environment-parity finding, not a live bug**: this session
originally logged the two grant gaps above as bugs "silently breaking" live
features, based only on a fresh local `supabase db reset`. Checking the
actual linked Staging project directly (`npx supabase db query --linked`
against `information_schema.role_table_grants` and `pg_default_acl`) showed
neither was ever broken for real users -- Staging's Postgres instance has an
ambient default ACL, outside of any migration, that grants `authenticated`
full table privileges on new tables automatically; ordinary local `db reset`
does not have that default. **Any future local-only finding of "permission
denied for table X" during RLS testing must be checked against the linked
project the same way before being treated as a real bug or written up as
one** -- it may just be this same local/Staging divergence. Whether to
formally document Staging's ambient grant defaults in a migration (so
`stage_bootstrap_consolidated.sql` can truly bootstrap a brand-new project
from empty per CLAUDE.md #17, per its own stated purpose) is a separate,
unstarted piece of work, not part of this ownership transition.

**Second, unrelated environment finding, also fixed this session**:
`vitest.config.js`'s `exclude` list did not exclude `.claude/worktrees/**`.
This repo checkout has several leftover git worktrees from other, unrelated
Claude Code sessions sitting inside that directory, each a full checkout
with its own copy of every `*.test.js`/`*.test.jsx` file. `npm run test:run`
was silently also collecting and running those sibling worktrees' tests as
if they were this project's own, inflating the reported file/test counts
(seen as high as 214 files/1247 tests, then 176/1043 as other sessions'
worktrees came and went) with no way to tell from the summary line alone.
Every test count logged anywhere earlier in this document from before this
fix is unreliable for that reason (though none reported failures -- the
inflation was in scope, not correctness). Added `'**/.claude/worktrees/**'`
to `vitest.config.js`'s `exclude`; the real, correctly-scoped count is 302
tests across 49 files, exactly matching the count already on record at
`49628af`. Did not touch the worktree directories themselves -- they may be
other sessions' in-progress work.

## Session update: grant controlled cross-account access (2026-09-04, continued)

Fourth increment, same session, and a change in kind: everything before this
built read-only RLS gated on `workspace_access` rows that only ever existed
because a SQL test seeded them directly. This is the first RPC surface that
actually creates one. Added in `20260904130000_linked_workspace_access_
grants.sql` and `20260904140000_revoke_link_cascades_workspace_access.sql`,
with frontend in `src/lib/linkedWorkspaceAccess.js`, `src/pages/account-
linking/LinkedWorkspaceAccessPanel.jsx` (+ fixtures/test), and new wiring in
`src/pages/ConnectedAccounts.jsx`.

**Design**: a two-step request/accept flow, not a unilateral grant, even
though a `verified_account_links` row proves the two accounts belong to the
same person -- the receiving account (e.g. a monitored work SSO login) may
not want the owner's data made newly visible through it, so it must
explicitly accept. New table `linked_workspace_access_requests`
(pending/accepted/declined/cancelled). RPCs: `request_linked_workspace_
access(p_link_id)` (owner-only; derives their own workspace from `auth.uid()`,
never takes a workspace_id param), `accept_linked_workspace_access
(p_request_id)` / `decline_linked_workspace_access(p_request_id)`
(target-only), `cancel_linked_workspace_access_request(p_request_id)`
(requester-only), `revoke_granted_workspace_access(p_link_id)` (owner tears
down what they gave), `renounce_linked_workspace_access(p_link_id)` (grantee
voluntarily gives up what they hold), and two list RPCs. Granted access
always uses `access_role = 'owner'` -- the same role `private.
can_view_learning_profile` requires -- so accepting a request is the only
way today for that helper to ever return true for a second, distinct auth
account. All SECURITY DEFINER, `search_path=''`, fully qualified, revoked
from public/anon, granted only to authenticated.

**Two independent reviews (security + regression/behavioral) both ran, and
both converged on the same core gap**, which was fixed before commit:
revoking a `verified_account_link` (pre-existing RPC, `20260903190000_
verified_account_links.sql`, not edited) only ever flipped the link's own
status -- it never touched any `workspace_access` row granted through it.
Since `redeem_account_link_invitation` reactivates the *same link row* on a
later re-verification of the same two accounts, a revoked-but-dangling grant
would silently go live again with no fresh accept -- directly undermining
this migration's own "must explicitly accept" design goal and CLAUDE.md's
"don't silently... share... material learner information." Fixed with
`20260904140000_revoke_link_cascades_workspace_access.sql`: a new migration
(not an edit to the immutable original) that redefines `revoke_verified_
account_link` to also cascade-revoke any active `workspace_access` between
exactly the link's two accounts and cancel any pending request between them.
Proven by a new scenario 8 in `supabase/tests/linked_workspace_access_
grants.sql`: grant access, revoke the *link* (not the grant), confirm the
cascade revoked it too, then reactivate the same link row and confirm access
is *not* silently restored.

**Other findings fixed before commit**:
- `granted_by` on the accept-time upsert was recording the *accepting*
  account's own `auth.uid()` (self-referential, misleading for any future
  audit use) instead of the requesting owner who actually offered access --
  fixed to look up the requester's `auth_user_id`.
- `list_my_linked_workspace_access_grants` didn't filter workspace `status`,
  unlike `private.can_view_learning_profile` itself -- added `w.status =
  'active'` to both CTEs so the list RPC can't show a grant the access-check
  helper would actually deny once workspace suspension exists.
- `runWorkspaceAccessAction` (ConnectedAccounts.jsx) only refreshed the
  request/grant lists on success. On failure -- e.g. two tabs both showing
  the same pending request, one accepts, the other's now-stale Accept/
  Decline buttons throw "Pending request not found" -- the UI never
  resynced, leaving the same broken buttons clickable indefinitely. Fixed to
  always refresh in `finally`, matching this same file's existing
  `handleSync` precedent ("a reauth-required error has already flipped the
  connection's status server-side").
- The panel showed one error banner shared across every linked account and
  all six action types, diverging from `LinkedAccountsList.jsx`'s documented
  per-row/per-dialog convention. Changed to a `{errors}` map keyed the same
  way as `busyKey` (e.g. `"revoke:<linkId>"`), rendered inline next to the
  specific row/action it came from.
- `onRevoke`/`onRenounce` fired immediately with no confirmation, unlike
  `LinkedAccountsList`'s confirm-before-revoke pattern and CLAUDE.md's
  "require clear confirmation for destructive actions." Added `ConfirmDialog`
  for both, auto-closing once the action finishes without an error (same
  pattern as `LinkedAccountsList`'s `wasRevoking` ref).
- Handling a link revocation from `LinkedAccountsList` now also refreshes
  the workspace-access lists (`handleRevokeAccountLink` in
  `ConnectedAccounts.jsx`), since the new cascade means a link revoke can
  silently change what the sharing panel should show.
- Added a test for the fully-bidirectional case (A shares with B and B
  shares with A simultaneously) that both reviews flagged as untested and
  visually easy to misread; the panel now labels each line "Your profile:"
  / "Their profile:" rather than relying on wording alone.

**Deliberately not fixed this session (documented, not forgotten)**:
- No feedback to a requester when their request is *declined* --
  `list_my_linked_workspace_access_requests` only returns `pending` rows, so
  a declined request just silently reverts to "not shared" on next reload.
  Fixing this well needs a "seen/dismiss" interaction, not just a query
  change, and was judged out of scope for this session.
- `granted_at` is overwritten (not preserved as history) on a revoke-then-
  re-accept cycle. Acceptable for now given there's no audit table for this
  relationship yet, consistent with how simple `verified_account_links`
  itself already is.
- The "Share your profile with them" button is always rendered even for a
  caller with no personal workspace to share (organisation-only accounts);
  clicking it surfaces `request_linked_workspace_access`'s own "You have no
  personal workspace to share" error, now inline on that row per the fix
  above, rather than being hidden proactively.

Verified: npm run lint/build/test:run (313 tests, up from 302 -- 11 new
component tests), supabase db reset --local, supabase db lint --local
--level error, and all three supabase/tests/*.sql suites, all clean.

## Session update: connections access helper (2026-09-04, new session)

Fifth domain-by-domain increment, picking up from the prior session's
"Remaining product and engineering work" list (item 1). Added in
`20260904150000_connections_access_helper.sql`:

- Converted `connections` (`0058_skill_discovery_and_connections.sql`).
  Unlike every table converted so far, it has two owning parties
  (`user_a_id`, `user_b_id`), not one `user_id` column, so it needed its own
  policy shape rather than a verbatim reuse of the single-column pattern: a
  row is visible if the caller can view *either* side's learning profile via
  `private.can_view_learning_profile` (`using (private.can_view_learning_
  profile(user_a_id) or private.can_view_learning_profile(user_b_id))`).
  Existing "Users can view their own connections" policy is unchanged.
  Checked first that it's the table's only policy, permissive, and has no
  `using (true)`. Its `GRANT SELECT` was already fixed in
  `20260904100000_grant_connections_select.sql`.
- Deliberately NOT converted: `connection_requests` and `connection_invites`
  -- pending, two-party invitation flows, matching the same "different
  access semantics" exclusion the prior session already applied to
  validation requests and connection invitations/requests when converting
  skills' dependent tables.
- Extended `supabase/tests/learning_profile_access.sql` with a dedicated
  connections scenario matrix (a second, fresh legacy user pair plus their
  own linked account) proving: both parties' own logins see the connection;
  an unrelated login is denied; each side's linked-account visibility is
  evaluated and revoked *independently* of the other side's (granting or
  revoking owner B's link/grant does not affect what owner A's linked
  account can see, and vice versa).
- Investigated whether "actions" (next in the handoff's own unconverted-
  domain list) is a real table to convert the same way: it isn't. `Actions`
  page aggregates many existing, already-reviewed sharing/invitation
  surfaces (validation requests, connection requests, org/employer/manager
  invites, employer data-access requests, course assignments, skill
  suggestions) rather than owning its own learner content, so it doesn't fit
  this mechanical single/two-party-ownership conversion pattern at all --
  each underlying surface would need its own bespoke review, if any is
  needed. Similarly, "evidence" in the handoff's inventory maps to
  `skill_assessments`, already converted in the prior session's third
  increment (skills' dependent tables). Picked `connections` instead as the
  next real, correctly-shaped root table.
- Regenerated `supabase/migrations/stage_bootstrap_consolidated.sql` per
  CLAUDE.md #17 (verified the diff against the prior bundle contains only
  the new migration's content, nothing else changed or reordered).

Still unconverted: `connection_requests`, `connection_invites`, xAPI (partial
-- see the third increment's `xapi_launch_sessions` exclusion), manager
sharing, employer sharing, and every table the third increment's own
"Deliberately NOT included" list already named (peer ratings, validation
requests, searchable skills, employer/manager-shared skills, public
share-link skills, parent/child experience links, employer role alignment
references, membership tables). The executor (§3 below) remains
out of scope until those are addressed or explicitly judged out of scope one
by one, per this document's own "Immediate next step" gating language.

Verified: `npx supabase db reset --local --no-seed`, `npx supabase db lint
--local --level error`, all three `supabase/tests/*.sql` suites (via `docker
exec supabase_db_learnscope psql`, since `psql` and `supabase db query
--local -f` don't support this project's `\set ON_ERROR_STOP` test files),
`npm run lint` (exit 0, pre-existing warnings only), `npm run build` (311
modules), `npm run test:run` (313 tests / 50 files, unchanged -- no frontend
code touched this increment).

## Session update: manager_team_memberships access helper (2026-09-04, continued)

Sixth domain-by-domain increment, same session, starting the "manager
sharing" domain. Added in
`20260904160000_manager_team_memberships_access_helper.sql`:

- Converted `manager_team_memberships` (`20260903130000_manager_team_
  foundation.sql`) -- the anchor/root table of manager sharing, same
  root-first approach as skills before its dependents. Unlike every table
  converted so far it has no single "owner" column; `member_user_id`
  identifies which learner (or, for a 'manager'-role row, which manager) a
  row is about. New additive policy: `private.can_view_learning_profile
  (member_user_id)`. This does not change a manager's own
  `can_manage_manager_team` visibility and does not let a linked account see
  a different learner's membership rows.
- `manager_teams` deliberately NOT touched: it belongs to the manager's own
  workspace, not a learner's personal learning profile -- out of scope for
  this transition entirely, not merely deferred.
- Dependents deliberately deferred as their own future increment (matching
  how skills' ~15 dependents were split from its own root-table migration):
  `manager_team_shared_skills`, `manager_team_learning_activities`,
  `manager_team_activity_participants`, `manager_collaboration_records`,
  `manager_collaboration_record_members`.
- Checked first: `manager_team_memberships` has exactly one existing policy,
  permissive, no `using (true)`, and already has `grant select ... to
  authenticated` from its original migration -- no grant migration needed.
- Extended `supabase/tests/learning_profile_access.sql` with a scenario
  matrix reusing the connections section's already-linked pair (owner
  `...004` / linked account `...005`, still active at this point in the
  file) plus a fresh manager/team/membership fixture: proves the member's
  own login is unaffected, an unrelated login is denied, the linked account
  sees the row once linked, and revoking the `workspace_access` grant alone
  (link left active) denies it again -- proving the policy is actually gated
  by the helper, not a static allow.
- Regenerated `stage_bootstrap_consolidated.sql`; diff-verified against the
  prior bundle contains only this migration's content.

Still unconverted: `manager_team_shared_skills`,
`manager_team_learning_activities`, `manager_team_activity_participants`,
`manager_collaboration_records`, `manager_collaboration_record_members`,
`connection_requests`, `connection_invites`, employer sharing, and every
table named in the prior two "still unconverted" notes above. The executor
remains out of scope until those are addressed or explicitly judged out of
scope one by one.

Verified: same full suite as the connections increment above (`db reset
--local --no-seed`, `db lint --local --level error`, all three
`supabase/tests/*.sql` suites via `docker exec supabase_db_learnscope
psql`, `npm run lint` exit 0, `npm run build`, `npm run test:run` 313
tests / 50 files unchanged).

## Session update: manager_team_memberships dependents (2026-09-04, continued)

Seventh domain-by-domain increment, same session, closing out the
"manager sharing" domain's read-access conversion (except two tables ruled
permanently out of scope, below). Added in
`20260904170000_manager_team_dependents_access_helper.sql`:

- Converted `manager_team_shared_skills`, `manager_team_learning_activities`,
  and `manager_team_activity_participants` -- the three dependents deferred
  from the root `manager_team_memberships` increment. Each existing policy
  already let the member's own login see the row via `member_user_id =
  auth.uid()` (directly or through a `manager_team_memberships` join); each
  new additive policy is the exact same check with `private.
  can_view_learning_profile(member_user_id)` substituted in, so a linked
  account sees only what the member's own login could already see.
- `manager_collaboration_records` and `manager_collaboration_record_members`
  turned out to be permanently out of scope, not merely deferred: unlike
  every other table in this domain, their only existing policies gate on
  `private.can_manage_manager_team` (manager-only) -- a team member's own
  login has no visibility into them today, so there is no member-level
  access for a linked account to extend. They are manager-authored content
  about the team, not the learner's own profile content, the same reasoning
  that already excluded `manager_teams` itself.
- Checked first: all three converted tables have exactly one existing
  policy each, all permissive, none with `using (true)`, and all three
  already have `grant select ... to authenticated` from the original
  foundation migration -- no grant migration needed.
- Extended `supabase/tests/learning_profile_access.sql`, reusing the
  manager/team/membership fixture from the root-table section: one
  representative row per table (same proportionate-coverage rationale used
  for skills' own dependents), proving member/unrelated/linked-before-grant/
  linked-after-grant-reactivated across all three tables together.
- Regenerated `stage_bootstrap_consolidated.sql`; diff-verified against the
  prior bundle contains only this migration's content.

The manager-sharing domain's read-access conversion is now complete (two
tables ruled out of scope, the rest converted). Still unconverted:
`connection_requests`, `connection_invites`, employer sharing, and every
table named in the earlier "still unconverted" notes above (peer ratings,
validation requests, searchable skills, employer/manager-shared skills,
public share-link skills, parent/child experience links, employer role
alignment references, membership tables). The executor remains out of scope
until those are addressed or explicitly judged out of scope one by one.

Verified: same full suite as the two prior increments (`db reset --local
--no-seed`, `db lint --local --level error`, all three
`supabase/tests/*.sql` suites via `docker exec supabase_db_learnscope
psql`, `npm run lint` exit 0, `npm run build`, `npm run test:run` 313 tests
/ 50 files unchanged).

## Session update: connection_requests/connection_invites (2026-09-04, continued)

Eighth domain-by-domain increment, same session. Added in
`20260904180000_connection_requests_invites_access_helper.sql` and
`20260904181500_grant_connection_invites_select.sql`:

- Reviewed and converted both tables deferred since the skills-dependents
  and connections increments as "different access semantics": on inspection
  neither actually needed bespoke treatment. `connection_requests`
  (`requester_id`, `recipient_id`) is two-party, identical shape to
  `connections` itself -- same additive either-side policy.
  `connection_invites` (`inviter_id`, share-code based) is single-owner,
  identical shape to skills/courses/experience -- same additive
  `private.can_view_learning_profile(inviter_id)` policy. `accepted_by` on
  `connection_invites` gets no new visibility: the existing schema never
  gave the accepter read access to the invite either, so this stays purely
  additive to what the inviter's own login could already see.
- Checked first: both tables have exactly one existing SELECT policy each,
  both permissive, neither with `using (true)`.
- Found a third instance of the now-familiar local/Staging grant gap:
  `connection_invites` has never had `grant select ... to authenticated` in
  any migration (confirmed via `information_schema.role_table_grants`
  against a fresh local reset: `authenticated` has TRUNCATE/REFERENCES/
  TRIGGER on it but not SELECT/INSERT/UPDATE/DELETE). `connection_requests`
  already had its grant from
  `20260903160000_restore_learner_action_read_grants.sql`. Same verdict as
  every prior instance of this gap: not broken on Staging (ambient default
  ACL), fixed here for local dev and `stage_bootstrap_consolidated.sql`'s
  from-empty bootstrap case.
- Extended `supabase/tests/learning_profile_access.sql`, reusing owner a
  (`...004`) and its already-active linked account (`...005`): proves the
  requester/inviter's own login, a genuinely unrelated login, and the linked
  account, across both tables together; connection_requests' two-party
  independence was already exhaustively proven on `connections` itself, so
  this adds one proportionate spot check (the recipient's own login sees
  the request) rather than re-proving full two-sided independence again.
- Regenerated `stage_bootstrap_consolidated.sql`; diff-verified against the
  prior bundle contains only these two migrations' content.

Still unconverted: employer sharing, and every table named in the earlier
"still unconverted" notes above (peer ratings, validation requests,
searchable skills, employer/manager-shared skills, public share-link
skills, parent/child experience links, employer role alignment references,
membership tables). The executor remains out of scope until those are
addressed or explicitly judged out of scope one by one.

Verified: same full suite as prior increments (`db reset --local
--no-seed`, `db lint --local --level error`, all three
`supabase/tests/*.sql` suites via `docker exec supabase_db_learnscope
psql`, `npm run lint` exit 0, `npm run build`, `npm run test:run` 313 tests
/ 50 files unchanged).

## Session update: employer sharing access helper (2026-09-04, continued)

Ninth domain-by-domain increment, same session, starting the "employer
sharing" domain. Added in `20260904190000_employer_sharing_access_helper.sql`
and `20260904191500_grant_employer_data_access_shared_skills_select.sql`:

- Converted four tables whose shape already matched an established pattern:
  `employer_data_access_requests` and `employer_skill_suggestions`
  (single-owner via `learner_id`, same shape as skills/courses/experience),
  `course_assignments` (single-owner via `assigned_to` -- same principle,
  different column name), and `employer_data_access_shared_skills`
  (dependent, joins via `request_id` to `employer_data_access_requests.
  learner_id` -- same pattern as `manager_team_shared_skills` joining via
  `membership_id`). None of this changes an employer admin's own
  `is_employer_admin`-gated visibility.
- Checked first: all four tables have exactly the SELECT policies already
  on record, all permissive, none with `using (true)`.
  `employer_data_access_requests`, `employer_skill_suggestions`, and
  `course_assignments` already had `grant select ... to authenticated` from
  `20260903160000_restore_learner_action_read_grants.sql`.
  `employer_data_access_shared_skills` did not -- the fourth instance of
  this transition's now-familiar local/Staging grant gap, confirmed via
  `information_schema.role_table_grants` against a fresh local reset and
  fixed the same way as the prior three instances.
- Deliberately NOT included: `employer_role_profiles`/`employer_role_
  assignments` -- a materially different, mutual-consent role-alignment
  shape (no direct learner column; joins through `employer_members`, and
  represents a two-sided proposal/accept relationship rather than plain
  learner-owned content) that needs its own dedicated review rather than a
  mechanical reuse of this pattern. `employer_members`/`organisation_
  members`/`profile_share_links` remain out of scope for the same
  membership/account-setting reasoning as before.
- Extended `supabase/tests/learning_profile_access.sql` with fixtures across
  all four tables (organisation, employer, data-access request, shared
  skill, skill-library suggestion, catalogue course assignment), proving
  learner/unrelated/linked-active/linked-after-grant-revoked across all four
  together.
- Regenerated `stage_bootstrap_consolidated.sql`; diff-verified against the
  prior bundle contains only these two migrations' content.

Still unconverted: `employer_role_profiles`, `employer_role_assignments`,
`employer_members`, `organisation_members`, `profile_share_links`, and
every table named in the earlier "still unconverted" notes above (peer
ratings, validation requests, searchable skills, employer/manager-shared
skills, public share-link skills, parent/child experience links). The
executor remains out of scope until those are addressed or explicitly
judged out of scope one by one.

Verified: same full suite as prior increments (`db reset --local
--no-seed`, `db lint --local --level error`, all three
`supabase/tests/*.sql` suites via `docker exec supabase_db_learnscope
psql`, `npm run lint` exit 0, `npm run build`, `npm run test:run` 313 tests
/ 50 files unchanged).

## Session update: peer ratings and validation requests (2026-09-04, continued)

Tenth domain-by-domain increment, same session. Added in
`20260904200000_peer_ratings_validation_requests_access_helper.sql` and
`20260904201500_grant_skill_peer_ratings_select.sql`:

- Reviewed and converted both tables deferred since the skills-dependents
  increment as "different access semantics": `skill_peer_ratings`
  (`skill_owner_id`) is single-owner, same shape as skills/courses/
  experience -- its other existing policy (validators reviewing skills
  they're validating) is an unrelated third-party path and stays untouched.
  `rater_id` gets no new visibility: raters never had a SELECT policy of
  their own either, so this stays purely additive to what the skill owner's
  own login could already see. `skill_validation_requests` (`requester_id`,
  `validator_id`) is two-party, same either-side shape as connections/
  connection_requests.
- Checked first: both tables' policies are exactly the ones already on
  record, all permissive, none with `using (true)`.
- Found a fifth instance of the local/Staging grant gap:
  `skill_peer_ratings` has never had `grant select ... to authenticated` in
  any migration (confirmed via `information_schema.role_table_grants`
  against a fresh local reset). `skill_validation_requests` already had its
  grant from `20260903160000_restore_learner_action_read_grants.sql`.
- Extended `supabase/tests/learning_profile_access.sql` with a fresh
  rating/validator fixture, reusing owner a and its linked account: proves
  owner/unrelated/linked-active/linked-after-revoke across both tables.
- Regenerated `stage_bootstrap_consolidated.sql`; diff-verified against the
  prior bundle contains only these two migrations' content.

Still unconverted: searchable skills, employer/manager-shared skills,
public share-link skills, parent/child experience links,
`employer_role_profiles`/`employer_role_assignments`,
`employer_members`/`organisation_members`/`profile_share_links`, and
`manager_collaboration_records`/`manager_collaboration_record_members`
(these last two ruled permanently out of scope, not deferred -- see their
own increment above). The executor remains out of scope until the rest are
addressed or explicitly judged out of scope one by one.

Verified: same full suite as prior increments (`db reset --local
--no-seed`, `db lint --local --level error`, all three
`supabase/tests/*.sql` suites via `docker exec supabase_db_learnscope
psql`, `npm run lint` exit 0, `npm run build`, `npm run test:run` 313 tests
/ 50 files unchanged).

## Session update: applied to Staging (2026-09-04, continued)

All 17 migrations from `20260904090000` through `20260904201500`
(everything in this domain-foundation transition up to this point) were
applied to the Staging Supabase project (`ussqcmfxbbtncjvepuyn`) via
`npx supabase db push --linked`. Before pushing: confirmed via `git ls-tree`
that this branch already contains every migration `origin/staging` has (no
missing predecessors), and `npx supabase migration list --linked` showed no
migration applied to Staging outside a committed file. All 17 applied
cleanly; `migration list --linked` re-checked afterward to confirm
local/remote now match, and a direct query confirmed the new "Linked
accounts can view accessible..." policies are present on Staging (26 at
that point). This is a worktree freshly linked to Staging for this session
(`.env`/link state isn't copied into new git worktrees) -- future sessions
continuing this branch elsewhere will need their own `supabase link
--project-ref ussqcmfxbbtncjvepuyn` before any remote command.

## Session update: searchable and share-link skills (2026-09-04, continued)

Eleventh domain-by-domain increment, same session. Added in
`20260904210000_searchable_and_share_link_skills_access_helper.sql` and
`20260904211500_grant_searchable_and_share_link_skills_select.sql`:

- Converted `profile_searchable_skills` (`profile_id`, single-owner, same
  shape as skills/courses/experience) and `profile_share_links` (`user_id`,
  also single-owner -- its only existing policy is the owner's own
  management view of links they created; the separate public/anonymous
  token-based consumption path goes through its own SECURITY DEFINER RPCs,
  untouched by this). `profile_share_link_skills` is a dependent, joining
  via `share_link_id`, same pattern as `employer_data_access_shared_skills`.
- **Corrected this transition's own record**: an earlier increment grouped
  `profile_share_links` with `employer_members`/`organisation_members` as
  "membership and account-setting records, not learning-profile content."
  Direct inspection here shows that doesn't hold -- `profile_share_links` has
  no admin/role semantics; it's the learner's own created records about
  their own profile, structurally identical to `connection_invites`
  (already converted). `employer_members`/`organisation_members` remain
  correctly out of scope; `profile_share_links` did not belong in that
  group.
- Confirmed "parent/child experience links" needs no migration of its own:
  `parent_experience_id` is a plain self-referential column on `experience`
  itself, already fully covered by `experience`'s own policy from the
  courses/experience increment.
- Checked first: all three tables have exactly the one existing SELECT
  policy each, all permissive, none with `using (true)`. None of the three
  had `grant select ... to authenticated` in any migration -- the sixth
  through eighth instances of this transition's grant gap, fixed the same
  way as every prior instance.
- Extended `supabase/tests/learning_profile_access.sql` with fixtures across
  all three tables, proving owner/unrelated/linked-active/linked-after-
  revoke together.
- Regenerated `stage_bootstrap_consolidated.sql`; diff-verified against the
  prior bundle contains only these two migrations' content.

Still unconverted: `employer_role_profiles`/`employer_role_assignments`
(materially different mutual-consent shape, needs dedicated review) and
`employer_members`/`organisation_members` (membership/account-setting
records, correctly out of scope). `manager_collaboration_records`/
`manager_collaboration_record_members` are also permanently out of scope
(see their own increment). The executor remains out of scope until the rest
are addressed or explicitly judged out of scope.

Verified: same full suite as prior increments (`db reset --local
--no-seed`, `db lint --local --level error`, all three
`supabase/tests/*.sql` suites via `docker exec supabase_db_learnscope
psql`, `npm run lint` exit 0, `npm run build`, `npm run test:run` 313 tests
/ 50 files unchanged). Not yet applied to Staging -- see the migration
workflow in CLAUDE.md #10 before pushing.

## Session update: employer_role_assignments (2026-09-04, continued)

Twelfth domain-by-domain increment, same session, resolving the one
remaining item flagged as needing dedicated design review. Added in
`20260904220000_employer_role_assignments_access_helper.sql`:

- Full re-review split this into two independent pieces rather than one
  "materially different" whole. `employer_role_profiles`, `employer_role_
  profile_skills`, and `employer_role_profile_training` have no learner-
  owned column at all -- they're the employer's own role templates,
  visible only to active employer members; `created_by` is an audit field,
  not ownership. These are permanently out of scope, same reasoning as
  `manager_teams`. `employer_role_assignments` does have a resolvable
  learner side (`employer_member_id` -> `employer_members.user_id`) and
  fits the established dependent-join pattern -- converted.
- **The SQL allow/deny test caught a real bug before commit**: the first
  version of this migration's policy subqueried `employer_members` directly
  to resolve `employer_member_id` to `user_id`. Unlike every prior
  dependent-table conversion (which joins through a table *also* being
  converted in the same transition), `employer_members` is deliberately
  never converted -- so that subquery runs under the *caller's own* RLS on
  `employer_members`, whose policies only cover "is a member/admin of this
  employer" or "auth.uid() = user_id" -- neither true for a linked account
  acting for a different `auth.uid()`. Result: the subquery silently
  returned zero rows and denied access even with an active link and grant,
  caught immediately by scenario 3 of the new test (expected visible=true,
  got false). Fixed the same way `learning_profiles`/`workspaces`' own
  equivalent cross-person lookup problem was fixed in the very first
  migration of this transition: a narrow `private.employer_member_user_id
  (uuid)` SECURITY DEFINER helper that resolves the lookup bypassing
  employer_members' RLS, without exposing employer_members itself any more
  broadly. One further correction from that same first-migration pattern:
  `private.personal_workspace_owner_account` is only ever called from
  *inside* another SECURITY DEFINER function's body, so `authenticated`
  never needed direct execute on it -- but this new helper is called
  directly from the policy's `USING` clause, which runs as the querying
  role, so it needed its own explicit `grant execute ... to authenticated`
  (a first version mistakenly revoked it from authenticated too, following
  the other helper's grants literally rather than by function).
  **Any future dependent-table conversion must check whether the table it
  joins through is itself being converted in this transition -- if not, a
  security-definer resolver function is required, not a plain subquery.**
- Checked first: `employer_role_assignments` has exactly the one existing
  SELECT policy, permissive, no `using (true)`, already granted `select` to
  `authenticated`.
- Extended `supabase/tests/learning_profile_access.sql` with an employer-
  member/role-profile/assignment fixture, proving learner/unrelated/linked-
  active/linked-after-revoke -- this is the test that caught the bug above.
- Regenerated `stage_bootstrap_consolidated.sql`; diff-verified against the
  prior bundle contains only this migration's content.

This closes out the domain-by-domain ownership transition (item 1 of
"Remaining product and engineering work" below) except for tables correctly
ruled permanently out of scope (`manager_teams`, `manager_collaboration_
records`/`_members`, `employer_members`, `organisation_members`,
`employer_role_profiles`/`_skills`/`_training`) and `connection_invites`/
`connection_requests`' underlying pending-invitation semantics already
covered. The executor (item 3) can now be considered, subject to items 2-4
below still being unaddressed.

Verified: same full suite as prior increments (`db reset --local
--no-seed`, `db lint --local --level error`, all three
`supabase/tests/*.sql` suites via `docker exec supabase_db_learnscope
psql`, `npm run lint` exit 0, `npm run build`, `npm run test:run` 313 tests
/ 50 files unchanged). Not yet applied to Staging -- see the migration
workflow in CLAUDE.md #10 before pushing.

## Session update: the transactional executor (2026-09-04, new session)

Item 3 -- built end to end (backend RPC, audit trail, and the frontend
execute button), scoped to skills/courses/experience only per Decision 3
above. Three migrations:

- `20260904225000_fix_skills_fingerprint_alias_collision.sql`: fixes a
  **pre-existing bug** in the already-deployed, otherwise-immutable
  `create_profile_transfer_plan` (`20260903210000_profile_transfer_plans.
  sql`). `skills` has a column literally named `source`
  (`0008_skill_source.sql`); the original function also aliased the table
  itself as `source`, so `to_jsonb(source)` resolved to the *column*, not
  the row -- every skills plan item's stored fingerprint was a hash of a
  string like `"manual"`, not the row, silently defeating the staleness
  check for skills specifically (courses/experience use `source`/`target`
  aliases that don't collide with any of their own columns, so they were
  never affected). Found by the executor's own allow/deny test failing in
  a way that made no sense until traced with a minimal repro. Fixed by
  renaming the alias to `src`; every other line is byte-identical to the
  original.
- `20260904230000_transfer_plan_conflict_guards.sql`: enforces Decision 2
  (`docs/profile-transfer-execution-rules.md`) -- three new `private.
  *_has_exclusive_dependents` helpers, and `resolve_profile_transfer_plan_
  item` now refuses `keep_durable`/`use_source` when the losing side has
  any exclusive dependent, with a clear error telling the learner to
  choose Move instead.
- `20260904240000_profile_transfer_executor.sql`: `execute_profile_
  transfer_plan(p_plan_id, p_idempotency_key)`, following the handoff's
  own ten-step guard sequence -- locks the plan row first, re-verifies
  approval status/version hash/two-current-approvals/expiry/active link
  from scratch (never trusts anything from an earlier phase), recomputes
  and compares every item's fingerprint under `FOR UPDATE` (aborting on
  any drift since approval), re-verifies Decision 2 defensively (not just
  trusting the resolve-time check), re-verifies Decision 1 (a parent
  experience and its children must share one action -- checked as its own
  pass, not built into plan creation, so it's a hard abort rather than a
  UI constraint), applies every item's action, does one identity-scoped
  pass over every dependent table, records an audit trail
  (`profile_transfer_execution_records`, new table), and only marks the
  plan `executed` after a postcondition check proves it. Idempotent: a
  retried call with the same key returns the prior result; a different key
  against an already-executed plan is rejected outright.

**Independent security review before this was called done** (per CLAUDE.md
"Subagent Usage") caught one HIGH and one MEDIUM finding, both fixed
before commit:

- **HIGH**: the dependent-table reassignment pass was written as a plain
  identity match (`where user_id = v_source_user_id`), on the theory that
  every surviving dependent already belongs to a moved root. That's only
  true for dependents that existed *when the plan was created*. Plans can
  sit approved for up to 7 days (`profile_transfer_plans.expires_at`); a
  skill added during that window is correctly never captured in the plan
  and correctly stays with the source login, but the identity-only sweep
  would still reassign *its* target/tag/assessment/etc. to the durable
  login -- and since several of those tables' RLS is unconditional on that
  one denormalized column (`skill_targets`: `using (auth.uid() = user_id)`,
  no join back to the skill's own ownership), that's a real unintended
  access grant to a skill the durable login doesn't own, not just an
  inconsistency. Fixed by scoping every skill/course/experience-keyed
  dependent update to the specific ids this execution actually processed
  (`profile_transfer_execution_records`, populated earlier in the same
  call) rather than identity alone. `rater_id`/`validator_id` on
  `skill_peer_ratings`/`skill_validation_requests` are the one deliberate
  exception, left identity-scoped: those describe the transferring
  learner's own action on *someone else's* skill (nothing in this plan to
  scope against), matching principle 1 of the execution-rules doc, and
  neither column drives that table's own RLS. Added a dedicated scenario
  to `supabase/tests/profile_transfer_executor.sql` proving the fix: a
  skill created after approval keeps its dependents on the source login
  through execution.
- **MEDIUM**: `course_content_progress` (SCORM/xAPI completion evidence)
  was never reassigned at all, contradicting the execution-rules doc's own
  `move` rule for courses. Root cause: it has no FK to the personal
  `courses` table -- it's keyed to `content_resources` (organisation
  content library, `0073_content_resource_library.sql`), linked to a
  specific catalogue course only via `course_content_links(course_id,
  resource_id)`. Fixed by joining `content_item_id -> course_content_
  links.resource_id -> course_content_links.course_id ->
  courses.catalogue_course_id`, the same join `course_content_progress`'s
  own "Provider admins can view participant progress" policy already uses
  -- confirmed against the live schema after getting the join wrong twice
  first (once assuming a renamed-away `course_content_items.course_id`
  that no longer exists post-`0073`, once before checking `content_
  resources` had no course-scoped column at all).
- A second MEDIUM (peer-rating/validation-request/share-link/searchable-
  skills ownership moves with no dedicated plan-item preview, since they
  ride along with the skills domain's move action rather than being
  previewed as their own line items) and a LOW (any plan created against
  the pre-fix buggy fingerprint function will fail execution with a
  confusing "changed since approval" error, since it can never match the
  corrected recompute) were reviewed and accepted as known, documented
  behavior rather than fixed in this pass -- the first is an accepted
  consequence of `docs/profile-transfer-execution-rules.md`'s own scoping
  (these tables were deliberately grouped under "skills dependents," not
  named as a fourth domain needing new preview UI in Decision 3); the
  second only matters if a real plan with skills conflicts was created and
  approved on Staging before this fix shipped, worth a quick check before
  or during deploy.

Frontend: `src/pages/account-linking/transfer-plan/PlanApprovalPanel.jsx`
gets a new "Execute this transfer" section, shown only once `status ===
'approved'`, alongside (not replacing) Withdraw -- both remain valid
actions post-approval. Its confirmation dialog requires literally typing
"execute" (not just a checkbox, unlike Approve's dialog), since this is
the one action in the whole feature area that actually moves data instead
of recording consent. `src/pages/ConnectedAccounts.jsx`'s
`handleExecuteTransferPlan` generates an idempotency key once per attempt
via `executeIdempotencyKeyRef` and reuses it across retries of that same
attempt (only regenerating when `transferPlan.id` changes or an attempt
succeeds), so a retry after a network error is recognised server-side as
the same attempt rather than a second execution. 9 new component tests in
`PlanApprovalPanel.test.jsx`.

Verified: `db reset --local --no-seed`, `db lint --local --level error`,
all four `supabase/tests/*.sql` suites (the three existing plus the new
`profile_transfer_executor.sql`) via `docker exec supabase_db_learnscope
psql`, `npm run lint` exit 0, `npm run build`, `npm run test:run` (322
tests / 50 files, up from 313). Not yet applied to Staging.

## Remaining product and engineering work

### 1. Replace login-ID ownership with profile ownership

**Status (2026-09-04): done.** Completed across twelve domain-by-domain
session updates above (learning-profile access helper through
`employer_role_assignments`). Every table with a learner-identifying column
now has an additive `private.can_view_learning_profile`-gated read policy,
or is explicitly, reviewably ruled out of scope (manager/employer
membership tables, credential-bearing tables, employer-side role
templates). See the session-update log above for the full per-table record
and the one real bug an allow/deny test caught (`employer_role_assignments`'
cross-table RLS lookup). The steps below are the original plan, kept for
context; it was executed via RLS-policy-domain-by-domain rather than a
`learning_profile_id` compatibility column, since `private.can_view_
learning_profile(legacy_user_id)` proved sufficient without one.

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

**Status (2026-09-04): specified and decided, not implemented.** See
`docs/profile-transfer-execution-rules.md` for the full, reviewed
move/keep_durable/use_source rule set per table, built directly from item
1's completed table-by-table inventory (more precise than the summary
below, which predates that inventory and undercounts/miscategorizes a few
tables -- e.g. "employer role alignment references" turned out to need no
transfer rule at all, not a dependency to handle). Its three open questions
were decided the same session (project owner's call, all three the
recommended option):

1. A parent experience and its children are always one atomic plan-item
   decision -- never allowed to diverge across profiles.
2. `keep_durable`/`use_source` refuses when the source item has exclusive
   dependents (evidence, validation history, etc.); the only legal
   resolution then is a renamed `move`, accepting some duplicate-looking
   records over ever silently discarding evidence. No re-parenting UI will
   be built.
3. **New prerequisite before item 3**: connections/xAPI/employer/manager
   domains need real `profile_transfer_plan_items` preview coverage (new
   `domain` values, item-generation queries, review-UI rendering) before
   the executor can touch them -- until that exists, the executor's first
   buildable scope is skills/courses/experience only, the three domains
   already modeled today.

Original dependency catalog kept below for context; superseded by the new
document where they differ.

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
