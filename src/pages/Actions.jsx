import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePendingActions } from '../context/PendingActionsContext'
import AppHeader from '../components/AppHeader'
import { LEVELS, LEVEL_LABELS } from '../lib/levels'
import { listIncomingRateInvites, listIncomingRecommendInvites, getProfiles } from '../lib/connections'
import { listIncomingPendingValidationRequests } from '../lib/skillValidationRequests'
import { listIncomingConnectionRequests, respondToConnectionRequest } from '../lib/skillDiscovery'
import { listMyPendingOrgInvites, decideOrgInvite } from '../lib/organisationInvites'
import { listMyPendingEmployerInvites, decideEmployerInvite, listMyPendingDataAccessRequests, decideEmployerDataAccessRequest } from '../lib/admin/employers'
import {
  listMyCourseAssignments,
  respondToCourseAssignment,
  listCourseCohorts,
  respondToCourseAssignmentWithCohort,
} from '../lib/courseCatalogue'
import { listMySkillSuggestions, adoptSkillSuggestion, dismissSkillSuggestion } from '../lib/skillSuggestions'
import { supabase } from '../lib/supabaseClient'
import ShareSkillsModal from '../components/ShareSkillsModal'
import CohortPickerModal from '../components/CohortPickerModal'

// Everything actually waiting on this learner to act -- the same sources
// PendingActionsContext counts for the header badge, just rendered in full
// here instead of as a number. Deliberately separate from Connections.jsx,
// which is about the learner's network/history, not open requests.
export default function Actions() {
  const { user, refreshOrganisationMemberships, refreshEmployerMemberships } = useAuth()
  const { refreshPendingActionCount } = usePendingActions()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [incomingRateInvites, setIncomingRateInvites] = useState([])
  const [incomingRecommendInvites, setIncomingRecommendInvites] = useState([])
  const [validationRequests, setValidationRequests] = useState([])
  const [incomingRequests, setIncomingRequests] = useState([])
  const [orgInvites, setOrgInvites] = useState([])
  const [orgInviteDecidingId, setOrgInviteDecidingId] = useState(null)
  const [orgInviteError, setOrgInviteError] = useState(null)
  const [employerInvites, setEmployerInvites] = useState([])
  const [employerInviteDecidingId, setEmployerInviteDecidingId] = useState(null)
  const [employerInviteError, setEmployerInviteError] = useState(null)
  const [dataAccessRequests, setDataAccessRequests] = useState([])
  const [dataAccessDecidingId, setDataAccessDecidingId] = useState(null)
  const [dataAccessError, setDataAccessError] = useState(null)
  const [acceptingDataAccessRequest, setAcceptingDataAccessRequest] = useState(null)
  const [mySkills, setMySkills] = useState([])
  const [courseAssignments, setCourseAssignments] = useState([])
  const [assignmentActingId, setAssignmentActingId] = useState(null)
  const [assignmentError, setAssignmentError] = useState(null)
  // Set once an assigned course with at least one cohort is about to be
  // started -- mirrors CourseCatalogue.jsx/ProviderProfile.jsx's own
  // cohortPicker state.
  const [cohortPicker, setCohortPicker] = useState(null)
  const [cohortEnrolling, setCohortEnrolling] = useState(false)
  const [cohortError, setCohortError] = useState(null)
  const [skillSuggestions, setSkillSuggestions] = useState([])
  const [adoptingSuggestion, setAdoptingSuggestion] = useState(null)
  const [adoptForm, setAdoptForm] = useState({ setTarget: false, targetLevel: 3, targetDate: '', comments: '' })
  const [suggestionActingId, setSuggestionActingId] = useState(null)
  const [suggestionError, setSuggestionError] = useState(null)
  const [respondingId, setRespondingId] = useState(null)
  const [respondError, setRespondError] = useState(null)
  const [profiles, setProfiles] = useState({})

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [
        incomingRateInvitesData,
        incomingRecommendInvitesData,
        validationRequestsData,
        incomingRequestsData,
        orgInvitesData,
        employerInvitesData,
        dataAccessRequestsData,
        courseAssignmentsData,
        skillSuggestionsData,
        { data: mySkillsData, error: mySkillsError },
      ] = await Promise.all([
        listIncomingRateInvites(),
        listIncomingRecommendInvites(),
        listIncomingPendingValidationRequests(user.id),
        listIncomingConnectionRequests(user.id),
        listMyPendingOrgInvites(user.id),
        listMyPendingEmployerInvites(user.id),
        listMyPendingDataAccessRequests(user.id),
        listMyCourseAssignments(user.id),
        listMySkillSuggestions(user.id),
        supabase.from('skills').select('id, name').eq('user_id', user.id).order('name', { ascending: true }),
      ])
      if (mySkillsError) throw mySkillsError
      setIncomingRateInvites(incomingRateInvitesData)
      setIncomingRecommendInvites(incomingRecommendInvitesData)
      setValidationRequests(validationRequestsData)
      setIncomingRequests(incomingRequestsData)
      setOrgInvites(orgInvitesData)
      setEmployerInvites(employerInvitesData)
      setDataAccessRequests(dataAccessRequestsData)
      setCourseAssignments(courseAssignmentsData)
      setSkillSuggestions(skillSuggestionsData)
      setMySkills(mySkillsData ?? [])
      const requesterIds = validationRequestsData.map((r) => r.requester_id)
      const requestSenderIds = incomingRequestsData.map((r) => r.requester_id)
      setProfiles(await getProfiles([...requesterIds, ...requestSenderIds]))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

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

  // Any thrown error propagates to ShareSkillsModal, which shows it inline
  // and stays open (same pattern as its own save errors) rather than being
  // caught here.
  async function handleConfirmAcceptDataAccess(skillIds) {
    const request = acceptingDataAccessRequest
    setDataAccessDecidingId(request.id)
    try {
      await decideEmployerDataAccessRequest(request.id, true, skillIds)
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
      setTarget: suggestion.suggested_target_level != null,
      targetLevel: suggestion.suggested_target_level ?? 3,
      targetDate: suggestion.target_date ?? '',
      comments: suggestion.comments ?? '',
    })
  }

  function handleCancelAdopt() {
    setAdoptingSuggestion(null)
  }

  // Calls adoptSkillSuggestion, which resolves-or-creates the real skills
  // row via the existing, unchanged findOrCreatePersonalSkill, then (only
  // if the learner kept a target) inserts a skill_targets row shaped like
  // SetTargetModal's own -- never a silent copy of the employer's suggested
  // values, since adoptForm was already reviewed/edited above.
  async function handleAdoptSuggestion(suggestion) {
    if (adoptForm.setTarget && !adoptForm.targetDate) {
      setSuggestionError({ id: suggestion.id, message: 'Target date is required when setting a target level.' })
      return
    }
    setSuggestionError(null)
    setSuggestionActingId(suggestion.id)
    try {
      await adoptSkillSuggestion(user.id, suggestion, {
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
      await dismissSkillSuggestion(suggestion.id)
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

  const hasNothingPending =
    !loading &&
    incomingRateInvites.length === 0 &&
    incomingRecommendInvites.length === 0 &&
    incomingRequests.length === 0 &&
    orgInvites.length === 0 &&
    employerInvites.length === 0 &&
    dataAccessRequests.length === 0 &&
    courseAssignments.length === 0 &&
    skillSuggestions.length === 0 &&
    validationRequests.length === 0

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-10">
        <h1 className="font-display text-2xl text-ink">Actions</h1>

        {loading && <p className="text-secondary">Loading…</p>}
        {error && <p className="text-red-700 text-sm">{error}</p>}

        {hasNothingPending && (
          <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary">Nothing needs your attention right now.</p>
          </div>
        )}

        {incomingRateInvites.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">Invitations to rate</h2>
            <div className="space-y-3">
              {incomingRateInvites.map((invite) => (
                <Link
                  key={invite.id}
                  to={`/rate/${invite.share_code}`}
                  className="block bg-card border border-hairline rounded-lg p-4 hover:border-moss/60 transition-colors"
                >
                  <p className="text-sm text-ink">
                    <strong>{invite.inviter_name || 'Someone'}</strong> wants your rating on their skill:{' '}
                    <strong>{invite.skill_name}</strong>
                    {invite.skill_category ? ` (${invite.skill_category})` : ''}
                  </p>
                  <p className="font-mono text-xs text-secondary mt-0.5">
                    {new Date(invite.created_at).toLocaleDateString()}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}

        {incomingRecommendInvites.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">Skill recommendations</h2>
            <div className="space-y-3">
              {incomingRecommendInvites.map((invite) => (
                <Link
                  key={invite.id}
                  to={`/recommend/${invite.share_code}`}
                  className="block bg-card border border-hairline rounded-lg p-4 hover:border-moss/60 transition-colors"
                >
                  <p className="text-sm text-ink">
                    <strong>{invite.inviter_name || 'Someone'}</strong> recommends you start tracking:{' '}
                    <strong>{invite.skill_name}</strong>
                    {invite.skill_category ? ` (${invite.skill_category})` : ''}
                  </p>
                  <p className="font-mono text-xs text-secondary mt-0.5">
                    {new Date(invite.created_at).toLocaleDateString()}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}

        {incomingRequests.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">Connection requests</h2>
            <div className="space-y-3">
              {incomingRequests.map((request) => (
                <div key={request.id} className="bg-card border border-hairline rounded-lg p-4">
                  <p className="text-sm text-ink">
                    <strong>{profiles[request.requester_id]?.name || 'Someone'}</strong>
                    {request.skills?.name ? (
                      <>
                        {' '}wants to connect over <strong>{request.skills.name}</strong>
                      </>
                    ) : (
                      ' wants to connect'
                    )}
                  </p>
                  {request.message && <p className="text-sm text-secondary mt-1">{request.message}</p>}
                  <p className="font-mono text-xs text-secondary mt-1">
                    {new Date(request.created_at).toLocaleDateString()}
                  </p>
                  {respondError?.id === request.id && (
                    <p className="text-xs text-red-700 mt-1">{respondError.message}</p>
                  )}
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => handleRequestResponse(request.id, true)}
                      disabled={respondingId === request.id}
                      className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRequestResponse(request.id, false)}
                      disabled={respondingId === request.id}
                      className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {orgInvites.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">Provider invitations</h2>
            <div className="space-y-3">
              {orgInvites.map((invite) => (
                <div key={invite.id} className="bg-card border border-hairline rounded-lg p-4">
                  <p className="text-sm text-ink">
                    <strong>{invite.organisations?.name || 'A provider organisation'}</strong> wants to add you as{' '}
                    {invite.role === 'admin' ? 'an admin' : 'a trainer'}
                  </p>
                  <p className="font-mono text-xs text-secondary mt-1">
                    {new Date(invite.created_at).toLocaleDateString()}
                  </p>
                  {orgInviteError?.id === invite.id && (
                    <p className="text-xs text-red-700 mt-1">{orgInviteError.message}</p>
                  )}
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => handleOrgInviteResponse(invite.id, true)}
                      disabled={orgInviteDecidingId === invite.id}
                      className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOrgInviteResponse(invite.id, false)}
                      disabled={orgInviteDecidingId === invite.id}
                      className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {employerInvites.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">Employer invitations</h2>
            <div className="space-y-3">
              {employerInvites.map((invite) => (
                <div key={invite.id} className="bg-card border border-hairline rounded-lg p-4">
                  <p className="text-sm text-ink">
                    <strong>{invite.employers?.name || 'An employer'}</strong> wants to add you as{' '}
                    {invite.role === 'admin' ? 'an admin' : 'a member'}
                  </p>
                  <p className="font-mono text-xs text-secondary mt-1">
                    {new Date(invite.created_at).toLocaleDateString()}
                  </p>
                  {employerInviteError?.id === invite.id && (
                    <p className="text-xs text-red-700 mt-1">{employerInviteError.message}</p>
                  )}
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => handleEmployerInviteResponse(invite.id, true)}
                      disabled={employerInviteDecidingId === invite.id}
                      className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEmployerInviteResponse(invite.id, false)}
                      disabled={employerInviteDecidingId === invite.id}
                      className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {dataAccessRequests.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">Data access requests</h2>
            <div className="space-y-3">
              {dataAccessRequests.map((request) => (
                <div key={request.id} className="bg-card border border-hairline rounded-lg p-4">
                  <p className="text-sm text-ink">
                    <strong>{request.employers?.name || 'An employer'}</strong> would like access to view your
                    skills profile
                  </p>
                  <p className="font-mono text-xs text-secondary mt-1">
                    {new Date(request.created_at).toLocaleDateString()}
                  </p>
                  {dataAccessError?.id === request.id && (
                    <p className="text-xs text-red-700 mt-1">{dataAccessError.message}</p>
                  )}
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => handleOpenAcceptDataAccess(request)}
                      disabled={dataAccessDecidingId === request.id}
                      className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
                    >
                      Select which skills to share
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDataAccessDecline(request.id)}
                      disabled={dataAccessDecidingId === request.id}
                      className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {courseAssignments.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">Assigned training</h2>
            <div className="space-y-3">
              {courseAssignments.map((assignment) => (
                <div key={assignment.id} className="bg-card border border-hairline rounded-lg p-4">
                  <p className="text-sm text-ink">
                    <strong>{assignment.employers?.name || 'An employer'}</strong> assigned you a course:{' '}
                    <strong>{assignment.course_catalogue?.name}</strong>
                  </p>
                  <p className="font-mono text-xs text-secondary mt-1">
                    {new Date(assignment.created_at).toLocaleDateString()}
                  </p>
                  {assignmentError?.id === assignment.id && (
                    <p className="text-xs text-red-700 mt-1">{assignmentError.message}</p>
                  )}
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => handleAssignmentResponse(assignment, true)}
                      disabled={assignmentActingId === assignment.id}
                      className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
                    >
                      Start
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAssignmentResponse(assignment, false)}
                      disabled={assignmentActingId === assignment.id}
                      className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {skillSuggestions.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">Skill suggestions</h2>
            <div className="space-y-3">
              {skillSuggestions.map((suggestion) => (
                <div key={suggestion.id} className="bg-card border border-hairline rounded-lg p-4">
                  <p className="text-sm text-ink">
                    <strong>{suggestion.employers?.name || 'An employer'}</strong> suggested you develop:{' '}
                    <strong>{suggestion.skill_name}</strong>
                  </p>
                  {(suggestion.suggested_target_level || suggestion.target_date) && (
                    <p className="text-sm text-secondary mt-1">
                      {suggestion.suggested_target_level && `Suggested target: ${LEVEL_LABELS[suggestion.suggested_target_level]}`}
                      {suggestion.suggested_target_level && suggestion.target_date && ' by '}
                      {suggestion.target_date && new Date(`${suggestion.target_date}T00:00:00`).toLocaleDateString()}
                    </p>
                  )}
                  {suggestion.comments && <p className="text-sm text-secondary mt-1">{suggestion.comments}</p>}
                  <p className="font-mono text-xs text-secondary mt-1">
                    {new Date(suggestion.created_at).toLocaleDateString()}
                  </p>
                  {suggestionError?.id === suggestion.id && (
                    <p className="text-xs text-red-700 mt-1">{suggestionError.message}</p>
                  )}

                  {adoptingSuggestion === suggestion.id ? (
                    <div className="mt-3 pt-3 border-t border-hairline space-y-3">
                      <label className="flex items-center gap-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          checked={adoptForm.setTarget}
                          onChange={(e) => setAdoptForm((f) => ({ ...f, setTarget: e.target.checked }))}
                          className="size-4 accent-moss"
                        />
                        Also set a target
                      </label>
                      {adoptForm.setTarget && (
                        <div className="flex flex-wrap items-end gap-3">
                          <div>
                            <label className="block text-xs text-secondary mb-1" htmlFor={`adoptLevel-${suggestion.id}`}>
                              Target level
                            </label>
                            <select
                              id={`adoptLevel-${suggestion.id}`}
                              value={adoptForm.targetLevel}
                              onChange={(e) => setAdoptForm((f) => ({ ...f, targetLevel: e.target.value }))}
                              className="rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                            >
                              {LEVELS.map((l) => (
                                <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-secondary mb-1" htmlFor={`adoptDate-${suggestion.id}`}>
                              Achieve by
                            </label>
                            <input
                              id={`adoptDate-${suggestion.id}`}
                              type="date"
                              value={adoptForm.targetDate}
                              onChange={(e) => setAdoptForm((f) => ({ ...f, targetDate: e.target.value }))}
                              className="rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                            />
                          </div>
                          <div className="flex-1 min-w-[180px]">
                            <label className="block text-xs text-secondary mb-1" htmlFor={`adoptComments-${suggestion.id}`}>
                              Comments
                            </label>
                            <input
                              id={`adoptComments-${suggestion.id}`}
                              value={adoptForm.comments}
                              onChange={(e) => setAdoptForm((f) => ({ ...f, comments: e.target.value }))}
                              className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                            />
                          </div>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleAdoptSuggestion(suggestion)}
                          disabled={suggestionActingId === suggestion.id}
                          className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
                        >
                          {suggestionActingId === suggestion.id ? 'Saving…' : 'Confirm and add'}
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelAdopt}
                          disabled={suggestionActingId === suggestion.id}
                          className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mt-3">
                      <button
                        type="button"
                        onClick={() => handleOpenAdoptForm(suggestion)}
                        disabled={suggestionActingId === suggestion.id}
                        className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
                      >
                        Add to my skills
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDismissSuggestion(suggestion)}
                        disabled={suggestionActingId === suggestion.id}
                        className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {validationRequests.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">Requests to validate</h2>
            <div className="space-y-3">
              {validationRequests.map((request) => (
                <Link
                  key={request.id}
                  to={`/validate-request/${request.id}`}
                  className="block bg-card border border-hairline rounded-lg p-4 hover:border-moss/60 transition-colors"
                >
                  <p className="text-sm text-ink">
                    <strong>{profiles[request.requester_id]?.name || 'Someone'}</strong> asked you to confirm{' '}
                    they've reached <strong>{LEVEL_LABELS[request.target_level]}</strong> on{' '}
                    <strong>{request.skills?.name}</strong>
                  </p>
                  <p className="font-mono text-xs text-secondary mt-0.5">
                    {new Date(request.created_at).toLocaleDateString()}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}
      </main>

      {acceptingDataAccessRequest && (
        <ShareSkillsModal
          skills={mySkills}
          initiallySelectedIds={[]}
          title="Choose skills to share"
          description={`Pick which of your skills ${acceptingDataAccessRequest.employers?.name || 'this employer'} can see. You can change this any time from Privacy settings.`}
          confirmLabel="Accept and share"
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
