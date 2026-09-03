# Multi-context LMS rollout

Status: implementation sequence and safety gates.

## 1. Foundation

- Add person, authentication-account, profile, workspace and workspace-access
  concepts.
- Backfill every existing user as a personal context without changing current
  learner behaviour.
- Add explicit workspace resolution and isolation tests.
- Do not migrate all learner domain tables in the same release.

Gate: existing learners retain identical ownership and access; cross-person and
cross-workspace RLS tests pass.

## 2. Organisation employee profiles

- Keep provider staff membership distinct from employee profiles.
- Add company-created work profiles and activation.
- Add department, manager and employment lifecycle.
- Support suspension and offboarding without affecting personal access.

Gate: organisation administrators can manage only their organisation's work
profiles; an employee relationship grants no provider-console role.

## 3. Role profiles and alignment

- Add versioned organisation role profiles and requirements.
- Add employee role assignments.
- Connect learner-controlled current roles through explicit role alignments.
- Add selected requirement responses and proposed updates.

Gate: neither side can mutate the other's authoritative role record.

## 4. Managed learning

- Add individual and group assignments, deadlines and course-version locking.
- Expose assignment-specific progress only.
- Offer eligible completions for learner-controlled personal import.

Gate: cancelling an assignment cannot delete a learner course or historical
completion.

## 5. Independent managers

- Add manager workspaces, consent-based teams, collaborative training and skill
  focuses.
- Limit managers to team-scoped activity.

Gate: a manager cannot enumerate or read non-team learner records.

## 6. Organisation transition

- Link a manager identity to an organisation separately from team ownership.
- Add affiliation, transfer proposals and member consent.
- Preserve provenance through mixed transition outcomes.

Gate: no independent membership becomes organisation-visible without the
required consent or a separate employer relationship.

## 7. Account continuity

- Add two-session personal/work account association.
- Add personal continuity setup, reauthentication and offboarding.
- Add portable-record review and audit notifications.

Gate: work SSO loss never removes a verified personal login or learner-owned
portable profile.

## 8. Automation

- Add pathways, recurring training, role-driven assignment, compliance views,
  SSO provisioning and later HRIS/SCIM integration.

This phase begins only after the ownership model is proven in production-like
tests.

## Migration discipline

Each database increment must be additive first, backfilled in a separately
reviewable step, protected by RLS, and tested against existing data. Destructive
cleanup of legacy ownership fields is a later release with an explicit rollback
plan. Migration history must be reconciled before the first schema change.

