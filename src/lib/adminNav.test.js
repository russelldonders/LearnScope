import { describe, expect, it } from 'vitest'
import { ADMIN_NAV, currentAdminNavItem, hrefOf } from './adminNav'

const at = (pathname, search = '') => currentAdminNavItem({ pathname, search })

describe('currentAdminNavItem', () => {
  it('matches the Overview only on /admin itself', () => {
    expect(at('/admin').key).toBe('overview')
    expect(at('/admin/users').key).toBe('users')
  })

  it('keeps a section highlighted on its detail pages', () => {
    expect(at('/admin/users/user-1').key).toBe('users')
    expect(at('/admin/organisations/org-1').key).toBe('organisations')
    expect(at('/admin/courses/course-1/edit').key).toBe('courses')
    expect(at('/admin/skills/skill-1').key).toBe('skills')
  })

  it('tells course approvals apart from the plain courses list', () => {
    expect(at('/admin/courses', '?status=pending_approval').key).toBe('approvals')
    expect(at('/admin/courses', '?status=rejected').key).toBe('courses')
    expect(at('/admin/courses').key).toBe('courses')
  })

  it('finds pages inside each group', () => {
    expect(at('/admin/reported-resources').key).toBe('reported-resources')
    expect(at('/admin/audit-log').key).toBe('audit-log')
    expect(at('/admin/whats-new').key).toBe('whats-new')
    expect(at('/admin/settings').key).toBe('settings')
  })

  it('matches nothing outside the console', () => {
    expect(at('/dashboard')).toBeNull()
  })
})

describe('ADMIN_NAV', () => {
  it('groups the console into a handful of areas', () => {
    expect(ADMIN_NAV.map((entry) => entry.label)).toEqual(['Overview', 'People', 'Content', 'Moderation', 'Insights', 'Settings'])
  })

  it('builds links with their filter', () => {
    const approvals = ADMIN_NAV.find((e) => e.key === 'moderation').items.find((i) => i.key === 'approvals')
    expect(hrefOf(approvals)).toBe('/admin/courses?status=pending_approval')
  })
})
