import { useEffect, useState } from 'react'
import { listMyPlanAssignments } from '../lib/organisationPlans'
import { listIncomingRateInvites, listIncomingRecommendInvites, listUnseenPeerRatings, markPeerRatingsSeen, getProfiles } from '../lib/connections'
import { listIncomingPendingValidationRequests } from '../lib/skillValidationRequests'
import { listIncomingConnectionRequests } from '../lib/skillDiscovery'
import { listMyPendingOrgInvites } from '../lib/organisationInvites'
import { listMyPendingEmployerInvites, listMyPendingDataAccessRequests } from '../lib/admin/employers'
import { listMyCourseAssignments } from '../lib/courseCatalogue'
import { listMyManagerSkillSuggestions } from '../lib/managerSkillActions'
import { supabase } from '../lib/supabaseClient'
import { listMyManagerTeamInvites } from '../lib/managerTeams'
import { loadActionSources } from '../lib/actionLoading'
import { getEmployerLoginContext } from '../lib/employerRoleProfiles'
import { listIncomingPlanInvitations } from '../lib/learnerPlans'

// Everything waiting on the learner, loaded together for the Actions page
// (a source that fails leaves its fallback and an error naming it), plus the
// employer workspace whose branding the page wears when opened from one
// (?org=). load() and the setters are returned so the page can reload, or
// drop an item once it has been answered.
export function useActionsData(user, employerMemberships, orgSlug, refreshPendingActionCount) {
  const [workspaceContext, setWorkspaceContext] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [incomingRateInvites, setIncomingRateInvites] = useState([])
  const [incomingRecommendInvites, setIncomingRecommendInvites] = useState([])
  const [unseenRatings, setUnseenRatings] = useState([])
  const [validationRequests, setValidationRequests] = useState([])
  const [incomingRequests, setIncomingRequests] = useState([])
  const [orgInvites, setOrgInvites] = useState([])
  const [employerInvites, setEmployerInvites] = useState([])
  const [managerTeamInvites, setManagerTeamInvites] = useState([])
  const [dataAccessRequests, setDataAccessRequests] = useState([])
  const [mySkills, setMySkills] = useState([])
  const [courseAssignments, setCourseAssignments] = useState([])
  const [planAssignments, setPlanAssignments] = useState([])
  const [skillSuggestions, setSkillSuggestions] = useState([])
  const [profiles, setProfiles] = useState({})
  const [planInvites, setPlanInvites] = useState([])

  useEffect(() => {
    let cancelled = false
    if (!orgSlug || employerMemberships === null) {
      setWorkspaceContext(null)
      return () => { cancelled = true }
    }

    getEmployerLoginContext(orgSlug).then((employer) => {
      if (cancelled) return
      const isMember = employer && employerMemberships.some((membership) => membership.employer_id === employer.id)
      setWorkspaceContext(isMember ? { employer, branding: employer.branding ?? null } : null)
    }).catch(() => {
      if (!cancelled) setWorkspaceContext(null)
    })

    return () => { cancelled = true }
  }, [employerMemberships, orgSlug])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the listed values change; the loaders are recreated every render
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const { values, failures } = await loadActionSources([
        { key: 'rateInvites', label: 'rating invitations', fallback: [], load: listIncomingRateInvites },
        { key: 'recommendInvites', label: 'skill recommendations', fallback: [], load: listIncomingRecommendInvites },
        { key: 'unseenRatings', label: 'ratings received', fallback: [], load: () => listUnseenPeerRatings(user.id) },
        { key: 'validationRequests', label: 'validation requests', fallback: [], load: () => listIncomingPendingValidationRequests(user.id) },
        { key: 'connectionRequests', label: 'connection requests', fallback: [], load: () => listIncomingConnectionRequests(user.id) },
        { key: 'organisationInvites', label: 'organisation invitations', fallback: [], load: () => listMyPendingOrgInvites(user.id) },
        { key: 'employerInvites', label: 'employer invitations', fallback: [], load: () => listMyPendingEmployerInvites(user.id) },
        { key: 'managerInvites', label: 'manager-team invitations', fallback: [], load: listMyManagerTeamInvites },
        { key: 'dataAccessRequests', label: 'employer data-access requests', fallback: [], load: () => listMyPendingDataAccessRequests(user.id) },
        { key: 'courseAssignments', label: 'course assignments', fallback: [], load: () => listMyCourseAssignments(user.id) },
        { key: 'planAssignments', label: 'assigned plans', fallback: [], load: async () => (await listMyPlanAssignments()).filter((a) => a.status === 'assigned') },
        { key: 'skillSuggestions', label: 'skill suggestions', fallback: [], load: () => listMyManagerSkillSuggestions(user.id) },
        { key: 'planInvites', label: 'plan invitations', fallback: [], load: listIncomingPlanInvitations },
        {
          key: 'skills',
          label: 'skills available to share',
          fallback: [],
          load: async () => {
            const { data, error: skillsError } = await supabase
              .from('skills')
              .select('id, name, library_skill_id')
              .eq('user_id', user.id)
              .order('name', { ascending: true })
            if (skillsError) throw skillsError
            return data ?? []
          },
        },
      ])
      const incomingRateInvitesData = values.rateInvites
      const incomingRecommendInvitesData = values.recommendInvites
      const validationRequestsData = values.validationRequests
      const incomingRequestsData = values.connectionRequests
      const orgInvitesData = values.organisationInvites
      const employerInvitesData = values.employerInvites
      const managerTeamInvitesData = values.managerInvites
      const dataAccessRequestsData = values.dataAccessRequests
      const courseAssignmentsData = values.courseAssignments
      // Suggestions from an organisation and from a team leader arrive as one
      // list (manager_skill_suggestions), already newest first and labelled
      // with where each came from.
      const skillSuggestionsData = values.skillSuggestions
      setIncomingRateInvites(incomingRateInvitesData)
      setIncomingRecommendInvites(incomingRecommendInvitesData)
      setValidationRequests(validationRequestsData)
      setIncomingRequests(incomingRequestsData)
      setOrgInvites(orgInvitesData)
      setEmployerInvites(employerInvitesData)
      setManagerTeamInvites(managerTeamInvitesData)
      setDataAccessRequests(dataAccessRequestsData)
      setCourseAssignments(courseAssignmentsData)
      setPlanAssignments(values.planAssignments)
      setSkillSuggestions(skillSuggestionsData)
      setMySkills(values.skills)
      setUnseenRatings(values.unseenRatings)
      setPlanInvites(values.planInvites)
      if (failures.length > 0) {
        setError(`Some actions could not be loaded (${failures.map(({ label }) => label).join(', ')}). Other actions are shown below.`)
      }
      // Seeing them here is what clears the bell -- best-effort, since a
      // failure to mark seen just means the badge count stays put, not that
      // anything is lost (the ratings themselves stay visible either way).
      if (values.unseenRatings.length > 0) {
        markPeerRatingsSeen()
          .then(refreshPendingActionCount)
          .catch(() => {})
      }
      const requesterIds = validationRequestsData.map((r) => r.requester_id)
      const requestSenderIds = incomingRequestsData.map((r) => r.requester_id)
      try {
        setProfiles(await getProfiles([...requesterIds, ...requestSenderIds]))
      } catch {
        setProfiles({})
        setError((current) => current ?? 'Some profile names could not be loaded. Other actions are shown below.')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return {
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
  }
}
