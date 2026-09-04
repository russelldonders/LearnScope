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
  `parent_experience_id` is self-referential on `experience` itself -- no
  separate reassignment needed; a moved parent and a moved child both carry
  their own `user_id` reassignment independently since both are `experience`
  rows in the same plan item set (or, if only the parent moves and the
  child doesn't, the self-reference now points across profiles, which
  Open question 1 below flags as a case needing an explicit rule, not a
  silent allow).
- `employer_role_assignments.learner_experience_id`: set by the learner
  themselves via `decide_employer_role_assignment`, but the *assignment
  row* is out of scope per principle 7 (gated through `employer_members`).
  If the linked `experience` row moves, this FK still resolves to the same
  experience id (principle 3), now owned by the durable login -- consistent,
  requires no change, but is a cross-domain edge case worth flagging (see
  Open questions).
- `keep_durable`/`use_source`: retire/promote the experience plus its
  exclusive dependents. A source experience with children whose
  `parent_experience_id` points at it, where those children are *not*
  independently in the plan as `move`, is the same cross-profile self-
  reference problem noted above -- must be resolved before `keep_durable`/
  `use_source` can run for that item, not silently orphaned or
  cross-profile-linked.

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

## Open questions (need a decision before the executor can be built)

1. **Cross-profile `parent_experience_id`** (experience section above): if
   a parent experience moves/retires but a child does not (or vice versa),
   what happens? Options: (a) require the plan generator to always group a
   parent with all its children as one atomic sub-decision, never letting
   them diverge; (b) allow divergence and null out `parent_experience_id`
   across profiles at execution time, with a plan-time warning. This
   document does not pick one -- it needs a product decision, not an
   engineering default.
2. **`keep_durable`/`use_source` when the source side has exclusive
   dependents the durable side lacks** (e.g. a source skill with assessment
   evidence, being discarded because the durable profile already has a
   same-named skill): principle 4 says this can't happen silently, but the
   current plan UI (`docs/claude-account-portability-handoff.md`'s
   "Immutable transfer-plan review" phase) has no re-parenting interaction
   for "move this evidence onto the durable skill instead of losing it."
   That UI needs to exist before `keep_durable`/`use_source` can be a safe
   default anywhere dependents exist, or the executor needs to refuse the
   action and force `move`-with-rename instead.
3. **Connections/xAPI/employer/manager domains have no plan-item UI yet**
   (this document only defines their execution rule, not their preview/
   conflict-resolution UI, which does not exist). Building the executor
   for these domains before that UI exists means the mutual-approval
   review a learner sees before executing would not actually show what's
   about to happen to their connections or xAPI history -- a gap against
   `docs/account-portability.md` invariant 7 ("Any future profile transfer
   must show a conflict preview").
