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
import { listMyCoachInterests, listMyCoaching, listMyCoachingSessions, listMyRecentCoachReviews } from './coaching'
import { supabase } from './supabaseClient'
import { LEVEL_LABELS } from './levels'

const personalSource = 'Personal'
const REMINDER_WINDOW_DAYS = 14
// How long a coach's answer to a learner stays among their notifications.
const COACHING_REPLY_DAYS = 30

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

// Coaching (0335): a request waiting for the coach; the coach's answer, for
// the learner, while recent; and a coach becoming available for a skill the
// learner is looking for one in. Each opens the skill's Network tab, where
// coaching is.
export function coachingNotifications(coaching, interests, now = Date.now(), sessions = [], reviews = []) {
  const recent = (at) => at && now - new Date(at).getTime() < COACHING_REPLY_DAYS * 24 * 60 * 60 * 1000
  const network = (skillId) => `/skills/${skillId}?tab=network`
  const relationships = new Map(coaching.map((row) => [row.id, row]))
  const sessionTime = (at) => new Date(at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  // The skill page the session is on, for whichever of them is reading.
  const sessionSkill = (row) => (row.role === 'learner' ? row.learner_skill_id : row.coach_skill_id)
  const sessionItems = sessions.flatMap((session) => {
    const row = relationships.get(session.relationship_id)
    if (!row || !sessionSkill(row)) return []
    const who = row.other_name || 'Your coaching partner'
    const href = network(sessionSkill(row))
    if (session.status === 'proposed' && !session.proposed_by_me) {
      return [notification({
        id: session.id,
        kind: 'coaching-session-proposed',
        title: 'Coaching Session',
        detail: `${who} proposed a coaching session on ${sessionTime(session.starts_at)}.`,
        occurredAt: session.created_at,
        actions: [{ label: 'Answer', href }],
      })]
    }
    if (session.status === 'confirmed' && session.proposed_by_me && recent(session.responded_at) && new Date(session.starts_at).getTime() > now) {
      return [notification({
        id: session.id,
        kind: 'coaching-session-confirmed',
        title: 'Coaching Session',
        detail: `${who} confirmed the coaching session on ${sessionTime(session.starts_at)}.`,
        occurredAt: session.responded_at,
        actions: [{ label: 'Open', href }],
      })]
    }
    if (session.status === 'confirmed' && row.role === 'learner' && new Date(session.starts_at).getTime() <= now) {
      return [notification({
        id: session.id,
        kind: 'coaching-session-done',
        title: 'Coaching Session',
        detail: `Did your coaching session with ${who} on ${sessionTime(session.starts_at)} happen? Mark it done to add it to your record.`,
        occurredAt: session.starts_at,
        actions: [{ label: 'Mark as done', href }],
      })]
    }
    if (session.status === 'cancelled' && !session.cancelled_by_me && recent(session.cancelled_at)) {
      return [notification({
        id: session.id,
        kind: 'coaching-session-cancelled',
        title: 'Coaching Session',
        detail: `${who} cancelled the coaching session on ${sessionTime(session.starts_at)}.`,
        occurredAt: session.cancelled_at,
        actions: [{ label: 'Open', href }],
      })]
    }
    return []
  })
  // A learner's review of the coach's coaching (0337), while recent.
  const reviewItems = reviews
    .filter((review) => review.coach_skill_id && recent(review.updated_at))
    .map((review) => notification({
      id: review.id,
      kind: 'coach-review',
      title: 'Coaching Review',
      detail: `${review.reviewer_name || 'A learner'} reviewed your coaching in ${review.skill_name || 'a skill'}: ${review.rating} out of 5 stars.`,
      occurredAt: review.updated_at,
      actions: [{ label: 'Read review', href: network(review.coach_skill_id) }],
    }))
  return [
    ...reviewItems,
    ...sessionItems,
    ...coaching
      .filter((row) => row.role === 'coach' && row.status === 'requested' && row.coach_skill_id)
      .map((row) => notification({
        id: row.id,
        kind: 'coaching-request',
        title: 'Coaching Request',
        detail: `${row.other_name || 'Someone'} asked you to coach them in ${row.skill_name || 'a skill'}.`,
        occurredAt: row.requested_at,
        actions: [{ label: 'Review request', href: network(row.coach_skill_id) }],
      })),
    ...coaching
      .filter((row) => row.role === 'learner' && (row.status === 'active' || row.status === 'declined') && recent(row.responded_at))
      .map((row) => notification({
        id: row.id,
        kind: row.status === 'active' ? 'coaching-accepted' : 'coaching-declined',
        title: row.status === 'active' ? 'Coaching Accepted' : 'Coaching Request',
        detail: row.status === 'active'
          ? `${row.other_name || 'Your coach'} agreed to coach you in ${row.skill_name || 'a skill'}.`
          : `${row.other_name || 'The coach you asked'} can't coach you in ${row.skill_name || 'a skill'} right now.`,
        occurredAt: row.responded_at,
        actions: [{ label: 'Open skill', href: network(row.learner_skill_id) }],
      })),
    ...interests
      .filter((row) => row.coach_available_at)
      .map((row) => notification({
        id: row.id,
        kind: 'coach-available',
        title: 'Coach Available',
        detail: `Someone is now offering coaching in ${row.skill_name || 'a skill you are learning'}.`,
        occurredAt: row.coach_available_at,
        actions: [{ label: 'Find a coach', href: network(row.skill_id) }],
      })),
  ]
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
    ...coachingNotifications(values.coaching ?? [], values.coachInterests ?? [], Date.now(), values.coachingSessions ?? [], values.coachReviews ?? []),
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
    { key: 'coaching', label: 'coaching', fallback: [], load: listMyCoaching },
    { key: 'coachInterests', label: 'coach availability', fallback: [], load: listMyCoachInterests },
    { key: 'coachingSessions', label: 'coaching sessions', fallback: [], load: listMyCoachingSessions },
    { key: 'coachReviews', label: 'coaching reviews', fallback: [], load: listMyRecentCoachReviews },
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
