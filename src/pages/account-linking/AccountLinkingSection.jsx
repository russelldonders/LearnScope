import CreateLinkInvitationForm from './CreateLinkInvitationForm'
import LinkInvitationSuccess from './LinkInvitationSuccess'
import LinkedAccountsList from './LinkedAccountsList'
import { FIXTURE_ACTIVE_INVITATION, FIXTURE_LINKED_ACCOUNTS } from './accountLinkingFixtures'

// Genuinely props-in/callbacks-out: composes the "create/success" and
// "linked accounts list" pieces above but owns no business data itself --
// no invitation or linked-account list ever lives in local state here.
// Whether the success panel or the create form shows is driven entirely by
// `activeInvitation`; the caller is expected to set it after
// onCreateInvitation resolves and clear it after onDismissInvitation, not
// this component. FIXTURE_* imports are optional default props for an
// isolated render only, never substituted back in after a real callback.
//
// Deliberately excludes RedeemInvitationPanel -- that's rendered on its
// own dedicated page (the link the invited account opens), not alongside
// this account's own settings.
export default function AccountLinkingSection({
  activeInvitation = FIXTURE_ACTIVE_INVITATION,
  linkedAccounts = FIXTURE_LINKED_ACCOUNTS,
  creating = false,
  createError = null,
  revokingId = null,
  revokeError = null,
  onCreateInvitation,
  onDismissInvitation,
  onRevoke,
}) {
  return (
    <div className="space-y-6">
      {activeInvitation ? (
        <LinkInvitationSuccess invitation={activeInvitation} onDismiss={onDismissInvitation} />
      ) : (
        <CreateLinkInvitationForm creating={creating} error={createError} onCreateInvitation={onCreateInvitation} />
      )}

      <LinkedAccountsList linkedAccounts={linkedAccounts} revokingId={revokingId} error={revokeError} onRevoke={onRevoke} />
    </div>
  )
}
