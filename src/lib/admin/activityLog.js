import { supabase } from '../supabaseClient'

// Console overhaul Phase 5. See supabase/migrations/20260903090000_admin_
// activity_log.sql for the full design rationale (event boundaries, RLS,
// personal-data, 7-year retention policy). Only this curated set of
// high-impact admin/provider actions is ever logged here -- this is not a
// general mutation audit trail. These labels are display only and are
// expected to grow alongside whichever RPCs/admin-API actions/triggers get
// instrumented next, not the other way round.
export const ACTIVITY_ACTION_LABELS = {
  'course.approved': 'Course approved',
  'course.rejected': 'Course rejected',
  'course.deactivated': 'Course deactivated',
  'user.blocked': 'User blocked',
  'user.unblocked': 'User unblocked',
  'user.deleted': 'User deleted',
  'skill.activated': 'Skill activated',
  'skill.deactivated': 'Skill deactivated',
  'tag.blacklisted': 'Tag blacklisted',
  'tag.unblacklisted': 'Tag removed from blacklist',
  'organisation.activated': 'Provider activated',
  'organisation.suspended': 'Provider suspended',
  'catalogue_approver.added': 'Catalogue approver added',
  'catalogue_approver.removed': 'Catalogue approver removed',
  'employer_member.added': 'Employer member added',
  'employer_member.removed': 'Employer member removed',
  'org_member.removed': 'Provider staff member removed',
}

const ENTITY_TYPE_LABELS = {
  course_catalogue: 'Course',
  profile: 'User',
  skill_library: 'Skill',
  tag: 'Tag',
  organisation: 'Provider',
  catalogue_approver: 'Catalogue approver',
  organisation_member: 'Provider staff member',
  employer_member: 'Employer member',
}

export function describeActivityAction(action) {
  return ACTIVITY_ACTION_LABELS[action] ?? action
}

export function describeEntityType(entityType) {
  return ENTITY_TYPE_LABELS[entityType] ?? entityType
}

// Platform-admin-only per the table's own RLS select policy -- for anyone
// else this resolves to an empty list, same as every other admin/*.js
// module relying on RLS rather than a client-side role check.
export async function listAdminActivityLog({ limit = 200 } = {}) {
  const { data, error } = await supabase
    .from('admin_activity_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}
