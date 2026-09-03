# Person, authentication and workspaces

Status: proposed contract for the multi-context LMS programme.

## Decision

LearnScope separates a durable person, authentication accounts, workspaces and
profiles. A Supabase `auth.users` row authenticates a session; it is not the
long-term identity of the human and does not by itself determine access to all
of that human's profiles.

This is required because a learner may use a personal email login and one or
more employer SSO logins. In particular, SAML identities can remain separate
Supabase users. LearnScope associates those users at the application layer only
after control of both accounts has been proven.

## Concepts

- **Person**: a durable internal representation of one human. It is not an
  authorisation boundary and contains no organisation role.
- **Authentication account**: one Supabase user used to prove identity. It is
  classified as personal, work SSO or company-managed.
- **Workspace**: the access/navigation context in which an action takes place:
  personal, independent manager, employer, provider or platform administration.
  It sits above rather than replaces the distinct `employers` and
  `organisations` domain entities.
- **Profile**: skills, experience and learning records owned within a personal
  or organisation context.
- **Workspace access**: the explicit relationship authorising an authentication
  account to enter a workspace in a specified role.

One person can have many authentication accounts, profiles and workspace
memberships. Linking authentication accounts proves they belong to the same
person; it never grants profile sharing automatically.

## Session rule

The authentication account used for the current session limits the workspaces
that can be entered. A work SSO session must not open the personal workspace
without personal reauthentication, even when both accounts map to the same
person. Organisations may also require work SSO before company-manager or LMS
administration actions.

Workspace identity must be explicit in application state and visible in the
interface. A client-supplied workspace ID is never sufficient authorisation;
every query and mutation must validate active workspace access in the database.

## Initial compatibility strategy

Every existing authenticated user is backfilled as:

1. one person;
2. one personal authentication account;
3. one personal profile; and
4. one personal workspace with owner access.

Existing domain rows continue to use their current `user_id` during the first
foundation release. The new profile layer initially resolves the legacy user
through the personal authentication account. Domain tables move to profile
ownership incrementally, with explicit compatibility checks, rather than in a
single destructive migration.

## Account-linking protocol

Account association requires two authenticated sessions:

1. the first account creates a short-lived, single-use linking request;
2. the person authenticates with the second account;
3. the server checks both accounts are active and not linked to conflicting
   people;
4. the person confirms the displayed accounts and consequences; and
5. one transaction associates the accounts and consumes the request.

Names, email similarity and administrator assertion are insufficient evidence.
Email is contact data, not an identity key.

## Continuity

Work-only learners are encouraged to establish a verified personal login early.
The employer can see only whether continuity is configured, not the personal
address. Offboarding revokes organisation workspace access and the work login;
it does not delete the person, personal profile or portable records already
accepted into it.
