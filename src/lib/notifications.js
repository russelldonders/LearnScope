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
import { listMyPlanAssignments } from './organisationPlans'
import { listMyManagerSkillSuggestions } from './managerSkillActions'
import { listMyManagerTeamInvites } from './managerTeams'
import { loadActionSources } from './actionLoading'
import { listIncomingPlanInvitations } from './learnerPlans'
import { listActiveGoalsForAttention } from './skillGoals'
import { listSharedActivitySuggestions } from './sharedActivities'
import { supabase } from './supabaseClient'
import { LEVEL_LABELS } from './levels'

const personalSource = 'Personal'
const REMINDER_WINDOW_DAYS = 14

function notification({ id, kind, title, detail, source = personalSource, occurredAt, actions = [] }) {
  return {
    id: `${kind}:${id}`,
    kind,
    title,
    detail,
    source,
    occurredAt,
    actions,
  }
}

function reminderCutoff() {
  return new Date(Date.now() + REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

async function listUpcomingSelfAssessments(userId) {
  const { data, error } = await supabase
    .from('skills')
    .select('id, name, next_checkin_date')
    .eq('user_id', userId)
    .not('next_checkin_date', 'is', null)
    .lte('next_checkin_date', reminderCutoff())
    .order('next_checkin_date', { ascending: true })
  if (error) throw error
  return data ?? []
}

async function listUpcomingTargets(userId) {
  const { data, error } = await supabase
    .from('skill_targets')
    .select('id, skill_id, target_level, target_date, created_at, skills(name)')
    .eq('user_id', userId)
    .not('target_date', 'is', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  const latestBySkill = new Map()
  for (const target of data ?? []) {
    if (!latestBySkill.has(target.skill_id)) latestBySkill.set(target.skill_id, target)
  }
  return [...latestBySkill.values()].filter((target) => target.target_date <= reminderCutoff())
}

async function listDismissedNotificationIds(userId) {
  const { data, error } = await supabase
    .from('notification_dismissals')
    .select('notification_id')
    .eq('user_id', userId)
  if (error) throw error
  return (data ?? []).map((row) => row.notification_id)
}

export async function dismissNotification(userId, notificationId) {
  const { error } = await supabase
    .from('notification_dismissals')
    .insert({ user_id: userId, notification_id: notificationId })
  if (error) throw error
}

export function buildNotificationItems(values, profiles = {}) {
  const items = [
    ...(values.planInvites ?? []).map((item) => notification({
      id: item.id,
      kind: 'plan-invite',
      title: 'Plan Invitation',
      detail: `${item.inviter_name || 'A connection'} invited you to follow ${item.plan_title || 'a plan'}.`,
      occurredAt: item.created_at,
      actions: [{ label: 'Review invitation', href: '/actions#plan-invitations' }],
    })),
    ...values.rateInvites.map((item) => notification({
      id: item.id,
      kind: 'rate-invite',
      title: 'Rating Invitation',
      detail: `${item.inviter_name || 'Someone'} asked you to rate ${item.skill_name || 'a skill'}.`,
      occurredAt: item.created_at,
      actions: [{ label: 'Rate skill', href: `/rate/${item.share_code}` }],
    })),
    ...values.recommendInvites.map((item) => notification({
      id: item.id,
      kind: 'recommend-invite',
      title: 'Skill Recommendation',
      detail: `${item.inviter_name || 'Someone'} recommended ${item.skill_name || 'a skill'}.`,
      occurredAt: item.created_at,
      actions: [{ label: 'Review recommendation', href: `/recommend/${item.share_code}` }],
    })),
    ...(values.sharedActivities ?? []).map((item) => notification({
      id: item.id,
      kind: 'shared-activity',
      title: 'Shared Activity',
      detail: item.kind === 'observed'
        ? `${item.logged_by_name || 'A connection'} saw you: “${item.title || 'an activity'}”. Add it to your record?`
        : `${item.logged_by_name || 'A connection'} logged “${item.title || 'an activity'}” with you. Add it to your record?`,
      occurredAt: item.happened_at,
      actions: [{ label: 'Review', href: `/skills-profile/${item.logged_by}?tab=activity` }],
    })),
    ...values.unseenRatings.map((item) => notification({
      id: item.id,
      kind: 'rating',
      title: 'New Rating',
      detail: `${item.rater_name || 'Someone'} rated ${item.skill_name || 'one of your skills'}.`,
      occurredAt: item.rated_at,
      actions: [{ label: 'View rating', href: `/skills/${item.skill_id}` }],
    })),
    ...values.connectionRequests.map((item) => notification({
      id: item.id,
      kind: 'connection-request',
      title: 'Connection Request',
      detail: `${profiles[item.requester_id]?.name || 'Someone'} wants to connect${item.skills?.name ? ` about ${item.skills.name}` : ''}.`,
      occurredAt: item.created_at,
      actions: [{ label: 'Respond', href: '/actions#connection-requests' }],
    })),
    ...values.validationRequests.map((item) => notification({
      id: item.id,
      kind: 'validation-request',
      title: 'Validation Request',
      detail: `${profiles[item.requester_id]?.name || 'Someone'} asked you to confirm ${item.skills?.name || 'a skill'}.`,
      occurredAt: item.created_at,
      actions: [{ label: 'Review request', href: `/validate-request/${item.id}` }],
    })),
    ...values.orgInvites.map((item) => notification({
      id: item.id,
      kind: 'organisation-invite',
      title: 'Organisation Invitation',
      detail: `You were invited to join as ${item.role === 'admin' ? 'an admin' : 'a member'}.`,
      source: item.organisations?.name || 'Organisation',
      occurredAt: item.created_at,
      actions: [{ label: 'Respond', href: '/actions#provider-invitations' }],
    })),
    ...values.employerInvites.map((item) => notification({
      id: item.id,
      kind: 'employer-invite',
      title: 'Workspace Invitation',
      detail: `You were invited to join as ${item.role === 'admin' ? 'an admin' : 'a member'}.`,
      source: item.employers?.name || 'Employer',
      occurredAt: item.created_at,
      actions: [{ label: 'Respond', href: '/actions#employer-invitations' }],
    })),
    ...values.dataAccessRequests.map((item) => notification({
      id: item.id,
      kind: 'data-access-request',
      title: 'Data Access Request',
      detail: 'Review a request to share information from your profile.',
      source: item.employers?.name || 'Employer',
      occurredAt: item.created_at,
      actions: [{ label: 'Review request', href: '/actions#data-access-requests' }],
    })),
    ...values.courseAssignments.map((item) => notification({
      id: item.id,
      kind: 'course-assignment',
      title: 'Course Assigned',
      detail: item.course_catalogue?.name || 'A new course is ready for you.',
      source: item.employers?.name || item.course_catalogue?.provider || 'Learning',
      occurredAt: item.created_at,
      actions: [{ label: 'Start course', href: '/actions#assigned-training' }],
    })),
    ...(values.planAssignments ?? []).map((item) => notification({
      id: item.id,
      kind: 'plan-assignment',
      title: 'Plan Assigned',
      detail: item.title || 'A plan is ready for you to start.',
      source: item.organisation_name || 'Organisation',
      occurredAt: item.assigned_at,
      actions: [{ label: 'Review plan', href: '/actions#assigned-plans' }],
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
      actions: [{ label: 'Review suggestion', href: '/actions#skill-suggestions' }],
    })),
    ...values.managerTeamInvites.map((item) => notification({
      id: item.id,
      kind: 'manager-team-invite',
      title: 'Team Invitation',
      detail: `${item.managerName || 'A manager'} invited you to join ${item.teamName || 'their team'}.`,
      source: item.teamName || 'Manager Team',
      occurredAt: item.invitedAt,
      actions: [{ label: 'Respond', href: '/actions#manager-team-invitations' }],
    })),
    ...(values.selfAssessments ?? []).map((item) => notification({
      id: `${item.id}:${item.next_checkin_date}`,
      kind: 'self-assessment-reminder',
      title: 'Self-assessment due',
      detail: `${item.name} is ready for a check-in. Update the level that reflects where you are now.`,
      occurredAt: `${item.next_checkin_date}T00:00:00`,
      actions: [{ label: 'Self-assess now', href: `/skills/${item.id}?action=self-assess` }],
    })),
    ...(values.targets ?? []).map((item) => notification({
      id: item.id,
      kind: 'skill-target-reminder',
      title: 'Skill target due',
      detail: `${item.skills?.name || 'Your skill'} is targeted for ${LEVEL_LABELS[item.target_level] || item.target_level} by ${new Date(`${item.target_date}T00:00:00`).toLocaleDateString()}.`,
      occurredAt: `${item.target_date}T00:00:00`,
      actions: [
        { label: 'Self-assess now', href: `/skills/${item.skill_id}?action=self-assess` },
        { label: 'Change target', href: `/skills/${item.skill_id}?action=change-target` },
      ],
    })),
    ...(values.goals ?? [])
      .filter((item) => item.goal.target_date && item.goal.target_date <= reminderCutoff() && !item.progress.reached)
      .map((item) => notification({
        id: `${item.goal.id}:${item.goal.target_date}`,
        kind: 'skill-goal-reminder',
        title: 'Goal progress due',
        detail: `${item.goal.title} is due ${new Date(`${item.goal.target_date}T00:00:00`).toLocaleDateString()}.`,
        occurredAt: `${item.goal.target_date}T00:00:00`,
        actions: [{ label: 'Log progress', href: `/dashboard?goal=${encodeURIComponent(item.goal.id)}` }],
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
    { key: 'planAssignments', label: 'assigned plans', fallback: [], load: async () => (await listMyPlanAssignments()).filter((a) => a.status === 'assigned') },
    { key: 'skillSuggestions', label: 'skill suggestions', fallback: [], load: () => listMyManagerSkillSuggestions(userId) },
    { key: 'managerTeamInvites', label: 'manager-team invitations', fallback: [], load: listMyManagerTeamInvites },
    { key: 'planInvites', label: 'plan invitations', fallback: [], load: listIncomingPlanInvitations },
    { key: 'sharedActivities', label: 'shared activities', fallback: [], load: listSharedActivitySuggestions },
    { key: 'selfAssessments', label: 'self-assessment reminders', fallback: [], load: () => listUpcomingSelfAssessments(userId) },
    { key: 'targets', label: 'skill target reminders', fallback: [], load: () => listUpcomingTargets(userId) },
    { key: 'goals', label: 'goal reminders', fallback: [], load: () => listActiveGoalsForAttention(userId) },
    { key: 'dismissedIds', label: 'dismissed notifications', fallback: [], load: () => listDismissedNotificationIds(userId) },
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

  const dismissedIds = new Set(values.dismissedIds)
  return { items: buildNotificationItems(values, profiles).filter((item) => !dismissedIds.has(item.id)), failures }
}
