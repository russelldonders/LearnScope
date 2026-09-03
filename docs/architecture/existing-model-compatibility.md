# Compatibility with the current employer model

Status: migration constraints discovered from the current staging schema.

The current product already has employer membership, course assignment,
cohorts, learner-approved employer skill access and public profile share links.
The multi-context programme extends these concepts; it must not introduce a
parallel LMS domain.

## Existing concepts to retain

- `employers` remains the private company/LMS tenant.
- `employer_members` remains the employment/LMS roster relationship.
- `organisation_members` remains provider-authoring staff and is not reused for
  ordinary employees.
- `course_assignments` remains the employer-to-learner assignment lifecycle.
- course cohorts remain the delivery/scheduling concept and are not replaced by
  manager teams.
- `employer_data_access_requests` remains the current learner-consent path and
  is evolved toward profile-aware grants.
- `profile_share_links` remains public, token-based profile sharing. It is not
  used for authenticated employer or manager access.

## Required evolution

### Profiles and authentication

Today `profiles.id`, `employer_members.user_id`, assignment recipients and most
learner-owned records all point directly at `auth.users.id`. Add the person and
workspace layer alongside those keys first. Do not replace all foreign keys in
one migration.

Every existing auth user receives a personal person/workspace mapping. Existing
queries continue to operate through `user_id`. New work-only identities can
then be distinguished from personal identities before profile-aware foreign
keys are introduced.

### Employer membership

Evolve `employer_members` to reference an employer work profile while retaining
the current `user_id` during compatibility rollout. This permits a company to
create an employee profile before activation and later attach a company login.
It also prevents an employer membership from being mistaken for ownership of a
personal profile.

### Assignments

Evolve `course_assignments` from `assigned_to auth.users` to an employer work
profile recipient. Keep its current learner-accepts-before-personal-enrolment
behaviour. A separate, accepted portability association can connect completed
work learning to a personal course record.

### Employer data access

The existing skill-sharing request is the first directional sharing grant. It
should become profile-aware and scope-aware rather than being replaced. During
transition, shared skill IDs continue to refer only to records owned by the
legacy personal `user_id`.

### Manager teams

Independent manager teams are a new collaboration domain because they are
neither employer membership nor course cohorts. They may reference the existing
connection system for invitations and the existing course enrolment/content
domain for learning, but visibility is restricted to explicit team activity.

## Additive migration sequence

1. Add person, auth-account and workspace mappings and backfill current users.
2. Add application services that resolve the current personal workspace while
   leaving existing page queries unchanged.
3. Add employer work profiles and associate existing `employer_members` rows.
4. Add profile-aware recipient keys beside legacy assignment/access keys and
   dual-read during migration.
5. Move one domain at a time from direct auth ownership to profile ownership.
6. Remove legacy keys only after production data, RLS and rollback checks prove
   the new path complete.

No step silently reclassifies current personal records as employer-owned.

