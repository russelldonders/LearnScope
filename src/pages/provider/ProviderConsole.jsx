import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import AppHeader from '../../components/AppHeader'
import { OrganisationStaffPanel } from '../admin/AdminProviders'
import ResourceLibrarySection from '../../components/ResourceLibrarySection'
import ProviderSkillsSection from '../../components/ProviderSkillsSection'
import OrganisationSettingsModal from '../../components/OrganisationSettingsModal'
import AccessibleDialog from '../../components/AccessibleDialog'
import ProgressBar from '../../components/ProgressBar'
import {
  createProviderCatalogue,
  deleteProviderCatalogue,
  listProviderCatalogues,
  updateProviderCatalogue,
} from '../../lib/catalogues'
import { listOrganisations } from '../../lib/admin/organisations'
import {
  listOrganisationCatalogueCourses,
  createProviderCourse,
  listCourseParticipants,
  listCourseVersionHistory,
  createDraftCourseVersion,
} from '../../lib/admin/catalogue'

const STATUS_LABELS = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  rejected: 'Rejected',
  inactive: 'Inactive',
}

const SECTIONS = [
  { key: 'training', label: 'Training' },
  { key: 'catalogues', label: 'Catalogues', adminOnly: true },
  { key: 'skills', label: 'Skills' },
  { key: 'staff', label: 'Users', adminOnly: true },
  { key: 'resources', label: 'Resources' },
]

const EMPTY_FORM = { name: '', courseCode: '', provider: '', courseType: '', duration: '', synopsis: '' }

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
  const currentSection = (activeSection === 'staff' || activeSection === 'catalogues') && myRole !== 'admin' ? 'training' : activeSection

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
                  <ProviderTrainingSection
                    key={selectedOrg.id}
                    organisation={selectedOrg}
                    userId={user.id}
                    canViewParticipants={myRole === 'admin'}
                  />
                )}
                {currentSection === 'skills' && (
                  <ProviderSkillsSection key={selectedOrg.id} organisationId={selectedOrg.id} userId={user.id} />
                )}
                {currentSection === 'catalogues' && myRole === 'admin' && (
                  <ProviderCataloguesSection key={selectedOrg.id} organisation={selectedOrg} userId={user.id} />
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

function ProviderCataloguesSection({ organisation, userId }) {
  const [catalogues, setCatalogues] = useState([])
  const [form, setForm] = useState({ name: '', description: '' })
  const [editingId, setEditingId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    load()
  }, [organisation.id])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setCatalogues(await listProviderCatalogues(organisation.id))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    setError(null)
    try {
      if (editingId) await updateProviderCatalogue(editingId, form)
      else await createProviderCatalogue(userId, organisation.id, form)
      setForm({ name: '', description: '' })
      setEditingId(null)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(catalogue) {
    if (!window.confirm(`Delete “${catalogue.name}”? Courses will no longer be published through this catalogue.`)) return
    setError(null)
    try {
      await deleteProviderCatalogue(catalogue.id)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <section aria-labelledby="provider-catalogues-heading">
      <div className="mb-5">
        <h2 id="provider-catalogues-heading" className="font-display text-lg text-ink">Provider catalogues</h2>
        <p className="text-sm text-secondary mt-1 max-w-2xl">
          Organise published training into named collections. Your catalogues and the platform-managed Global catalogue are available whenever a course is submitted.
        </p>
      </div>

      {error && <p role="alert" className="text-sm text-red-700 mb-4">{error}</p>}

      <form onSubmit={handleSubmit} className="bg-card border border-hairline rounded-lg p-4 mb-6">
        <h3 className="text-sm font-medium text-ink mb-3">{editingId ? 'Edit catalogue' : 'Create a catalogue'}</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-xs text-secondary">
            Name
            <input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
          </label>
          <label className="text-xs text-secondary">
            Description (optional)
            <input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
          </label>
        </div>
        <div className="flex gap-2 mt-3">
          <button disabled={saving || !form.name.trim()} className="rounded-md bg-moss px-3 py-1.5 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50">
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create catalogue'}
          </button>
          {editingId && (
            <button type="button" onClick={() => { setEditingId(null); setForm({ name: '', description: '' }) }} className="rounded-md border border-hairline px-3 py-1.5 text-sm text-ink hover:bg-paper">Cancel</button>
          )}
        </div>
      </form>

      {loading ? (
        <p role="status" className="text-sm text-secondary">Loading catalogues…</p>
      ) : catalogues.length === 0 ? (
        <div className="rounded-lg border border-dashed border-hairline py-10 text-center">
          <p className="text-sm text-secondary">No provider catalogues yet.</p>
        </div>
      ) : (
        <div className="divide-y divide-hairline border-y border-hairline">
          {catalogues.map((catalogue) => (
            <div key={catalogue.id} className="flex items-start justify-between gap-4 py-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{catalogue.name}</p>
                {catalogue.description && <p className="text-xs text-secondary mt-1">{catalogue.description}</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={() => { setEditingId(catalogue.id); setForm({ name: catalogue.name, description: catalogue.description ?? '' }) }} className="text-xs font-medium text-moss hover:underline">Edit</button>
                <button type="button" onClick={() => handleDelete(catalogue)} className="text-xs font-medium text-red-700 hover:underline">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function ProviderTrainingSection({ organisation, userId, canViewParticipants }) {
  const navigate = useNavigate()
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [creating, setCreating] = useState(false)
  const [participantCourse, setParticipantCourse] = useState(null)
  const [historyCourse, setHistoryCourse] = useState(null)
  const [creatingDraftCourseId, setCreatingDraftCourseId] = useState(null)

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

  async function handleEditCourse(course) {
    if (course.status !== 'approved') {
      navigate(`/provider/training/${course.id}`)
      return
    }

    setCreatingDraftCourseId(course.id)
    setError(null)
    try {
      const draftId = await createDraftCourseVersion(course.id)
      navigate(`/provider/training/${draftId}`)
    } catch (err) {
      setError(`Couldn’t create a new course version. ${err.message}`)
      setCreatingDraftCourseId(null)
    }
  }

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
              <label className="block text-sm text-secondary mb-1" htmlFor="providerCourseCode">
                Course code / ID
              </label>
              <input
                id="providerCourseCode"
                required
                value={form.courseCode}
                onChange={(e) => setForm((f) => ({ ...f, courseCode: e.target.value }))}
                placeholder="e.g. LS-101"
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

      {error && <p className="text-sm text-red-700 mb-3">{error}</p>}

      {loading ? (
        <p className="text-secondary">Loading…</p>
      ) : courses.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No training created yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {courses.map((course) => (
            <CourseCard
              key={course.id}
              course={course}
              canViewParticipants={canViewParticipants}
              onViewParticipants={() => setParticipantCourse(course)}
              onViewHistory={() => setHistoryCourse(course)}
              onEdit={() => handleEditCourse(course)}
              creatingDraft={creatingDraftCourseId === course.id}
            />
          ))}
        </div>
      )}

      {participantCourse && (
        <CourseParticipantsDialog course={participantCourse} onClose={() => setParticipantCourse(null)} />
      )}
      {historyCourse && (
        <CourseVersionHistoryDialog course={historyCourse} onClose={() => setHistoryCourse(null)} />
      )}
    </div>
  )
}

// Summary only -- editing (metadata, sections, content) happens on the
// course's own page (ProviderCourseEditor), the same way AdminUserDetail/
// AdminSkillDetail moved their consoles' inline expansions onto dedicated
// pages once there was more than a form's worth of detail to show.
function CourseCard({ course, canViewParticipants, onViewParticipants, onViewHistory, onEdit, creatingDraft }) {
  const editable = course.status === 'draft' || course.status === 'rejected'
  const canStartEditing = editable || course.status === 'approved'
  return (
    <article className="bg-card border border-hairline rounded-lg p-3 hover:border-moss/60 transition-colors">
      <div className="flex items-center justify-between gap-3">
        <Link to={`/provider/training/${course.id}`} className="text-ink font-medium hover:text-moss">
          {course.name}
        </Link>
        <span className="font-mono text-[10px] uppercase tracking-wide text-secondary shrink-0">
          Version {course.version_number} · {STATUS_LABELS[course.status] ?? course.status}
        </span>
      </div>
      <p className="font-mono text-xs text-secondary mt-1">Course code: {course.course_code || 'Not set'}</p>
      {course.synopsis && <p className="text-sm text-secondary mt-1">{course.synopsis}</p>}
      {course.status === 'rejected' && course.rejection_reason && (
        <p className="text-xs text-red-700 mt-1">Rejected: {course.rejection_reason}</p>
      )}
      <div className="mt-2 flex items-center gap-3">
        {canStartEditing ? (
          <button
            type="button"
            onClick={onEdit}
            disabled={creatingDraft}
            className="text-xs font-medium text-moss hover:underline disabled:cursor-wait disabled:opacity-60"
          >
            {creatingDraft ? 'Creating new version…' : 'Edit course'}
          </button>
        ) : (
          <Link to={`/provider/training/${course.id}`} className="text-xs font-medium text-moss hover:underline">
            View course
          </Link>
        )}
        <button type="button" onClick={onViewHistory} className="text-xs font-medium text-moss hover:underline">
          Version history
        </button>
        {canViewParticipants && (
          <button type="button" onClick={onViewParticipants} className="text-xs font-medium text-moss hover:underline">
            View participants
          </button>
        )}
      </div>
    </article>
  )
}

function CourseVersionHistoryDialog({ course, onClose }) {
  const [versions, setVersions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    listCourseVersionHistory(course.id)
      .then(setVersions)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [course.id])

  return (
    <AccessibleDialog
      labelledBy="course-version-history-title"
      onClose={onClose}
      panelClassName="w-full max-w-2xl max-h-[90vh] overflow-y-auto overscroll-contain rounded-lg border border-hairline bg-card p-5 sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="course-version-history-title" className="font-display text-xl text-ink">{course.name} version history</h2>
          <p className="mt-1 font-mono text-xs text-secondary">Course code: {course.course_code || 'Not set'}</p>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 text-sm text-secondary hover:text-ink">Close</button>
      </div>

      {loading && <p role="status" className="mt-6 text-sm text-secondary">Loading version history…</p>}
      {error && <p role="alert" className="mt-6 text-sm text-red-700">Couldn’t load version history: {error}</p>}
      {!loading && !error && versions.length === 0 && (
        <p className="mt-6 rounded-md border border-dashed border-hairline px-4 py-8 text-center text-sm text-secondary">
          No versions found for this course.
        </p>
      )}
      {!loading && !error && versions.length > 0 && (
        <ol className="mt-5 divide-y divide-hairline border-y border-hairline">
          {versions.map((version) => (
            <li key={version.id} className="grid gap-3 py-4 sm:grid-cols-[90px_1fr_1fr] sm:items-center">
              <div>
                <p className="font-medium text-ink">Version {version.version_number}</p>
                <p className="mt-0.5 text-xs text-secondary">{STATUS_LABELS[version.status] ?? version.status}</p>
              </div>
              <div>
                <p className="text-xs text-secondary">Published</p>
                <p className="mt-0.5 text-sm text-ink">
                  {version.approved_at ? formatParticipantDate(version.approved_at) : 'Not published'}
                </p>
              </div>
              <div>
                <p className="text-xs text-secondary">Created by</p>
                <p className="mt-0.5 text-sm text-ink">{version.creator?.full_name || 'Unknown user'}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </AccessibleDialog>
  )
}

const PARTICIPANT_STATUS_LABELS = { enrolled: 'Enrolled', started: 'Started', complete: 'Complete' }

function formatParticipantDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
}

function CourseParticipantsDialog({ course, onClose }) {
  const [participants, setParticipants] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    listCourseParticipants(course.id)
      .then(setParticipants)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [course.id])

  return (
    <AccessibleDialog
      labelledBy="course-participants-title"
      onClose={onClose}
      panelClassName="w-full max-w-3xl max-h-[90vh] overflow-y-auto overscroll-contain rounded-lg border border-hairline bg-card p-5 sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="course-participants-title" className="font-display text-xl text-ink">{course.name} participants</h2>
          <p className="mt-1 text-sm text-secondary">Enrolment, progress and completion for this course.</p>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 text-sm text-secondary hover:text-ink">Close</button>
      </div>

      {loading && <p role="status" className="mt-6 text-sm text-secondary">Loading participants…</p>}
      {error && <p role="alert" className="mt-6 text-sm text-red-700">Couldn’t load participants: {error}</p>}
      {!loading && !error && participants.length === 0 && (
        <p className="mt-6 rounded-md border border-dashed border-hairline px-4 py-8 text-center text-sm text-secondary">
          No one has enrolled in this course yet.
        </p>
      )}
      {!loading && !error && participants.length > 0 && (
        <ul className="mt-5 divide-y divide-hairline border-y border-hairline">
          {participants.map((participant) => (
            <li key={participant.id} className="py-4">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-paper border border-hairline flex items-center justify-center">
                  {participant.profile?.avatar_url ? (
                    <img src={participant.profile.avatar_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-sm font-medium text-secondary">{participant.profile?.full_name?.[0]?.toUpperCase() ?? '?'}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-ink">{participant.profile?.full_name || 'Unnamed participant'}</p>
                    <span className="rounded-full border border-hairline px-2 py-0.5 text-xs font-medium text-secondary">
                      {PARTICIPANT_STATUS_LABELS[participant.status]}
                    </span>
                  </div>
                  {participant.status !== 'enrolled' ? (
                    <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between text-xs text-secondary">
                        <span>{participant.percent}% complete</span>
                        <span className="tabular-nums">Started {formatParticipantDate(participant.startedAt)}</span>
                      </div>
                      <ProgressBar percent={participant.status === 'complete' ? 100 : participant.percent} />
                      <p className="mt-2 text-xs text-secondary tabular-nums">
                        End date: {formatParticipantDate(participant.completed_date)}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-secondary tabular-nums">Enrolled {formatParticipantDate(participant.created_at)}</p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AccessibleDialog>
  )
}
