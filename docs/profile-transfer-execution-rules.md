# Profile transfer execution rules

Design deliverable for `docs/claude-account-portability-handoff.md`
"Remaining product and engineering work" item 2, "Define domain-specific
execution rules." This is a specification, not an implementation: no
migration or RPC in this document has been written yet. It exists so the
guarded transactional executor (item 3) can be built against a reviewed,
concrete rule set instead of ad hoc per-table decisions made mid-implementation.

Written after the domain-by-domain ownership/read-access transition (item 1)
completed. That transition's own inventory of every table with a
learner-identifying column is the source for the table list below; see
`docs/claude-account-portability-handoff.md`'s session-update log for how
each was reviewed.

## Scope

A transfer plan (`profile_transfer_plans` / `profile_transfer_plan_items`,
`20260903210000_profile_transfer_plans.sql`) already exists and already
computes `move` / `keep_durable` / `use_source` / `unresolved` actions --
but only for three root domains (`skills`, `courses`, `experience`), matched
by name against the durable profile's existing rows. This document extends
that model to every other table a transferring learner's data touches, and
defines precisely what each action does to a row once execution actually
happens (which does not exist yet).

## General principles

1. **Reassignment is column-scoped, not table-scoped.** A table is not
   "the learner's table" or "not the learner's table" as a whole. Each
   individual learner-identifying column on a row is reassigned
   independently, and *only* if its current value equals the source
   profile's `legacy_user_id`. A row can have one column reassigned and
   another left untouched (see peer ratings and validation requests below).
2. **Audit/actor columns never move**, even if the transferring learner
   happens to be the actor. `created_by`, `invited_by`, `proposed_by`,
   `assigned_by`, `granted_by`, and equivalents record who took an
   administrative action, not whose content the row is. Rewriting them on
   transfer would falsify history, against CLAUDE.md's "preserve
   `created_at`/`updated_at`... never substitute" and "don't infer
   causation... warn about inconsistent dates rather than silently
   modifying" principles. The one blurred case -- `connection_invites.
   inviter_id` and `profile_share_links.user_id` -- is *not* an audit
   column: for those two tables the creator **is** the sole owner concept
   the table has (already established during the read-access transition),
   so it reassigns like any other ownership column.
3. **`move` never changes a row's primary key**, only the ownership
   column(s) on it. Any FK that points *at* that row (e.g. `skill_targets.
   skill_id` pointing at a moved `skills.id`) therefore needs no change at
   all -- the moved row is still found at the same id. Only a dependent
   row's *own*, denormalized ownership column (its own `user_id`,
   `skill_owner_id`, etc.) needs reassigning, and only where it currently
   equals the source profile's id.
4. **`keep_durable` retires the source root and every one of its exclusive
   dependents** (rows that exist only because that source root exists --
   assessments, targets, tags, links, ratings, validation requests, xAPI
   statement-skill links keyed to the source skill, etc.). Retiring means
   deleting the dependent rows and the source root itself, never silently
   merging their content into the durable root's row. If a dependent
   carries content that must not be lost (evidence, a validation history,
   a completed course assessment), `keep_durable` is only a legal action
   for that plan item if no such dependent exists on the source side, or if
   it has already been explicitly re-parented to the durable root as part
   of conflict resolution (not yet designed -- see Open questions).
5. **`use_source` is the mirror of `keep_durable`**: the source root
   becomes canonical (effectively treated as a `move`), and the *durable*
   profile's matching root plus its exclusive dependents are the ones
   retired, using the same no-silent-merge rule.
6. **Credential-bearing and ephemeral tables are never moved automatically**,
   regardless of ownership: `xapi_launch_sessions` (live bearer token,
   4-hour expiry, already excluded from the read-access transition for the
   same reason) and `external_connections` (live third-party OAuth tokens --
   Strava). Moving a live token to a different Supabase Auth login without
   the third party's own re-consent is a security/consent question, not a
   data-ownership one. These are left on the source login; the durable
   login reconnects independently if it wants the integration. Any rows
   already expired/revoked at transfer time can simply be left behind
   (they carry no ongoing capability).
7. **Employer- and manager-relationship tables are never moved.** A
   learner's relationship to a specific employer or manager team is
   established through *that specific auth login's* `employer_members` /
   `organisation_members` / `manager_team_memberships` row -- rows this
   transition has already correctly ruled out of scope for read-access
   conversion, and the same reasoning applies here even harder: silently
   re-pointing an `employer_members.user_id` to the durable login would
   grant that employer relationship (and everything gated on it --
   `employer_role_assignments`, `manager_team_shared_skills`, course
   assignments visible only via membership) to a login that never actually
   joined that employer or team. This matches
   `docs/account-portability.md` invariant 1 ("Employer membership never
   proves personal-account ownership") and phase 5's employer-departure
   design: employer/manager relationships end and are re-established per
   login, they do not travel with a profile transfer. Tables gated purely
   through those membership tables (`employer_role_assignments`,
   `manager_team_shared_skills`, `manager_team_learning_activities`,
   `manager_team_activity_participants`) therefore have **no transfer rule
   of their own** -- they are left exactly as they are, still attached to
   the source login's now-former membership.
8. **Global/shared reference data is never touched.** `tags`, `skill_
   library`, `course_catalogue` and similar shared vocabulary are
   referenced by id and are not learner-owned; no dependent needs any
   change to these FKs under any action.

## Root domains already modeled by `profile_transfer_plan_items`

These already have `move`/`keep_durable`/`use_source` computed by
`create_profile_transfer_plan`. What's missing is what happens to their
dependents once an action actually executes -- today nothing executes at
all.

### skills (root)

- `move`: reassign `skills.user_id` to the durable login. No dependent's FK
  to `skills.id` changes (principle 3). Reassign every dependent's own
  denormalized `user_id` where it equals the source login, for: `skill_
  assessments`, `skill_baseline_quizzes`, `skill_tags`, `skill_targets`,
  `skill_course_links`, `skill_experience_links`, `xapi_statement_skills`.
- `skill_peer_ratings`: two learner-identifying columns, reassigned
  independently. `skill_owner_id` reassigns when the *moved* skill's owner
  is the transferring learner (always true for a rating row on a moved
  skill, per principle 1). `rater_id` reassigns separately, and only for
  rows where the transferring learner was the *rater* of someone else's
  skill (a skill that is not part of this transfer at all) -- that skill's
  `skill_owner_id` must never be touched.
- `skill_validation_requests`: `requester_id` and `validator_id` reassign
  independently by the same rule -- a row where the transferring learner
  was the validator for someone else's skill keeps that skill's owner
  identity untouched and only reassigns `validator_id`.
- `profile_searchable_skills`, `profile_share_links` (+ its dependent
  `profile_share_link_skills`, via the share link's own reassigned
  `user_id` -- no FK to change per principle 3): reassign `profile_id` /
  `user_id`.
- `connection_invites`: reassign `inviter_id` (ownership column per
  principle 2). Do **not** reassign `accepted_by` -- that identifies
  whoever redeemed the invite, a different person from the inviter, exactly
  like `rater_id` above.
- `manager_team_shared_skills`, `employer_data_access_shared_skills`: FK to
  `skills.id` only, no owning column of their own -- no change needed
  (principle 3), *provided* the membership/request row they join through
  is not itself being reassigned (it never is, per principle 7 for
  manager, and see courses/experience below for employer data-access
  requests, which *is* reassignable since it's learner-owned, not a
  membership table).
- `keep_durable`/`use_source`: retire (principle 4) or promote (principle
  5) the losing root skill plus its *exclusive* dependents listed above.
  `skill_peer_ratings`/`skill_validation_requests` rows where the
  transferring learner was the *other party* (rater/validator on someone
  else's skill) are not exclusive to this skill and are unaffected either
  way. `xapi_statements.skill_id` (see courses section for the parallel
  `.course_id` case) `set null`s on the retired skill's deletion; the
  statement itself survives.

### courses (root)

- `move`: reassign `courses.user_id`. Reassign dependents' own `user_id`:
  `course_content_progress` (via `content_item_id`, itself org-owned
  catalogue content -- untouched), `skill_course_links`, `course_
  experience_links`. `xapi_statements.course_id` (added by `0020_xapi_
  statements_course_id.sql`) and `.skill_id` (added by `0021_xapi_
  statements_skill_id.sql`) are plain FKs to a specific `courses`/`skills`
  row, `on delete set null` -- no change needed under `move` (principle 3,
  the referenced row's id doesn't change); `xapi_statements` reassignment
  itself is governed entirely by its own `user_id` under the skills-domain
  xAPI rule below, independent of whether the course/skill it's linked to
  also moves. `course_assignments.catalogue_course_id` points at shared
  catalogue content, not a personal `courses` row -- no relation to this
  domain's `move` at all.
- `keep_durable`/`use_source`: retire/promote the course plus its exclusive
  dependents (`skill_course_links`, `course_experience_links` rows keyed to
  it, `course_content_progress` rows keyed to its enrolled `content_item_
  id`s if the course was enrolled from catalogue content -- needs the same
  content-item lookup `courses.catalogue_course_id`/`course_content_links`
  already uses elsewhere, not re-derived here). A retired course's `id`
  going away also `set null`s `xapi_statements.course_id` on any statement
  that referenced it (existing FK behavior, same as an ordinary unlink --
  the statement itself is never deleted, matching "unlinking must not
  delete the underlying record").

### experience (root)

- `move`: reassign `experience.user_id`. Reassign dependents' own
  `user_id`: `skill_experience_links`, `course_experience_links`.
  `parent_experience_id` is self-referential on `experience` itself; per
  Decision 1 below, a parent and every child pointing at it are always the
  same plan item action, so both carry their own `user_id` reassignment
  together and the self-reference never crosses profiles.
- `employer_role_assignments.learner_experience_id`: set by the learner
  themselves via `decide_employer_role_assignment`, but the *assignment
  row* is out of scope per principle 7 (gated through `employer_members`).
  If the linked `experience` row moves, this FK still resolves to the same
  experience id (principle 3), now owned by the durable login -- consistent,
  requires no change.
- `keep_durable`/`use_source`: retire/promote the experience plus its
  exclusive dependents, subject to Decision 2 below (refuses if exclusive
  dependents exist -- forces a renamed `move` instead). Per Decision 1, a
  source experience with children is always grouped with them, so this
  action applies to the whole parent+children set together.

## Domains not yet in `profile_transfer_plan_items` (need new domain values + item generation)

`profile_transfer_plan_items.domain` is `check (domain in ('skills',
'courses', 'experience'))` today. Each of these needs its own domain value,
its own duplicate-detection query in `create_profile_transfer_plan` (or
equivalent), and its own move/keep_durable/use_source rule -- following the
same shape already established for skills/courses/experience.

### connections

- Root-like but two-party (principle 1 applies per column, not per row):
  `connections.user_a_id`/`user_b_id` -- reassign whichever side equals the
  source login; the other side (a different, unrelated person) is never
  touched. No `keep_durable`/`use_source` duplicate concept applies in the
  usual sense -- a connection between the source login and person P, and an
  *existing* connection between the durable login and the same person P,
  are the same real-world relationship and should collapse to one row
  (`unique (user_a_id, user_b_id)` already enforces this at the DB level --
  the executor must catch the resulting conflict and treat it as "already
  connected, no-op" rather than erroring the whole transaction).
- `connection_requests`: `requester_id`/`recipient_id`, same independent-
  per-column reassignment. A `pending` request from/to the source login
  where the durable login already has a `pending` request with the exact
  same counterparty hits the same partial-unique-index conflict as above
  and needs the same no-op/reconcile handling, not a hard failure.
- `connection_invites`: covered under skills (has a `skill_id`), listed
  here only as a cross-reference.
- `skill_peer_ratings`/`skill_validation_requests`: covered under skills.

### xAPI

- `xapi_statements`: reassign `user_id` (principle 3 -- no separate FK
  concern, `xapi_statement_skills` already covered under skills).
- `xapi_launch_sessions`: never moved (principle 6).

### manager sharing

- No transfer rule at all (principle 7). `manager_team_memberships` and
  everything gated through it stay with the source login.

### employer sharing

- `employer_data_access_requests`: reassign `learner_id` (this is
  learner-owned consent state, unlike `employer_members` -- the learner
  explicitly approved/declined this specific employer's data-access
  request, and that consent record belongs to them, not to a membership
  row). Do not reassign `requested_by` (the employer admin who asked --
  audit column, principle 2).
- `employer_data_access_shared_skills`: FK to `request_id` only, no owning
  column -- no change needed (principle 3), consistent since its parent
  request *is* being reassigned.
- `employer_skill_suggestions`: reassign `learner_id`. Do not reassign
  `assigned_by` (employer admin, audit column).
- `course_assignments`: reassign `assigned_to`. Do not reassign
  `assigned_by`.
- `employer_role_profiles`/`_skills`/`_training`/`employer_role_
  assignments`: no transfer rule (principle 7 -- gated through `employer_
  members`).

### linked-workspace-access grant itself

- `linked_workspace_access_requests` and `workspace_access` rows created by
  the "grant controlled cross-account access" phase are about the *link
  between the two verified accounts*, not learner content -- they are the
  mechanism a transfer plan is built through, not something a transfer plan
  should ever move or reassign. No rule needed; explicitly out of scope.

## Sequencing and transaction requirements (elaborates handoff §3, not yet built)

1. All of the above executes in one transaction per plan, in a fixed table
   order (roots before their dependents; a dependent must never be
   processed before the row it references has already been reassigned, or
   the reassignment becomes unobservable to a same-transaction consistency
   check).
2. Every `keep_durable`/`use_source` retirement runs *after* every `move`
   in the same plan, so a `move` never accidentally references a row a
   same-plan retirement is about to delete.
3. The two connections/connection_requests conflict cases above (principle
   under "connections") need an explicit "already exists, skip" branch per
   row, not a blanket `on conflict do nothing` that could silently swallow
   a real bug elsewhere in the same statement.

## Decisions (resolved 2026-09-04)

These were open questions in the first draft of this document; the project
owner decided all three the same session it was written.

1. **Cross-profile `parent_experience_id`: always group parent with
   children.** A parent experience and every child whose `parent_
   experience_id` points at it are one atomic sub-decision in the plan
   generator -- they always share the same action (`move` together,
   `keep_durable` together, `use_source` together). The plan generator must
   refuse to let them diverge rather than allow a cross-profile self-
   reference or a silent null-out. This replaces the divergence-allowed
   option entirely; there is no execution-time null-out path to implement.
2. **`keep_durable`/`use_source` refuses when exclusive dependents exist;
   forces a renamed `move` instead.** If a source skill/course/experience
   item has any exclusive dependent (assessment evidence, a validation
   request, a completed course assessment, etc. -- the same list principle
   4 already names), `keep_durable` and `use_source` are not offered as
   resolutions for that item at all. The only legal resolution is `move`,
   with the source record's name suffixed/de-duplicated so it coexists
   with the durable profile's same-named record rather than merging into
   it. This means some transfers end up with duplicate-looking records the
   learner can manually clean up afterward, which is the accepted
   trade-off for never silently discarding evidence -- no re-parenting UI
   is being built for this. `create_profile_transfer_plan`'s conflict
   detection needs to compute "has exclusive dependents" per source item
   and pass that through to `resolve_profile_transfer_plan_item`, which
   must reject `keep_durable`/`use_source` for any item where it's true.
3. **Plan-item preview support for connections/xAPI/employer/manager
   domains must be built before the executor acts on them.** This is a new
   prerequisite item between this document and the executor (§3) --
   `profile_transfer_plan_items.domain` needs the new domain values, `create_
   profile_transfer_plan` needs matching item-generation queries for each
   (duplicate detection where it applies, e.g. connections' existing-
   relationship collapse; pure inventory listing where "duplicate" doesn't
   apply, e.g. xAPI statements), and the review UI
   (`src/pages/account-linking/transfer-plan/`) needs to render them. The
   executor must not be extended to a domain before that domain has real
   plan-item preview coverage a learner can actually review and approve --
   matches `docs/account-portability.md` invariant 7 verbatim. Until this
   exists, the executor can only be built for skills/courses/experience
   (the three domains `profile_transfer_plan_items` already models), not
   the full table list in this document.
