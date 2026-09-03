// Feature-local sample data for the verified account-linking UI
// (CreateLinkInvitationForm, LinkInvitationSuccess, RedeemInvitationPanel,
// LinkedAccountsList, AccountLinkingSection). Optional default prop values
// for an isolated/demo render only -- not imported by anything outside
// src/pages/account-linking/, and never substituted back in after a real
// callback fires (see AccountLinkingSection's own top-of-file note).

// `url` is the ready-to-copy one-time link -- built by the real caller
// (token + origin + route), never constructed by these presentational
// components themselves.
export const FIXTURE_ACTIVE_INVITATION = {
  id: 'invitation-1',
  invitedEmail: 'me.personal@example.com',
  url: 'https://learnscope.example/account-linking/redeem?token=a1b2c3d4e5f6',
  expiresAt: '2026-09-08T10:00:00Z',
}

// `direction` records which side of the exchange this account is on:
// 'sent' -- the current user invited it; 'received' -- it invited the
// current user. Both are equally "verified" once linked; direction is
// just how the link came to exist, shown as the list's "Type" column.
export const FIXTURE_LINKED_ACCOUNTS = [
  { id: 'link-1', email: 'me.personal@example.com', direction: 'sent', verifiedAt: '2026-08-15', status: 'active' },
  { id: 'link-2', email: 'me.work@example.com', direction: 'received', verifiedAt: '2026-06-02', status: 'active' },
]

export const FIXTURE_REDEEM_TOKEN = 'a1b2c3d4e5f6'

export const FIXTURE_INVITATION_PREVIEW = { inviterEmail: 'russell@example.com' }
