import {
  getProfiles,
  listIncomingRateInvites,
  listIncomingRecommendInvites,
  listUnseenPeerRatings,
} from './connections'
import { listIncomingConnectionRequests } from './skillDiscovery'
import { listIncomingPendingValidationRequests } from './skillValidationRequests'
import { listMyPendingOrgInvites } from './organisationInvites'
import { listMyPendingEmployerInvites, listMyPendingDataAccessRequests } from './admin/employers'
import { listMyCourseAssignments } from './courseCatalogue'
import { listMyManagerSkillSuggestions } from './managerSkillActions'
import { listMyManagerTeamInvites } from './managerTeams'
import { loadActionSources } from './actionLoading'

const personalSource = 'Personal'

function notification({ id, kind, title, detail, source = personalSource, occurredAt }) {
  return {
    id: `${kind}:${id}`,
    kind,
    title,
    detail,
    source,
    occurredAt,
  }
}

export function buildNotificationItems(values, profiles = {}) {
  const items = [
    ...values.rateInvites.map((item) => notification({
      id: item.id,
      kind: 'rate-invite',
      title: 'Rating Invitation',
      detail: `${item.inviter_name || 'Someone'} asked you to rate ${item.skill_name || 'a skill'}.`,
      occurredAt: item.created_at,
    })),
    ...values.recommendInvites.map((item) => notification({
      id: item.id,
      kind: 'recommend-invite',
      title: 'Skill Recommendation',
      detail: `${item.inviter_name || 'Someone'} recommended ${item.skill_name || 'a skill'}.`,
      occurredAt: item.created_at,
    })),
    ...values.unseenRatings.map((item) => notification({
      id: item.id,
      kind: 'rating',
      title: 'New Rating',
      detail: `${item.rater_name || 'Someone'} rated ${item.skill_name || 'one of your skills'}.`,
      occurredAt: item.rated_at,
    })),
    ...values.connectionRequests.map((item) => notification({
      id: item.id,
      kind: 'connection-request',
      title: 'Connection Request',
      detail: `${profiles[item.requester_id]?.name || 'Someone'} wants to connect${item.skills?.name ? ` about ${item.skills.name}` : ''}.`,
      occurredAt: item.created_at,
    })),
    ...values.validationRequests.map((item) => notification({
      id: item.id,
      kind: 'validation-request',
      title: 'Validation Request',
      detail: `${profiles[item.requester_id]?.name || 'Someone'} asked you to confirm ${item.skills?.name || 'a skill'}.`,
      occurredAt: item.created_at,
    })),
    ...values.orgInvites.map((item) => notification({
      id: item.id,
      kind: 'organisation-invite',
      title: 'Organisation Invitation',
      detail: `You were invited to join as ${item.role === 'admin' ? 'an admin' : 'a member'}.`,
      source: item.organisations?.name || 'Organisation',
      occurredAt: item.created_at,
    })),
    ...values.employerInvites.map((item) => notification({
      id: item.id,
      kind: 'employer-invite',
      title: 'Workspace Invitation',
      detail: `You were invited to join as ${item.role === 'admin' ? 'an admin' : 'a member'}.`,
      source: item.employers?.name || 'Employer',
      occurredAt: item.created_at,
    })),
    ...values.dataAccessRequests.map((item) => notification({
      id: item.id,
      kind: 'data-access-request',
      title: 'Data Access Request',
      detail: 'Review a request to share information from your profile.',
      source: item.employers?.name || 'Employer',
      occurredAt: item.created_at,
    })),
    ...values.courseAssignments.map((item) => notification({
      id: item.id,
      kind: 'course-assignment',
      title: 'Course Assigned',
      detail: item.course_catalogue?.name || 'A new course is ready for you.',
      source: item.employers?.name || item.course_catalogue?.provider || 'Learning',
      occurredAt: item.created_at,
    })),
    // One list for suggestions from an organisation and from a team leader
    // (manager_skill_suggestions), labelled with where each came from.
    ...values.skillSuggestions.map((item) => notification({
      id: item.id,
      kind: 'skill-suggestion',
      title: 'Skill Suggestion',
      detail: item.contextType === 'team'
        ? `${item.suggestedByName || 'A manager'} suggested ${item.skillName || 'a new skill'}.`
        : item.skillName || 'A new skill was suggested for you.',
      source: item.contextName || (item.contextType === 'team' ? 'Manager Team' : 'Employer'),
      occurredAt: item.createdAt,
    })),
    ...values.managerTeamInvites.map((item) => notification({
      id: item.id,
      kind: 'manager-team-invite',
      title: 'Team Invitation',
      detail: `${item.managerName || 'A manager'} invited you to join ${item.teamName || 'their team'}.`,
      source: item.teamName || 'Manager Team',
      occurredAt: item.invitedAt,
    })),
  ]

  return items.sort((a, b) => new Date(b.occurredAt || 0) - new Date(a.occurredAt || 0))
}

export async function loadNotifications(userId) {
  const { values, failures } = await loadActionSources([
    { key: 'rateInvites', label: 'rating invitations', fallback: [], load: listIncomingRateInvites },
    { key: 'recommendInvites', label: 'skill recommendations', fallback: [], load: listIncomingRecommendInvites },
    { key: 'unseenRatings', label: 'ratings received', fallback: [], load: () => listUnseenPeerRatings(userId) },
    { key: 'connectionRequests', label: 'connection requests', fallback: [], load: () => listIncomingConnectionRequests(userId) },
    { key: 'validationRequests', label: 'validation requests', fallback: [], load: () => listIncomingPendingValidationRequests(userId) },
    { key: 'orgInvites', label: 'organisation invitations', fallback: [], load: () => listMyPendingOrgInvites(userId) },
    { key: 'employerInvites', label: 'employer invitations', fallback: [], load: () => listMyPendingEmployerInvites(userId) },
    { key: 'dataAccessRequests', label: 'data-access requests', fallback: [], load: () => listMyPendingDataAccessRequests(userId) },
    { key: 'courseAssignments', label: 'course assignments', fallback: [], load: () => listMyCourseAssignments(userId) },
    { key: 'skillSuggestions', label: 'skill suggestions', fallback: [], load: () => listMyManagerSkillSuggestions(userId) },
    { key: 'managerTeamInvites', label: 'manager-team invitations', fallback: [], load: listMyManagerTeamInvites },
  ])

  const requesterIds = [
    ...values.connectionRequests.map((item) => item.requester_id),
    ...values.validationRequests.map((item) => item.requester_id),
  ]
  let profiles = {}
  try {
    profiles = await getProfiles(requesterIds)
  } catch (error) {
    failures.push({ key: 'profiles', label: 'profile names', error })
  }

  return { items: buildNotificationItems(values, profiles), failures }
}
