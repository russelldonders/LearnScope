// The console's sections, grouped by what an admin is doing. A plain entry is
// a single page; a group opens a menu of its pages. `match` decides which
// entry is highlighted -- by path prefix, so detail pages (a user, a course,
// an organisation) keep their section highlighted -- and `query` lets two
// entries share a path (Course approvals is the Courses list filtered to
// courses awaiting approval).
export const ADMIN_NAV = [
  { key: 'overview', label: 'Overview', to: '/admin', exact: true },
  {
    key: 'people',
    label: 'People',
    items: [
      { key: 'users', label: 'Users', to: '/admin/users' },
      { key: 'organisations', label: 'Organisations', to: '/admin/organisations' },
    ],
  },
  {
    key: 'content',
    label: 'Content',
    items: [
      { key: 'courses', label: 'Courses', to: '/admin/courses' },
      { key: 'skills', label: 'Skill library', to: '/admin/skills' },
      { key: 'tags', label: 'Skill tags', to: '/admin/tags' },
    ],
  },
  {
    key: 'moderation',
    label: 'Moderation',
    items: [
      { key: 'approvals', label: 'Course approvals', to: '/admin/courses', query: { status: 'pending_approval' } },
      { key: 'reported-resources', label: 'Reported resources', to: '/admin/reported-resources' },
    ],
  },
  {
    key: 'insights',
    label: 'Insights',
    items: [
      { key: 'ai-usage', label: 'AI usage', to: '/admin/ai-usage' },
      { key: 'audit-log', label: 'Audit log', to: '/admin/audit-log' },
      { key: 'whats-new', label: "What's new", to: '/admin/whats-new' },
    ],
  },
  { key: 'settings', label: 'Settings', to: '/admin/settings' },
]

export function hrefOf(item) {
  return item.query ? `${item.to}?${new URLSearchParams(item.query)}` : item.to
}

function pathMatches(item, pathname) {
  return item.exact ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`)
}

// Picks the single nav item for the current page: among items whose path
// matches, one whose query also matches wins over one without a query (so
// /admin/courses?status=pending_approval is Course approvals, not Courses).
export function currentAdminNavItem(location) {
  const params = new URLSearchParams(location.search)
  const candidates = ADMIN_NAV.flatMap((entry) => (entry.items ? entry.items : [entry]))
    .filter((item) => pathMatches(item, location.pathname))
  const withQuery = candidates.find(
    (item) => item.query && Object.entries(item.query).every(([key, value]) => params.get(key) === value)
  )
  return withQuery ?? candidates.find((item) => !item.query) ?? null
}
