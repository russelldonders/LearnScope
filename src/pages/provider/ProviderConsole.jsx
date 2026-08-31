import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import AppHeader from '../../components/AppHeader'
import { OrganisationStaffPanel } from '../admin/AdminProviders'
import ResourceLibrarySection from '../../components/ResourceLibrarySection'
import ProviderSkillsSection from '../../components/ProviderSkillsSection'
import OrganisationSettingsModal from '../../components/OrganisationSettingsModal'
import { listOrganisations } from '../../lib/admin/organisations'
import { listOrganisationCatalogueCourses, createProviderCourse } from '../../lib/admin/catalogue'

const STATUS_LABELS = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  rejected: 'Rejected',
  inactive: 'Inactive',
}

const SECTIONS = [
  { key: 'training', label: 'Training' },
  { key: 'skills', label: 'Skills' },
  { key: 'staff', label: 'Users', adminOnly: true },
  { key: 'resources', label: 'Resources' },
]

const EMPTY_FORM = { name: '', provider: '', courseType: '', duration: '', synopsis: '' }

// Console for a provider's own staff (organisation_members rows) -- built on
// top of the RLS/role model 0065/0066 already shipped: any org member
// (admin or trainer) can create training into their own organisation_id,
// only an org admin can manage staff. No new role concept -- "provider
// admin" is organisation_members.role = 'admin', scoped by the unique
// (organisation_id, user_id) constraint.
export default function ProviderConsole() {
  const { user, organisationMemberships } = useAuth()
  const [organisations, setOrganisations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedOrgId, setSelectedOrgId] = useState(null)
  const [activeSection, setActiveSection] = useState('training')
  const [showSettings, setShowSettings] = useState(false)

  const myOrgIds = useMemo(
    () => (organisationMemberships ?? []).map((m) => m.organisation_id),
    [organisationMemberships]
  )
  // Deactivating an organisation revokes its staff's actual access (RLS,
  // 0069) -- filter to active orgs here too, so a staff member doesn't see a
  // tab for an org that can no longer create training or manage staff and
  // hit a confusing RLS error trying to use it.
  const myOrgs = useMemo(
    () => organisations.filter((o) => o.status === 'active' && myOrgIds.includes(o.id)),
    [organisations, myOrgIds]
  )
  const myRole = (organisationMemberships ?? []).find((m) => m.organisation_id === selectedOrgId)?.role
  const selectedOrg = myOrgs.find((o) => o.id === selectedOrgId)
  // Guards against a stale 'staff' tab surviving a switch to an org where
  // the current user isn't an admin (staff isn't in that org's own tab
  // bar, but activeSection state persists across the org switch).
  const currentSection = activeSection === 'staff' && myRole !== 'admin' ? 'training' : activeSection

  useEffect(() => {
    reloadOrganisations().finally(() => setLoading(false))
  }, [])

  function reloadOrganisations() {
    return listOrganisations()
      .then((data) => setOrganisations(data))
      .catch((err) => setError(err.message))
  }

  useEffect(() => {
    if (!selectedOrgId && myOrgs.length > 0) {
      setSelectedOrgId(myOrgs[0].id)
    }
  }, [myOrgs, selectedOrgId])

  const visibleSections = SECTIONS.filter((s) => !s.adminOnly || myRole === 'admin')

  return (
    <div className="min-h-screen bg-paper">
      {/* hideNavLinks: this console is a distinct workspace from the
          learner-facing app -- the learner nav (Skills/Experience/etc.)
          isn't relevant here and just adds noise/wrong-context links. */}
      <AppHeader hideNavLinks />
      <main id="main-content" tabIndex={-1} className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="font-display text-xl text-ink mb-1">Provider console</h1>
        <p className="text-sm text-secondary mb-6">
          Create and build out training, then submit it for approval, manage your organisation's users, and
          maintain a shared library of resources.
        </p>

        {error && <p className="text-sm text-red-700 mb-4">{error}</p>}

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : myOrgs.length === 0 ? (
          <p className="text-secondary">
            {myOrgIds.length > 0
              ? "The organisation(s) you're a user of are currently deactivated."
              : "You're not part of any provider organisation."}
          </p>
        ) : (
          <>
            {myOrgs.length > 1 && (
              <div className="flex items-center flex-wrap gap-1 mb-4 border-b border-hairline">
                {myOrgs.map((org) => (
                  <button
                    key={org.id}
                    type="button"
                    onClick={() => setSelectedOrgId(org.id)}
                    className={`text-sm px-3 py-2 -mb-px border-b-2 whitespace-nowrap ${
                      selectedOrgId === org.id
                        ? 'border-moss text-ink font-medium'
                        : 'border-transparent text-secondary hover:text-ink'
                    }`}
                  >
                    {org.name}
                  </button>
                ))}
              </div>
            )}

            {selectedOrg && (
              <div>
                <div className="flex items-center justify-between gap-2 mb-6 border-b border-hairline">
                  <div className="flex items-center flex-wrap gap-1">
                    {visibleSections.map((section) => (
                      <button
                        key={section.key}
                        type="button"
                        onClick={() => setActiveSection(section.key)}
                        className={`text-sm px-3 py-2 -mb-px border-b-2 whitespace-nowrap ${
                          currentSection === section.key
                            ? 'border-moss text-ink font-medium'
                            : 'border-transparent text-secondary hover:text-ink'
                        }`}
                      >
                        {section.label}
                      </button>
                    ))}
                  </div>
                  {myRole === 'admin' && (
                    <button
                      type="button"
                      onClick={() => setShowSettings(true)}
                      title="Organisation settings"
                      aria-label="Organisation settings"
                      className="shrink-0 mb-2 w-8 h-8 rounded-md border border-hairline text-secondary hover:text-ink hover:bg-paper flex items-center justify-center"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                      </svg>
                    </button>
                  )}
                </div>

                {currentSection === 'training' && (
                  <ProviderTrainingSection key={selectedOrg.id} organisation={selectedOrg} userId={user.id} />
                )}
                {currentSection === 'skills' && (
                  <ProviderSkillsSection key={selectedOrg.id} organisationId={selectedOrg.id} userId={user.id} />
                )}
                {currentSection === 'staff' && myRole === 'admin' && (
                  <OrganisationStaffPanel key={selectedOrg.id} organisation={selectedOrg} />
                )}
                {currentSection === 'resources' && (
                  <ResourceLibrarySection key={selectedOrg.id} organisationId={selectedOrg.id} userId={user.id} />
                )}
              </div>
            )}
          </>
        )}
      </main>

      {showSettings && selectedOrg && (
        <OrganisationSettingsModal
          organisation={selectedOrg}
          onClose={() => {
            setShowSettings(false)
            reloadOrganisations()
          }}
        />
      )}
    </div>
  )
}

function ProviderTrainingSection({ organisation, userId }) {
  const navigate = useNavigate()
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => {
    load()
  }, [organisation.id])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setCourses(await listOrganisationCatalogueCourses(organisation.id))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    try {
      const created = await createProviderCourse(userId, organisation.id, form)
      setForm(EMPTY_FORM)
      setShowForm(false)
      // Land straight in the course's own editor -- creating is just the
      // first step, the provider keeps building it out from there.
      navigate(`/provider/training/${created.id}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  const filteredCourses = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return courses.filter(
      (course) =>
        (statusFilter === 'all' || course.status === statusFilter) &&
        (!needle || [course.name, course.synopsis, course.course_type].filter(Boolean).some((value) => value.toLowerCase().includes(needle)))
    )
  }, [courses, query, statusFilter])

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="font-display text-lg text-ink">Training</h3>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90"
        >
          {showForm ? 'Cancel' : '+ Create training'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-card border border-hairline rounded-lg p-4 space-y-3 mb-4">
          <p className="text-xs text-secondary">
            Creates a draft you can keep building out before submitting it for approval.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="providerCourseName">
                Name
              </label>
              <input
                id="providerCourseName"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="providerCourseType">
                Course type
              </label>
              <input
                id="providerCourseType"
                value={form.courseType}
                onChange={(e) => setForm((f) => ({ ...f, courseType: e.target.value }))}
                placeholder="Online, In-person, Workshop…"
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="providerCourseDuration">
                Duration
              </label>
              <input
                id="providerCourseDuration"
                value={form.duration}
                onChange={(e) => setForm((f) => ({ ...f, duration: e.target.value }))}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm text-secondary mb-1" htmlFor="providerCourseSynopsis">
                Synopsis
              </label>
              <textarea
                id="providerCourseSynopsis"
                rows={3}
                value={form.synopsis}
                onChange={(e) => setForm((f) => ({ ...f, synopsis: e.target.value }))}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={creating}
            className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90 disabled:opacity-60"
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
        </form>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_200px] gap-2 mb-4" role="search">
        <label className="sr-only" htmlFor="providerTrainingSearch">Search training</label>
        <input id="providerTrainingSearch" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search training…" className="w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
        <label className="sr-only" htmlFor="providerTrainingStatus">Filter training by status</label>
        <select id="providerTrainingStatus" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss">
          <option value="all">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      {error && <p className="text-sm text-red-700 mb-3">{error}</p>}

      {loading ? (
        <p className="text-secondary">Loading…</p>
      ) : courses.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No training created yet.</p>
        </div>
      ) : filteredCourses.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No training matches these filters.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredCourses.map((course) => (
            <CourseCard key={course.id} course={course} />
          ))}
        </div>
      )}
    </div>
  )
}

// Summary only -- editing (metadata, sections, content) happens on the
// course's own page (ProviderCourseEditor), the same way AdminUserDetail/
// AdminSkillDetail moved their consoles' inline expansions onto dedicated
// pages once there was more than a form's worth of detail to show.
function CourseCard({ course }) {
  const editable = course.status === 'draft' || course.status === 'rejected'
  return (
    <Link
      to={`/provider/training/${course.id}`}
      className="block bg-card border border-hairline rounded-lg p-3 hover:border-moss/60 transition-colors"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-ink font-medium">{course.name}</p>
        <span className="font-mono text-[10px] uppercase tracking-wide text-secondary shrink-0">
          {STATUS_LABELS[course.status] ?? course.status}
        </span>
      </div>
      {course.synopsis && <p className="text-sm text-secondary mt-1">{course.synopsis}</p>}
      {course.status === 'rejected' && course.rejection_reason && (
        <p className="text-xs text-red-700 mt-1">Rejected: {course.rejection_reason}</p>
      )}
      <p className="font-mono text-[10px] text-moss mt-1">{editable ? 'Edit →' : 'View →'}</p>
    </Link>
  )
}
