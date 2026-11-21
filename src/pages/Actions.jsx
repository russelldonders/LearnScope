import { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePendingActions } from '../context/PendingActionsContext'
import { useLanguage } from '../context/LanguageContext'
import AppHeader from '../components/AppHeader'
import { respondToConnectionRequest } from '../lib/skillDiscovery'
import { decideOrgInvite } from '../lib/organisationInvites'
import { decideEmployerInvite, decideEmployerDataAccessRequest } from '../lib/admin/employers'
import { respondToCourseAssignment, listCourseCohorts, respondToCourseAssignmentWithCohort } from '../lib/courseCatalogue'
import { adoptManagerSkillSuggestion, dismissManagerSkillSuggestion } from '../lib/managerSkillActions'
import EmployerDataAccessConsentDialog from '../components/EmployerDataAccessConsentDialog'
import CohortPickerModal from '../components/CohortPickerModal'
import { decideManagerTeamInvite } from '../lib/managerTeams'
import { respondToPlanInvitation } from '../lib/learnerPlans'
import { PlanInvitationsSection, ConnectionRequestsSection, SkillAccessRequestsSection, ProviderInvitationsSection, EmployerInvitationsSection, ManagerTeamInvitationsSection } from './actions/ActionInvitationSections'
import { RateInvitesSection, RecommendInvitesSection, ValidationRequestsSection, RatingsReceivedSection } from './actions/ActionLinkSections'
import { DataAccessRequestsSection, AssignedTrainingSection, AssignedPlansSection } from './actions/ActionAssignmentSections'
import SkillSuggestionsSection from './actions/SkillSuggestionsSection'
import { useActionsData } from './useActionsData'

// Everything actually waiting on this learner to act -- the same sources
// PendingActionsContext counts for the header badge, just rendered in full
// here instead of as a number. Deliberately separate from Connections.jsx,
// which is about the learner's network/history, not open requests. Ratings
// received are the one purely informational section (nothing to accept/
// decline) -- shown here anyway since the bell is the notification surface
// a learner already checks; loading them here is also what marks them seen
// (see markPeerRatingsSeen below), clearing the bell.
export default function Actions() {
  const location = useLocation()
  const { user, employerMemberships, refreshOrganisationMemberships, refreshEmployerMemberships } = useAuth()
  const { refreshPendingActionCount } = usePendingActions()
  const { t } = useLanguage()
  const [searchParams] = useSearchParams()
  const orgSlug = searchParams.get('org')
  const {
    workspaceContext,
    loading,
    error,
    incomingRateInvites,
    incomingRecommendInvites,
    unseenRatings,
    validationRequests,
    incomingRequests,
    setIncomingRequests,
    orgInvites,
    setOrgInvites,
    employerInvites,
    setEmployerInvites,
    managerTeamInvites,
    setManagerTeamInvites,
    dataAccessRequests,
    setDataAccessRequests,
    mySkills,
    courseAssignments,
    setCourseAssignments,
    planAssignments,
    setPlanAssignments,
    skillSuggestions,
    setSkillSuggestions,
    profiles,
    planInvites,
    setPlanInvites,
    load,
  } = useActionsData(user, employerMemberships, orgSlug, refreshPendingActionCount)
  const [orgInviteDecidingId, setOrgInviteDecidingId] = useState(null)
  const [orgInviteError, setOrgInviteError] = useState(null)
  const [employerInviteDecidingId, setEmployerInviteDecidingId] = useState(null)
  const [employerInviteError, setEmployerInviteError] = useState(null)
  const [managerInviteDecidingId, setManagerInviteDecidingId] = useState(null)
  const [managerInviteError, setManagerInviteError] = useState(null)
  const [dataAccessDecidingId, setDataAccessDecidingId] = useState(null)
  const [dataAccessError, setDataAccessError] = useState(null)
  const [acceptingDataAccessRequest, setAcceptingDataAccessRequest] = useState(null)
  const [assignmentActingId, setAssignmentActingId] = useState(null)
  const [assignmentError, setAssignmentError] = useState(null)
  // Set once an assigned course with at least one cohort is about to be
  // started -- mirrors CourseCatalogue.jsx/ProviderProfile.jsx's own
  // cohortPicker state.
  const [cohortPicker, setCohortPicker] = useState(null)
  const [cohortEnrolling, setCohortEnrolling] = useState(false)
  const [cohortError, setCohortError] = useState(null)
  const [adoptingSuggestion, setAdoptingSuggestion] = useState(null)
  const [adoptForm, setAdoptForm] = useState({ setTarget: false, targetLevel: 3, targetDate: '', comments: '' })
  const [suggestionActingId, setSuggestionActingId] = useState(null)
  const [suggestionError, setSuggestionError] = useState(null)
  const [respondingId, setRespondingId] = useState(null)
  const [respondError, setRespondError] = useState(null)
  const [planInviteDecidingId, setPlanInviteDecidingId] = useState(null)
  const [planInviteError, setPlanInviteError] = useState(null)
  const [acceptedPlan, setAcceptedPlan] = useState(null)

  useEffect(() => {
    if (loading || !location.hash) return
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' })
  }, [loading, location.hash])


  async function handleOrgInviteResponse(memberId, accept) {
    setOrgInviteError(null)
    setOrgInviteDecidingId(memberId)
    try {
      await decideOrgInvite(memberId, accept)
      setOrgInvites((prev) => prev.filter((i) => i.id !== memberId))
      refreshPendingActionCount()
      if (accept) refreshOrganisationMemberships()
    } catch (err) {
      setOrgInviteError({ id: memberId, message: err.message })
    } finally {
      setOrgInviteDecidingId(null)
    }
  }

  async function handleEmployerInviteResponse(memberId, accept) {
    setEmployerInviteError(null)
    setEmployerInviteDecidingId(memberId)
    try {
      await decideEmployerInvite(memberId, accept)
      setEmployerInvites((prev) => prev.filter((i) => i.id !== memberId))
      refreshPendingActionCount()
      // Accepting an 'admin' invite may have just granted org membership
      // too (decide_employer_invite's own upsert onto the employer's
      // attached provider org), so refresh both -- not just employer
      // memberships -- same reasoning as addEmployerMember's own eager
      // grant for the brand-new-account path.
      if (accept) {
        refreshEmployerMemberships()
        refreshOrganisationMemberships()
      }
    } catch (err) {
      setEmployerInviteError({ id: memberId, message: err.message })
    } finally {
      setEmployerInviteDecidingId(null)
    }
  }

  async function handleManagerTeamInviteResponse(membershipId, accept) {
    setManagerInviteError(null)
    setManagerInviteDecidingId(membershipId)
    try {
      await decideManagerTeamInvite(membershipId, accept)
      setManagerTeamInvites((current) => current.filter((invite) => invite.id !== membershipId))
      refreshPendingActionCount()
    } catch (err) {
      setManagerInviteError({ id: membershipId, message: err.message })
    } finally {
      setManagerInviteDecidingId(null)
    }
  }

  // Decline stays a simple, immediate action -- no skills are ever shared,
  // so there's nothing to choose. Accept instead opens ShareSkillsModal
  // (below) so the learner picks which specific skills this employer gets
  // to see, rather than granting blanket access to everything.
  async function handleDataAccessDecline(requestId) {
    setDataAccessError(null)
    setDataAccessDecidingId(requestId)
    try {
      await decideEmployerDataAccessRequest(requestId, false)
      setDataAccessRequests((prev) => prev.filter((r) => r.id !== requestId))
      refreshPendingActionCount()
    } catch (err) {
      setDataAccessError({ id: requestId, message: err.message })
    } finally {
      setDataAccessDecidingId(null)
    }
  }

  function handleOpenAcceptDataAccess(request) {
    setDataAccessError(null)
    setAcceptingDataAccessRequest(request)
  }

  // Any thrown error propagates to EmployerDataAccessConsentDialog, which shows it inline
  // and stays open (same pattern as its own save errors) rather than being
  // caught here.
  async function handleConfirmAcceptDataAccess(skillIds, categories) {
    const request = acceptingDataAccessRequest
    setDataAccessDecidingId(request.id)
    try {
      await decideEmployerDataAccessRequest(request.id, true, skillIds, categories)
      setDataAccessRequests((prev) => prev.filter((r) => r.id !== request.id))
      setAcceptingDataAccessRequest(null)
      refreshPendingActionCount()
    } finally {
      setDataAccessDecidingId(null)
    }
  }

  // "Start" mirrors CourseCatalogue.jsx's own handleEnrol UX -- no
  // navigation, no toast, just the card leaving the list once enrolled
  // (same as accepting an invite above), since respondToCourseAssignment
  // marks the row 'enrolled' and it no longer matches the 'assigned' filter
  // listMyCourseAssignments queries on. "Dismiss" behaves identically minus
  // the real enrolInCatalogueCourse call underneath.
  async function handleAssignmentResponse(assignment, enrol) {
    setAssignmentError(null)

    // "Start" on a course with any cohorts defined enrols via a specific
    // one instead of the plain enrolInCatalogueCourse path below -- purely
    // additive, same branching as CourseCatalogue.jsx/ProviderProfile.jsx's
    // own handleEnrol. "Dismiss" (enrol === false) never touches cohorts.
    if (enrol) {
      setAssignmentActingId(assignment.id)
      let cohorts
      try {
        cohorts = await listCourseCohorts(assignment.course_catalogue.id)
      } catch (err) {
        setAssignmentError({ id: assignment.id, message: err.message })
        setAssignmentActingId(null)
        return
      }
      setAssignmentActingId(null)
      if (cohorts.length > 0) {
        setCohortError(null)
        setCohortPicker({ assignment, cohorts })
        return
      }
    }

    setAssignmentActingId(assignment.id)
    try {
      await respondToCourseAssignment(user.id, assignment.id, { enrol, courseForEnrolment: assignment.course_catalogue })
      setCourseAssignments((prev) => prev.filter((a) => a.id !== assignment.id))
      refreshPendingActionCount()
    } catch (err) {
      setAssignmentError({ id: assignment.id, message: err.message })
    } finally {
      setAssignmentActingId(null)
    }
  }

  async function handleAssignmentCohortEnrol(cohortId) {
    const { assignment } = cohortPicker
    setCohortError(null)
    setCohortEnrolling(true)
    try {
      await respondToCourseAssignmentWithCohort(assignment.id, cohortId)
      setCourseAssignments((prev) => prev.filter((a) => a.id !== assignment.id))
      refreshPendingActionCount()
      setCohortPicker(null)
    } catch (err) {
      setCohortError(err.message)
    } finally {
      setCohortEnrolling(false)
    }
  }

  // "Add to my skills" opens an inline form pre-filled with the employer's
  // suggested level/date/comments (still fully editable before saving --
  // never silently applied as-is, see adoptForm's initial state below).
  // Choosing not to set a target at all is also valid (setTarget stays
  // false unless the employer suggested a level, matching this suggestion's
  // own optionality).
  function handleOpenAdoptForm(suggestion) {
    setSuggestionError(null)
    setAdoptingSuggestion(suggestion.id)
    setAdoptForm({
      setTarget: suggestion.suggestedTargetLevel != null,
      targetLevel: suggestion.suggestedTargetLevel ?? 3,
      targetDate: suggestion.targetDate ?? '',
      comments: suggestion.comments ?? '',
    })
  }

  function handleCancelAdopt() {
    setAdoptingSuggestion(null)
  }

  // Resolves-or-creates the real skills row and (only if the learner kept a
  // target) adds it as their own target -- never a silent copy of the
  // suggester's values, since adoptForm was already reviewed/edited above.
  async function handleAdoptSuggestion(suggestion) {
    if (adoptForm.setTarget && !adoptForm.targetDate) {
      setSuggestionError({ id: suggestion.id, message: 'Target date is required when setting a target level.' })
      return
    }
    setSuggestionError(null)
    setSuggestionActingId(suggestion.id)
    try {
      await adoptManagerSkillSuggestion(user.id, suggestion, {
        targetLevel: adoptForm.setTarget ? Number(adoptForm.targetLevel) : null,
        targetDate: adoptForm.setTarget ? adoptForm.targetDate : null,
        comments: adoptForm.setTarget ? adoptForm.comments : null,
      })
      setSkillSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id))
      setAdoptingSuggestion(null)
      refreshPendingActionCount()
    } catch (err) {
      setSuggestionError({ id: suggestion.id, message: err.message })
    } finally {
      setSuggestionActingId(null)
    }
  }

  async function handleDismissSuggestion(suggestion) {
    setSuggestionError(null)
    setSuggestionActingId(suggestion.id)
    try {
      await dismissManagerSkillSuggestion(suggestion)
      setSkillSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id))
      if (adoptingSuggestion === suggestion.id) setAdoptingSuggestion(null)
      refreshPendingActionCount()
    } catch (err) {
      setSuggestionError({ id: suggestion.id, message: err.message })
    } finally {
      setSuggestionActingId(null)
    }
  }

  async function handleRequestResponse(requestId, accept) {
    setRespondError(null)
    setRespondingId(requestId)
    try {
      await respondToConnectionRequest(requestId, accept)
      setIncomingRequests((prev) => prev.filter((r) => r.id !== requestId))
      refreshPendingActionCount()
    } catch (err) {
      setRespondError({ id: requestId, message: err.message })
    } finally {
      setRespondingId(null)
    }
  }

  async function handlePlanInviteResponse(invitation, accept) {
    setPlanInviteError(null)
    setPlanInviteDecidingId(invitation.id)
    try {
      const joinedPlanId = await respondToPlanInvitation(invitation.id, accept)
      setPlanInvites((current) => current.filter((item) => item.id !== invitation.id))
      if (accept && joinedPlanId) setAcceptedPlan({ id: joinedPlanId, title: invitation.plan_title })
      refreshPendingActionCount()
    } catch (err) {
      setPlanInviteError({ id: invitation.id, message: err.message })
    } finally {
      setPlanInviteDecidingId(null)
    }
  }

  const connectionRequests = incomingRequests.filter((r) => r.request_type !== 'skill_access')
  const skillAccessRequests = incomingRequests.filter((r) => r.request_type === 'skill_access')

  const actionableCount =
    incomingRateInvites.length +
    incomingRecommendInvites.length +
    incomingRequests.length +
    orgInvites.length +
    employerInvites.length +
    managerTeamInvites.length +
    dataAccessRequests.length +
    courseAssignments.length +
    planAssignments.length +
    skillSuggestions.length +
    planInvites.length +
    validationRequests.length

  const hasNothingPending =
    !loading &&
    !error &&
    !acceptedPlan &&
    actionableCount === 0 &&
    unseenRatings.length === 0

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader
        brandLogoUrl={workspaceContext?.branding?.logoUrl}
        brandName={workspaceContext?.branding?.name || workspaceContext?.employer?.name}
        brandHomeHref={workspaceContext ? `/organisation/learning?org=${encodeURIComponent(orgSlug)}` : '/dashboard'}
        notificationsHref={workspaceContext ? `/actions?org=${encodeURIComponent(orgSlug)}` : '/actions'}
      />

      <main id="main-content" tabIndex={-1} className="max-w-4xl mx-auto px-4 py-8 space-y-10">
        <div>
          {workspaceContext && (
            <Link
              to={`/organisation/learning?org=${encodeURIComponent(orgSlug)}`}
              className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-moss underline-offset-4 hover:underline"
            >
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m15 18-6-6 6-6" />
              </svg>
              Back to {workspaceContext.employer.name}
            </Link>
          )}
          <h1 className="font-display text-2xl text-ink">{t('actions.heading')}</h1>
          {workspaceContext && (
            <p className="mt-1 text-sm text-secondary">Across all your LearnScope workspaces</p>
          )}
          {!loading && !error && (actionableCount > 0 || unseenRatings.length > 0) && (
            <p className="text-sm text-secondary mt-1">
              {actionableCount > 0
                ? `${actionableCount} item${actionableCount === 1 ? '' : 's'} need${actionableCount === 1 ? 's' : ''} your response`
                : 'Nothing needs a response right now'}
              {unseenRatings.length > 0
                ? ` · ${unseenRatings.length} new rating${unseenRatings.length === 1 ? '' : 's'} received`
                : ''}
            </p>
          )}
        </div>

        {loading && <p className="text-secondary">Loading…</p>}
        {error && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <p>{error}</p>
            <button type="button" onClick={load} className="font-medium underline underline-offset-2 hover:no-underline">
              Try again
            </button>
          </div>
        )}

        {hasNothingPending && (
          <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary">Nothing needs your attention right now.</p>
          </div>
        )}

        {acceptedPlan && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-moss/30 bg-moss/5 px-4 py-3 text-sm">
            <p className="text-ink">{t('actions.planInviteAccepted', { title: acceptedPlan.title })}</p>
            <Link to={`/plans/${acceptedPlan.id}?mode=edit`} className="font-medium text-moss underline underline-offset-2 hover:no-underline">
              {t('actions.reviewPlan')}
            </Link>
          </div>
        )}

        {actionableCount > 0 && (
        <div className="space-y-10">

        {planInvites.length > 0 && (
          <PlanInvitationsSection
            handlePlanInviteResponse={handlePlanInviteResponse}
            planInviteDecidingId={planInviteDecidingId}
            planInviteError={planInviteError}
            planInvites={planInvites}
          />
        )}

        {incomingRateInvites.length > 0 && (
          <RateInvitesSection
            incomingRateInvites={incomingRateInvites}
          />
        )}

        {incomingRecommendInvites.length > 0 && (
          <RecommendInvitesSection
            incomingRecommendInvites={incomingRecommendInvites}
          />
        )}

        {connectionRequests.length > 0 && (
          <ConnectionRequestsSection
            connectionRequests={connectionRequests}
            handleRequestResponse={handleRequestResponse}
            profiles={profiles}
            respondError={respondError}
            respondingId={respondingId}
          />
        )}

        {skillAccessRequests.length > 0 && (
          <SkillAccessRequestsSection
            handleRequestResponse={handleRequestResponse}
            profiles={profiles}
            respondError={respondError}
            respondingId={respondingId}
            skillAccessRequests={skillAccessRequests}
          />
        )}

        {orgInvites.length > 0 && (
          <ProviderInvitationsSection
            handleOrgInviteResponse={handleOrgInviteResponse}
            orgInviteDecidingId={orgInviteDecidingId}
            orgInviteError={orgInviteError}
            orgInvites={orgInvites}
          />
        )}

        {employerInvites.length > 0 && (
          <EmployerInvitationsSection
            employerInviteDecidingId={employerInviteDecidingId}
            employerInviteError={employerInviteError}
            employerInvites={employerInvites}
            handleEmployerInviteResponse={handleEmployerInviteResponse}
          />
        )}

        {managerTeamInvites.length > 0 && (
          <ManagerTeamInvitationsSection
            handleManagerTeamInviteResponse={handleManagerTeamInviteResponse}
            managerInviteDecidingId={managerInviteDecidingId}
            managerInviteError={managerInviteError}
            managerTeamInvites={managerTeamInvites}
          />
        )}

        {dataAccessRequests.length > 0 && (
          <DataAccessRequestsSection
            dataAccessDecidingId={dataAccessDecidingId}
            dataAccessError={dataAccessError}
            dataAccessRequests={dataAccessRequests}
            handleDataAccessDecline={handleDataAccessDecline}
            handleOpenAcceptDataAccess={handleOpenAcceptDataAccess}
          />
        )}

        {courseAssignments.length > 0 && (
          <AssignedTrainingSection
            assignmentActingId={assignmentActingId}
            assignmentError={assignmentError}
            courseAssignments={courseAssignments}
            handleAssignmentResponse={handleAssignmentResponse}
          />
        )}

        {planAssignments.length > 0 && (
          <AssignedPlansSection
            planAssignments={planAssignments}
            setPlanAssignments={setPlanAssignments}
          />
        )}

        {skillSuggestions.length > 0 && (
          <SkillSuggestionsSection
            adoptForm={adoptForm}
            adoptingSuggestion={adoptingSuggestion}
            handleAdoptSuggestion={handleAdoptSuggestion}
            handleCancelAdopt={handleCancelAdopt}
            handleDismissSuggestion={handleDismissSuggestion}
            handleOpenAdoptForm={handleOpenAdoptForm}
            setAdoptForm={setAdoptForm}
            skillSuggestions={skillSuggestions}
            suggestionActingId={suggestionActingId}
            suggestionError={suggestionError}
          />
        )}

        {validationRequests.length > 0 && (
          <ValidationRequestsSection
            profiles={profiles}
            validationRequests={validationRequests}
          />
        )}
        </div>
        )}

        {unseenRatings.length > 0 && (
        <div className={actionableCount > 0 ? 'pt-10 border-t border-hairline' : ''}>
        <p className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-4">For your information</p>
          <RatingsReceivedSection
            unseenRatings={unseenRatings}
          />
        </div>
        )}
      </main>

      {acceptingDataAccessRequest && (
        <EmployerDataAccessConsentDialog
          request={acceptingDataAccessRequest}
          skills={mySkills}
          onConfirm={handleConfirmAcceptDataAccess}
          onClose={() => setAcceptingDataAccessRequest(null)}
        />
      )}

      {cohortPicker && (
        <CohortPickerModal
          courseName={cohortPicker.assignment.course_catalogue?.name}
          cohorts={cohortPicker.cohorts}
          enrolling={cohortEnrolling}
          error={cohortError}
          onEnrol={handleAssignmentCohortEnrol}
          onClose={() => setCohortPicker(null)}
        />
      )}
    </div>
  )
}
