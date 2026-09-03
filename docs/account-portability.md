# Account portability model

LearnScope treats a person, an authentication account, a learning profile,
and a workspace as different concepts. This is required because a learner may
use a company-controlled SSO account and a separately controlled personal
account at the same time.

Supabase Auth identity linking is useful for compatible OAuth identities, but
SAML SSO identities cannot use that mechanism. LearnScope therefore verifies
control of separate authentication accounts at the application layer.

## Terms

- **Verified accounts**: two separately authenticated accounts have completed
  a short-lived, email-bound challenge. Verification establishes common
  control only.
- **Linked profiles**: an explicit relationship allows narrowly defined data
  to move or be shown between two profiles. Account verification does not
  create this relationship automatically.
- **Shared data**: a revocable allow-list of skills, evidence, training, or
  other records made visible across a relationship. Sharing is not ownership
  transfer.
- **Transferred profile**: the learner has deliberately selected one personal
  profile as the durable profile and completed a separately confirmed data
  migration. Transfer is not part of account verification.
- **Disconnected account**: an authentication relationship has been revoked.
  Disconnection removes future access; it does not delete either profile or
  its historical records.

## Invariants

1. Employer membership never proves personal-account ownership.
2. Sending an invitation never grants access. The invited, verified email must
   redeem it while authenticated.
3. Tokens are single-use, expire after 30 minutes, and are stored only as
   hashes. Generated URLs keep tokens in the fragment so browsers do not send
   them to the web server in the request URL.
4. Verification does not merge people, reassign `user_id` records, grant a
   workspace, or expose private learner data.
5. Employer-created training and role requirements retain their employer
   provenance even if a learner later includes their outcomes in a personal
   profile.
6. Leaving an employer revokes employer workspace access but cannot revoke the
   learner's personal login or delete learner-owned records.
7. Any future profile transfer must show a conflict preview, be idempotent,
   preserve source provenance, and keep a durable audit record.

## Delivery phases

### 1. Verify account control

Implemented by `account_link_invitations` and `verified_account_links`. This is
safe to ship independently because it changes no existing learner ownership.

### 2. Choose the durable personal profile

After verification, show both profiles and their record counts. The learner
chooses the personal profile that will remain durable. No automatic choice is
made from email domain or login provider.

### 3. Preview and execute transfer

Build a server-side, transactional transfer plan for each learner-owned
domain. Duplicate skills, courses, connections, evidence, and experience links
need domain-specific conflict rules; they must not be handled by a blanket UUID
replacement.

### 4. Grant controlled cross-account access

Once ownership migration and RLS are ready, both verified accounts may receive
explicit workspace access. Work-account access remains independently
revocable, while the personal account remains the recovery path.

### 5. Employer departure

End employer membership and employer workspace access, retain completed
training provenance, revoke employer-only sharing, and confirm that the
personal account can still reach the durable profile before completing the
departure workflow.
