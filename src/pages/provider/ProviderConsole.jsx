import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import AppHeader from '../../components/AppHeader'
import { OrganisationStaffPanel } from '../admin/AdminProviders'
import ResourceLibrarySection from '../../components/ResourceLibrarySection'
import ProviderSkillsSection from '../../components/ProviderSkillsSection'
import OrganisationSettingsModal from '../../components/OrganisationSettingsModal'
import AccessibleDialog from '../../components/AccessibleDialog'
import ConfirmDialog from '../../components/ConfirmDialog'
import ProgressBar from '../../components/ProgressBar'
import {
  createProviderCatalogue,
  deleteProviderCatalogue,
  listProviderCatalogues,
  updateProviderCatalogue,
} from '../../lib/catalogues'
import { listOrganisations, listOrganisationMembers } from '../../lib/admin/organisations'
import {
  listOrganisationCatalogueCourses,
  createProviderCourse,
  listCourseParticipants,
  listCourseVersionHistory,
  createDraftCourseVersion,
  listOrganisationCatalogueApprovers,
  listCatalogueApprovers,
  addCatalogueApprover,
  removeCatalogueApprover,
  approveCatalogueCourse,
  rejectCatalogueCourse,
  deactivateCatalogueCourse,
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
  { key: 'skills', label: 'Skills' },
  { key: 'catalogues', label: 'Catalogues' },
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
  const location = useLocation()
  const [organisations, setOrganisations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedOrgId, setSelectedOrgId] = useState(location.state?.organisationId ?? null)
  const [activeSection, setActiveSection] = useState(location.state?.providerSection ?? 'training')
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
  // Guards against a stale staff tab surviving an organisation switch.
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
                {currentSection === 'catalogues' && (
                  <ProviderCataloguesSection key={selectedOrg.id} organisation={selectedOrg} userId={user.id} canCreate={myRole === 'admin'} />
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

function ProviderCataloguesSection({ organisation, userId, canCreate }) {
  const [catalogues, setCatalogues] = useState([])
  const [form, setForm] = useState({ name: '', description: '' })
  const [editingId, setEditingId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteTargetPublishedCount] = useState(0)
  const [deleting, setDeleting] = useState(false)

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

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      await deleteProviderCatalogue(deleteTarget.id)
      if (expandedId === deleteTarget.id) setExpandedId(null)
      setDeleteTarget(null)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section aria-labelledby="provider-catalogues-heading">
      <div className="mb-5">
        <h2 id="provider-catalogues-heading" className="font-display text-lg text-ink">Provider catalogues</h2>
        <p className="text-sm text-secondary mt-1 max-w-2xl">
          Organise published training into named collections. Your catalogues and the platform-managed Global catalogue are available whenever a course is submitted. Each catalogue can have its own approvers, picked from your organisation's own users, so training destined for it can be approved without a platform admin.
        </p>
      </div>

      {error && <p role="alert" className="text-sm text-red-700 mb-4">{error}</p>}

      {canCreate && <form onSubmit={handleSubmit} className="bg-card border border-hairline rounded-lg p-4 mb-6">
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
      </form>}

      {loading ? (
        <p role="status" className="text-sm text-secondary">Loading catalogues…</p>
      ) : catalogues.length === 0 ? (
        <div className="rounded-lg border border-dashed border-hairline py-10 text-center">
          <p className="text-sm text-secondary">No provider catalogues yet.</p>
        </div>
      ) : (
        <div className="divide-y divide-hairline border-y border-hairline">
          {catalogues.map((catalogue) => (
            <div key={catalogue.id}>
              <div className="flex items-start justify-between gap-4 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{catalogue.name}</p>
                  {catalogue.description && <p className="text-xs text-secondary mt-1">{catalogue.description}</p>}
                </div>
                <Link to={`/provider/catalogues/${catalogue.id}`} className="shrink-0 text-xs font-medium text-moss hover:underline">Open catalogue →</Link>
              </div>
              {expandedId === catalogue.id && (
                <CatalogueApproversPanel catalogueId={catalogue.id} organisationId={organisation.id} />
              )}
            </div>
          ))}
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          message={
            deleteTargetPublishedCount > 0
              ? `Delete the "${deleteTarget.name}" catalogue? ${deleteTargetPublishedCount} currently live ${
                  deleteTargetPublishedCount === 1 ? 'course is' : 'courses are'
                } published there -- ${
                  deleteTargetPublishedCount === 1 ? 'it' : 'they'
                } will disappear from it, and may become invisible to learners entirely if this was its only destination.`
              : `Delete the "${deleteTarget.name}" catalogue? Courses currently published there will no longer appear in it.`
          }
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          confirming={deleting}
        />
      )}
    </section>
  )
}

function CatalogueApproversPanel({ catalogueId, organisationId }) {
  const { user } = useAuth()
  const [members, setMembers] = useState([])
  const [approvers, setApprovers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [togglingUserId, setTogglingUserId] = useState(null)

  useEffect(() => {
    load()
  }, [catalogueId])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [memberList, approverList] = await Promise.all([
        listOrganisationMembers(organisationId),
        listCatalogueApprovers(catalogueId),
      ])
      setMembers(memberList.filter((m) => m.status === 'active'))
      setApprovers(approverList)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleToggle(member, isApprover) {
    setTogglingUserId(member.user_id)
    setError(null)
    try {
      if (isApprover) {
        const row = approvers.find((a) => a.user_id === member.user_id)
        if (row) await removeCatalogueApprover(row.id)
      } else {
        await addCatalogueApprover(catalogueId, member.user_id, user.id)
      }
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setTogglingUserId(null)
    }
  }

  return (
    <div className="border-t border-hairline bg-paper p-4 space-y-2 mb-2">
      {error && <p className="text-xs text-red-700">{error}</p>}
      {loading ? (
        <p className="text-xs text-secondary">Loading users…</p>
      ) : members.length === 0 ? (
        <p className="text-xs text-secondary">No users yet.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {members.map((m) => {
            const isApprover = approvers.some((a) => a.user_id === m.user_id)
            return (
              <li key={m.user_id} className="flex items-center justify-between gap-2 text-sm py-2">
                <span className="text-ink text-xs truncate">{m.email || m.user_id}</span>
                <label className="flex items-center gap-1.5 text-xs text-secondary shrink-0">
                  <input
                    type="checkbox"
                    checked={isApprover}
                    disabled={togglingUserId === m.user_id}
                    onChange={() => handleToggle(m, isApprover)}
                    className="rounded border-hairline"
                  />
                  Approver
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function ProviderTrainingSection({ organisation, userId, canViewParticipants }) {
  const navigate = useNavigate()
  const [courses, setCourses] = useState([])
  const [isApprover, setIsApprover] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [creating, setCreating] = useState(false)
  const [actioningId, setActioningId] = useState(null)
  const [rejectingId, setRejectingId] = useState(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [participantCourse, setParticipantCourse] = useState(null)
  const [historyCourse, setHistoryCourse] = useState(null)
  const [creatingDraftCourseId, setCreatingDraftCourseId] = useState(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => {
    load()
  }, [organisation.id])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [courseList, approvers] = await Promise.all([
        listOrganisationCatalogueCourses(organisation.id),
        listOrganisationCatalogueApprovers(organisation.id),
      ])
      setCourses(courseList)
      setIsApprover(approvers.some((a) => a.user_id === userId))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleApprove(course) {
    setActioningId(course.id)
    setError(null)
    try {
      await approveCatalogueCourse(course.id)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setActioningId(null)
    }
  }

  async function handleReject(course) {
    setActioningId(course.id)
    setError(null)
    try {
      await rejectCatalogueCourse(course.id, rejectionReason.trim())
      setRejectingId(null)
      setRejectionReason('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setActioningId(null)
    }
  }

  async function handleDeactivate(course) {
    setActioningId(course.id)
    setError(null)
    try {
      await deactivateCatalogueCourse(course.id)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setActioningId(null)
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

  const filteredCourses = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return courses.filter(
      (course) =>
        (statusFilter === 'all' || course.status === statusFilter) &&
        (!needle || [course.name, course.course_code, course.synopsis, course.course_type].filter(Boolean).some((value) => value.toLowerCase().includes(needle)))
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
            <CourseCard
              key={course.id}
              course={course}
              canModerate={isApprover}
              actioning={actioningId === course.id}
              rejecting={rejectingId === course.id}
              rejectionReason={rejectionReason}
              onRejectionReasonChange={setRejectionReason}
              onStartReject={() => setRejectingId(course.id)}
              onCancelReject={() => {
                setRejectingId(null)
                setRejectionReason('')
              }}
              onApprove={() => handleApprove(course)}
              onReject={() => handleReject(course)}
              onDeactivate={() => handleDeactivate(course)}
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
// canModerate mirrors AdminCatalogue.jsx's own approve/reject/deactivate/
// reactivate actions, just scoped here to a designated catalogue approver
// acting on their own organisation's submissions.
function CourseCard({
  course,
  canViewParticipants,
  onViewParticipants,
  onViewHistory,
  onEdit,
  creatingDraft,
  canModerate,
  actioning,
  rejecting,
  rejectionReason,
  onRejectionReasonChange,
  onStartReject,
  onCancelReject,
  onApprove,
  onReject,
  onDeactivate,
}) {
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

      {canModerate && (
        <div className="mt-3 pt-2 border-t border-hairline flex flex-wrap items-center gap-2">
          {(course.status === 'pending_approval' || course.status === 'draft') && (
            <>
              <button
                type="button"
                disabled={actioning}
                onClick={onApprove}
                className="rounded-md bg-moss text-paper py-1 px-3 text-xs font-medium hover:opacity-90 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={actioning}
                onClick={onStartReject}
                className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-50"
              >
                Reject
              </button>
            </>
          )}
          {course.status === 'approved' && (
            <button
              type="button"
              disabled={actioning}
              onClick={onDeactivate}
              className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-50"
            >
              Deactivate
            </button>
          )}
          {(course.status === 'inactive' || course.status === 'rejected') && (
            <button
              type="button"
              disabled={actioning}
              onClick={onApprove}
              className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-50"
            >
              Reactivate (approve)
            </button>
          )}

          {rejecting && (
            <div className="w-full flex flex-wrap items-end gap-2 mt-1">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs text-secondary mb-1">Rejection reason (optional)</label>
                <input
                  value={rejectionReason}
                  onChange={(e) => onRejectionReasonChange(e.target.value)}
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
              </div>
              <button
                type="button"
                onClick={onReject}
                className="rounded-md bg-red-700 text-white py-1.5 px-3 text-sm font-medium hover:bg-red-800"
              >
                Confirm reject
              </button>
              <button type="button" onClick={onCancelReject} className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm hover:bg-paper">
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
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
