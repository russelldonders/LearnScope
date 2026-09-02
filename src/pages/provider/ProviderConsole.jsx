import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
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
  listPublicationCatalogueOptions,
  updateProviderCatalogue,
} from '../../lib/catalogues'
// listProviderCatalogues specifically comes from admin/providerCatalogues.js,
// not the same-named function in lib/catalogues.js -- only this version
// attaches courseCount (course_catalogue_publications count) to each row,
// which the bulk-delete confirmation below needs to warn accurately about
// live courses. The lib/catalogues.js version returns a plain column
// select with no aggregate counts.
import { assignProviderCourseToCatalogue, listProviderCatalogues } from '../../lib/admin/providerCatalogues'
import { listOrganisations, listOrganisationMembers } from '../../lib/admin/organisations'
import { listEmployers } from '../../lib/admin/employers'
import { useRowSelection, useSortedPage } from '../../lib/useSortedPage'
import { handleTabListKeyDown } from '../../lib/tabsKeyboard'
import { COURSE_STATUS_LABELS } from '../../lib/statusLabels'
import { BulkActionBar, SelectionTh, SortableTh, TablePagination } from '../../components/TableControls'
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

const COURSE_SORT_ACCESSORS = {
  course_code: (c) => c.course_code?.toLowerCase() ?? '',
  name: (c) => c.name?.toLowerCase() ?? '',
  version: (c) => c.version_number ?? 0,
  status: (c) => COURSE_STATUS_LABELS[c.status] ?? c.status,
  rejection_reason: (c) => c.rejection_reason?.toLowerCase() ?? '',
  synopsis: (c) => c.synopsis?.toLowerCase() ?? '',
}

const CATALOGUE_SORT_ACCESSORS = {
  id: (c) => c.id ?? '',
  name: (c) => c.name?.toLowerCase() ?? '',
  description: (c) => c.description?.toLowerCase() ?? '',
}

// Mirrors the single-delete confirmation's own published-count warning
// (see ProviderCataloguesSection's deleteTarget dialog) but built from the
// courseCount field listProviderCatalogues already attaches to each row,
// rather than the deleteTargetPublishedCount state that dialog never
// actually populates.
function buildBulkCatalogueDeleteMessage(targets) {
  const label = targets.length === 1 ? 'catalogue' : 'catalogues'
  const withCourses = targets.filter((c) => (c.courseCount ?? 0) > 0)
  if (withCourses.length === 0) {
    return `Delete ${targets.length} ${label}? Courses currently published there will no longer appear in it.`
  }
  const totalCourses = withCourses.reduce((sum, c) => sum + (c.courseCount ?? 0), 0)
  return (
    `Delete ${targets.length} ${label}? ${withCourses.length} of ${
      targets.length === 1 ? 'it currently has' : 'them currently have'
    } courses published there (${totalCourses} course${totalCourses === 1 ? '' : 's'} total) -- ${
      totalCourses === 1 ? 'it' : 'they'
    } will disappear from that catalogue, and may become invisible to learners entirely if this was its only destination.`
  )
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
  const { user, organisationMemberships, employerMemberships } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [organisations, setOrganisations] = useState([])
  const [employers, setEmployers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // org/section selection lives in the URL (?org=&section=) rather than
  // component state, so refresh, browser Back/Forward, and a shared link
  // all land on the same view -- see CLAUDE.md-linked Phase 1 Slice 3 nav
  // audit. selectedOrgId/activeSection below are re-derived from
  // searchParams on every render (not seeded once), so Back/Forward
  // navigating between two ?org=/?section= values actually updates the view.
  const selectedOrgId = searchParams.get('org')
  const activeSection = searchParams.get('section') ?? 'training'
  const [showSettings, setShowSettings] = useState(false)
  const orgTabRefs = useRef({})
  const sectionTabRefs = useRef({})

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
    // listEmployers() is already scoped by RLS to employers this user
    // actually belongs to -- best-effort here, since not being able to show
    // the "Employer console" cross-link shouldn't take down this page.
    listEmployers()
      .then(setEmployers)
      .catch(() => {})
  }, [])

  // The employer (if any) whose auto-provisioned provider org this actually
  // is, where the current user also holds an active employer_members admin
  // role -- mirrors the matching check EmployerConsole.jsx does in reverse,
  // so the "move back and forth" link only ever appears when it would
  // genuinely lead somewhere the user can act, not just view.
  const linkedEmployer = employers.find(
    (e) =>
      e.provider_organisation_id === selectedOrgId &&
      (employerMemberships ?? []).some((m) => m.employer_id === e.id && m.role === 'admin')
  )

  function reloadOrganisations() {
    return listOrganisations()
      .then((data) => setOrganisations(data))
      .catch((err) => setError(err.message))
  }

  // Defaults ?org= to the first available organisation whenever it's
  // absent, or points at one this user no longer has active access to
  // (e.g. a stale bookmark for a deactivated org) -- replace: true so this
  // correction doesn't itself become a Back-button stop.
  useEffect(() => {
    if (myOrgs.length > 0 && !myOrgs.some((o) => o.id === selectedOrgId)) {
      setSearchParams(buildParams({ org: myOrgs[0].id }), { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myOrgs, selectedOrgId])

  const visibleSections = SECTIONS.filter((s) => !s.adminOnly || myRole === 'admin')

  // Builds the next ?org=&section= query string, preserving whichever of
  // the two isn't being changed -- shared by every tab Link and by the
  // keyboard-nav onChange below so arrow-key and click navigation land on
  // the exact same URL shape.
  function buildParams(overrides) {
    const next = new URLSearchParams(searchParams)
    Object.entries(overrides).forEach(([key, value]) => {
      if (value === null || value === undefined) next.delete(key)
      else next.set(key, value)
    })
    return next
  }

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
              <div role="tablist" aria-label="Organisation" className="flex items-center flex-wrap gap-1 mb-4 border-b border-hairline">
                {myOrgs.map((org) => (
                  <Link
                    key={org.id}
                    ref={(el) => { orgTabRefs.current[org.id] = el }}
                    id={`provider-org-tab-${org.id}`}
                    to={`?${buildParams({ org: org.id }).toString()}`}
                    role="tab"
                    aria-selected={selectedOrgId === org.id}
                    aria-controls={`provider-org-panel-${org.id}`}
                    tabIndex={selectedOrgId === org.id ? 0 : -1}
                    onKeyDown={(event) =>
                      handleTabListKeyDown(event, {
                        keys: myOrgs.map((o) => o.id),
                        activeKey: selectedOrgId,
                        refs: orgTabRefs,
                        onChange: (orgId) => setSearchParams(buildParams({ org: orgId })),
                      })
                    }
                    className={`text-sm px-3 py-2 -mb-px border-b-2 whitespace-nowrap ${
                      selectedOrgId === org.id
                        ? 'border-moss text-ink font-medium'
                        : 'border-transparent text-secondary hover:text-ink'
                    }`}
                  >
                    {org.name}
                  </Link>
                ))}
              </div>
            )}

            {selectedOrg && (
              <div
                {...(myOrgs.length > 1
                  ? {
                      role: 'tabpanel',
                      id: `provider-org-panel-${selectedOrg.id}`,
                      'aria-labelledby': `provider-org-tab-${selectedOrg.id}`,
                      tabIndex: 0,
                    }
                  : {})}
              >
                <div className="flex items-center justify-between gap-2 mb-6 border-b border-hairline">
                  <div className="flex items-center flex-wrap gap-1">
                    <div role="tablist" aria-label="Console section" className="flex items-center flex-wrap gap-1">
                      {visibleSections.map((section) => (
                        <Link
                          key={section.key}
                          ref={(el) => { sectionTabRefs.current[section.key] = el }}
                          id={`provider-section-tab-${section.key}`}
                          to={`?${buildParams({ section: section.key }).toString()}`}
                          role="tab"
                          aria-selected={currentSection === section.key}
                          aria-controls={`provider-section-panel-${section.key}`}
                          tabIndex={currentSection === section.key ? 0 : -1}
                          onKeyDown={(event) =>
                            handleTabListKeyDown(event, {
                              keys: visibleSections.map((s) => s.key),
                              activeKey: currentSection,
                              refs: sectionTabRefs,
                              onChange: (sectionKey) => setSearchParams(buildParams({ section: sectionKey })),
                            })
                          }
                          className={`text-sm px-3 py-2 -mb-px border-b-2 whitespace-nowrap ${
                            currentSection === section.key
                              ? 'border-moss text-ink font-medium'
                              : 'border-transparent text-secondary hover:text-ink'
                          }`}
                        >
                          {section.label}
                        </Link>
                      ))}
                    </div>
                    {linkedEmployer && (
                      <>
                        <span className="mx-1 h-5 w-px bg-hairline shrink-0" aria-hidden="true" />
                        <Link
                          to={`/employer?employer=${linkedEmployer.id}`}
                          className="text-sm px-3 py-2 -mb-px border-b-2 border-transparent whitespace-nowrap text-gold hover:border-gold"
                        >
                          ← {linkedEmployer.name} employer console
                        </Link>
                      </>
                    )}
                  </div>
                  {myRole === 'admin' && (
                    <button
                      type="button"
                      onClick={() => setShowSettings(true)}
                      title="Organisation settings"
                      aria-label="Organisation settings"
                      className="shrink-0 mb-2 w-11 h-11 rounded-md border border-hairline text-secondary hover:text-ink hover:bg-paper flex items-center justify-center"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                      </svg>
                    </button>
                  )}
                </div>

                <div
                  id={`provider-section-panel-${currentSection}`}
                  role="tabpanel"
                  aria-labelledby={`provider-section-tab-${currentSection}`}
                  tabIndex={0}
                >
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

// Exported so the employer console (src/pages/employer/EmployerConsole.jsx)
// can reuse the same catalogue-authoring UI verbatim, scoped to the
// employer's own auto-provisioned attached provider organisation -- this
// component only ever reads/writes off organisation.id, so no fork is
// needed.
export function ProviderCataloguesSection({ organisation, userId, canCreate, readOnly = false }) {
  // readOnly (employer console reuse) always wins over canCreate -- an
  // employer admin genuinely has the provider org role canCreate is
  // derived from, but authoring here is disabled regardless; see
  // ProviderTrainingSection's identical canModerate/showCreateUI pattern
  // below for the same reasoning.
  const showCreateUI = canCreate && !readOnly
  const [catalogues, setCatalogues] = useState([])
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [form, setForm] = useState({ name: '', description: '' })
  const [editingId, setEditingId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteTargetPublishedCount] = useState(0)
  const [deleting, setDeleting] = useState(false)
  const [bulkDeleteTargets, setBulkDeleteTargets] = useState(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(catalogues, CATALOGUE_SORT_ACCESSORS)
  const selection = useRowSelection(catalogues.map((c) => c.id))
  const pageIds = pageItems.map((c) => c.id)
  const selectedOnPage = pageIds.filter((id) => selection.selected.has(id)).length

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
      setShowCreateForm(false)
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

  async function handleBulkDelete() {
    const targets = bulkDeleteTargets
    setBulkDeleting(true)
    setError(null)
    try {
      const results = await Promise.allSettled(targets.map((catalogue) => deleteProviderCatalogue(catalogue.id)))
      const failures = results
        .map((result, index) => ({ result, catalogue: targets[index] }))
        .filter(({ result }) => result.status === 'rejected')
      const succeededIds = targets
        .filter((_, index) => results[index].status === 'fulfilled')
        .map((catalogue) => catalogue.id)
      // Only collapse the expanded approvers panel if its catalogue was
      // actually deleted -- if that particular delete failed, the catalogue
      // still exists and the panel should stay put.
      if (expandedId && succeededIds.includes(expandedId)) setExpandedId(null)
      setBulkDeleteTargets(null)
      // Full success clears the whole selection; a partial failure keeps
      // the still-undeleted catalogues selected so they're easy to retry.
      if (failures.length > 0) selection.clearIds(succeededIds)
      else selection.clear()
      await load()
      if (failures.length > 0) {
        setError(
          `${failures.length} of ${targets.length} catalogues couldn't be deleted: ` +
            failures
              .map(({ catalogue, result }) => `"${catalogue.name}" (${result.reason?.message ?? 'unknown error'})`)
              .join('; ')
        )
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBulkDeleting(false)
    }
  }

  return (
    <section aria-labelledby="provider-catalogues-heading">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 id="provider-catalogues-heading" className="font-display text-lg text-ink">Provider catalogues</h2>
          <p className="text-sm text-secondary mt-1 max-w-2xl">
            Organise published training into named collections. Your catalogues and the platform-managed Global catalogue are available whenever a course is submitted. Each catalogue can have its own approvers, picked from your organisation's own users, so training destined for it can be approved without a platform admin.
          </p>
        </div>
        {showCreateUI && (
          <button
            type="button"
            onClick={() => setShowCreateForm((v) => !v)}
            className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 shrink-0"
          >
            {showCreateForm ? 'Cancel' : '+ Create catalogue'}
          </button>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-red-700 mb-4">{error}</p>}

      {showCreateUI && (showCreateForm || editingId) && <form onSubmit={handleSubmit} className="bg-card border border-hairline rounded-lg p-4 mb-6">
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
          <button type="button" onClick={() => { setEditingId(null); setShowCreateForm(false); setForm({ name: '', description: '' }) }} className="rounded-md border border-hairline px-3 py-1.5 text-sm text-ink hover:bg-paper">Cancel</button>
        </div>
      </form>}

      {loading ? (
        <p role="status" className="text-sm text-secondary">Loading catalogues…</p>
      ) : catalogues.length === 0 ? (
        <div className="rounded-lg border border-dashed border-hairline py-10 text-center">
          <p className="text-sm text-secondary">No provider catalogues yet.</p>
        </div>
      ) : (
        <div className="bg-card border border-hairline rounded-lg">
          {!readOnly && (
            <div className="p-3 pb-0">
              <BulkActionBar
                count={selection.selected.size}
                onClear={selection.clear}
                busy={bulkDeleting}
                actions={[
                  {
                    label: `Delete selected (${selection.selected.size})`,
                    variant: 'danger',
                    onClick: () => setBulkDeleteTargets(catalogues.filter((c) => selection.selected.has(c.id))),
                  },
                ]}
              />
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-secondary">
                  {!readOnly && (
                    <SelectionTh
                      idPrefix="provider-catalogues"
                      checked={selection.isAllSelected(pageIds)}
                      indeterminate={selectedOnPage > 0 && selectedOnPage < pageIds.length}
                      onChange={() => selection.toggleAll(pageIds)}
                    />
                  )}
                  <SortableTh label="ID" columnKey="id" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                  <SortableTh label="Catalogue" columnKey="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Description" columnKey="description" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((catalogue) => (
                  <Fragment key={catalogue.id}>
                    <tr className="border-b border-hairline last:border-0">
                      {!readOnly && (
                        <td className="px-4 py-3">
                          <label className="sr-only" htmlFor={`select-catalogue-${catalogue.id}`}>Select {catalogue.name}</label>
                          <input
                            id={`select-catalogue-${catalogue.id}`}
                            type="checkbox"
                            checked={selection.selected.has(catalogue.id)}
                            onChange={() => selection.toggle(catalogue.id)}
                            className="rounded border-hairline accent-moss"
                          />
                        </td>
                      )}
                      <td className="px-4 py-3 font-mono text-xs text-secondary whitespace-nowrap">{catalogue.id.slice(0, 8)}</td>
                      <td className="px-4 py-3 text-ink font-medium whitespace-nowrap">{catalogue.name}</td>
                      <td className="px-4 py-3 text-secondary truncate max-w-xs">{catalogue.description || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <Link to={`/provider/catalogues/${catalogue.id}`} className="text-xs font-medium text-moss hover:underline whitespace-nowrap">
                          Open catalogue →
                        </Link>
                      </td>
                    </tr>
                    {expandedId === catalogue.id && (
                      <tr className="border-b border-hairline last:border-0">
                        <td colSpan={readOnly ? 4 : 5} className="px-4 pb-3">
                          <CatalogueApproversPanel catalogueId={catalogue.id} organisationId={organisation.id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} totalItems={totalItems} idPrefix="provider-catalogues" />
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

      {bulkDeleteTargets && (
        <ConfirmDialog
          message={buildBulkCatalogueDeleteMessage(bulkDeleteTargets)}
          confirmLabel="Delete"
          onConfirm={handleBulkDelete}
          onCancel={() => setBulkDeleteTargets(null)}
          confirming={bulkDeleting}
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

// Exported for the same reason as ProviderCataloguesSection above -- reused
// verbatim by the employer console's Training tab.
export function ProviderTrainingSection({ organisation, userId, canViewParticipants, readOnly = false }) {
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
  const [bulkPush, setBulkPush] = useState(null)

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

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(filteredCourses, COURSE_SORT_ACCESSORS)
  const selection = useRowSelection(filteredCourses.map((c) => c.id))
  const coursePageIds = pageItems.map((c) => c.id)
  const coursesSelectedOnPage = coursePageIds.filter((id) => selection.selected.has(id)).length
  // Only an approved, currently-published version can be added to a
  // catalogue (assign_course_to_catalogue RPC, 20260831124500) -- the same
  // precondition the single-course "Push to catalogue" button already
  // enforces by only showing itself once a course reaches that state.
  const selectedEligibleCourses = useMemo(
    () => courses.filter((c) => selection.selected.has(c.id) && c.status === 'approved' && c.is_current_published),
    [courses, selection.selected]
  )
  const selectedIneligibleCourses = useMemo(
    () => courses.filter((c) => selection.selected.has(c.id) && !(c.status === 'approved' && c.is_current_published)),
    [courses, selection.selected]
  )

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="font-display text-lg text-ink">Training</h3>
        {!readOnly && (
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90"
          >
            {showForm ? 'Cancel' : '+ Create training'}
          </button>
        )}
      </div>

      {!readOnly && showForm && (
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
          {Object.entries(COURSE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
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
        <div className="bg-card border border-hairline rounded-lg">
          {!readOnly && (
            <div className="p-3 pb-0">
              <BulkActionBar
                count={selection.selected.size}
                onClear={selection.clear}
                actions={[
                  {
                    label: `Push to catalogue (${selectedEligibleCourses.length})`,
                    disabled: selectedEligibleCourses.length === 0,
                    title:
                      selectedEligibleCourses.length === 0
                        ? "None of the selected training is an approved, currently published version"
                        : undefined,
                    onClick: () =>
                      setBulkPush({
                        courses: selectedEligibleCourses,
                        excludedCourses: selectedIneligibleCourses,
                      }),
                  },
                ]}
              />
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-secondary">
                  {!readOnly && (
                    <SelectionTh
                      idPrefix="provider-training"
                      checked={selection.isAllSelected(coursePageIds)}
                      indeterminate={coursesSelectedOnPage > 0 && coursesSelectedOnPage < coursePageIds.length}
                      onChange={() => selection.toggleAll(coursePageIds)}
                    />
                  )}
                  <SortableTh label="ID" columnKey="course_code" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                  <SortableTh label="Training" columnKey="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Version" columnKey="version" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                  <SortableTh label="Status" columnKey="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                  <SortableTh label="Rejection reason" columnKey="rejection_reason" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Synopsis" columnKey="synopsis" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((course) => (
                  <CourseRow
                    key={course.id}
                    course={course}
                    selected={selection.selected.has(course.id)}
                    onToggleSelected={() => selection.toggle(course.id)}
                    canModerate={isApprover && !readOnly}
                    readOnly={readOnly}
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
              </tbody>
            </table>
          </div>
          <TablePagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} totalItems={totalItems} idPrefix="provider-training" />
        </div>
      )}

      {participantCourse && (
        <CourseParticipantsDialog course={participantCourse} onClose={() => setParticipantCourse(null)} />
      )}
      {historyCourse && (
        <CourseVersionHistoryDialog course={historyCourse} onClose={() => setHistoryCourse(null)} />
      )}
      {bulkPush && (
        <BulkPushToCatalogueDialog
          organisationId={organisation.id}
          courses={bulkPush.courses}
          excludedCourses={bulkPush.excludedCourses}
          onClose={() => setBulkPush(null)}
          onDone={(succeededCourseIds, hadFailures) => {
            // Called right after the push attempt settles, whether or not
            // it fully succeeded -- a partial failure still means some
            // courses actually got added, so this reloads and drops just
            // the ones that succeeded from the selection, leaving the
            // still-failed ones selected for an easy retry (the dialog
            // itself stays open in that case to show which failed and
            // why). A full success clears the whole selection, including
            // any ineligible rows that were never attempted, and the
            // dialog closes itself right after this callback returns.
            if (hadFailures) selection.clearIds(succeededCourseIds)
            else selection.clear()
            load()
          }}
        />
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
// acting on their own organisation's submissions. A table row (mirroring
// AdminUsers.jsx's list) rather than the card grid this replaced -- a
// provider with more than a handful of courses could no longer scan
// name/code/status across many cards at once.
function CourseRow({
  course,
  selected,
  onToggleSelected,
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
  readOnly,
}) {
  const editable = course.status === 'draft' || course.status === 'rejected'
  const canStartEditing = !readOnly && (editable || course.status === 'approved')
  const columnCount = readOnly ? 7 : 8
  return (
    <>
      <tr className="border-b border-hairline last:border-0">
        {!readOnly && (
          <td className="px-4 py-3">
            <label className="sr-only" htmlFor={`select-course-${course.id}`}>Select {course.name}</label>
            <input
              id={`select-course-${course.id}`}
              type="checkbox"
              checked={selected}
              onChange={onToggleSelected}
              className="rounded border-hairline accent-moss"
            />
          </td>
        )}
        <td className="px-4 py-3 font-mono text-xs text-secondary whitespace-nowrap">{course.course_code || 'Not set'}</td>
        <td className="px-4 py-3 whitespace-nowrap">
          <Link to={`/provider/training/${course.id}`} className="text-ink font-medium hover:text-moss hover:underline">
            {course.name}
          </Link>
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">{course.version_number}</span>
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">{COURSE_STATUS_LABELS[course.status] ?? course.status}</span>
        </td>
        <td className="px-4 py-3 text-red-700 truncate max-w-[180px]">{course.rejection_reason || '—'}</td>
        <td className="px-4 py-3 text-secondary truncate max-w-xs">{course.synopsis || '—'}</td>
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-x-3 whitespace-nowrap">
            {canStartEditing ? (
              <button
                type="button"
                onClick={onEdit}
                disabled={creatingDraft}
                className="text-xs font-medium text-moss hover:underline disabled:cursor-wait disabled:opacity-60 whitespace-nowrap"
              >
                {creatingDraft ? 'Creating new version…' : 'Edit course'}
              </button>
            ) : (
              <Link to={`/provider/training/${course.id}`} className="text-xs font-medium text-moss hover:underline whitespace-nowrap">
                View course
              </Link>
            )}
            <button type="button" onClick={onViewHistory} className="text-xs font-medium text-moss hover:underline whitespace-nowrap">
              Version history
            </button>
            {canViewParticipants && (
              <button type="button" onClick={onViewParticipants} className="text-xs font-medium text-moss hover:underline whitespace-nowrap">
                View participants
              </button>
            )}
            {canModerate && (course.status === 'pending_approval' || course.status === 'draft') && (
              <>
                <button
                  type="button"
                  disabled={actioning}
                  onClick={onApprove}
                  className="rounded-md bg-moss text-paper py-1 px-3 text-xs font-medium hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={actioning}
                  onClick={onStartReject}
                  className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-50 whitespace-nowrap"
                >
                  Reject
                </button>
              </>
            )}
            {canModerate && course.status === 'approved' && (
              <button
                type="button"
                disabled={actioning}
                onClick={onDeactivate}
                className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-50 whitespace-nowrap"
              >
                Deactivate
              </button>
            )}
            {canModerate && (course.status === 'inactive' || course.status === 'rejected') && (
              <button
                type="button"
                disabled={actioning}
                onClick={onApprove}
                className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-50 whitespace-nowrap"
              >
                Reactivate (approve)
              </button>
            )}
          </div>
        </td>
      </tr>
      {rejecting && (
        <tr className="border-b border-hairline last:border-0">
          <td colSpan={columnCount} className="px-4 pb-3">
            <div className="flex flex-wrap items-end gap-2 border-t border-hairline pt-3">
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
          </td>
        </tr>
      )}
    </>
  )
}

// Bulk counterpart to ProviderCourseEditor's own PushToCatalogueDialog --
// same assignProviderCourseToCatalogue call, looped once per selected
// course, but only ever offers a single catalogue destination at a time
// (the per-course dialog lets several be ticked because it's already
// scoped to one course; picking several catalogues *and* several courses
// at once would make the excluded/failed summary below unreadable). Courses
// that didn't pass the eligibility check the caller already applied
// (status !== 'approved' or not is_current_published) never reach here --
// excludedCourses only reports which of those were dropped and why, so the
// provider isn't left guessing why the count doesn't match their selection.
function BulkPushToCatalogueDialog({ organisationId, courses, excludedCourses, onClose, onDone }) {
  const [catalogues, setCatalogues] = useState([])
  const [catalogueId, setCatalogueId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    listPublicationCatalogueOptions(organisationId)
      .then(setCatalogues)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [organisationId])

  async function handlePush() {
    if (!catalogueId || courses.length === 0) return
    setSubmitting(true)
    setError(null)
    try {
      const results = await Promise.allSettled(
        courses.map((course) => assignProviderCourseToCatalogue(catalogueId, course.id))
      )
      const succeeded = courses.filter((_, index) => results[index].status === 'fulfilled')
      const failures = results
        .map((result, index) => ({ result, course: courses[index] }))
        .filter(({ result }) => result.status === 'rejected')
      // Reload/update the parent's selection regardless of outcome -- a
      // partial failure still means some courses were actually added, so
      // the caller shouldn't stay stale (or lose track of which succeeded)
      // just because this dialog is staying open to show the failures.
      onDone(succeeded.map((course) => course.id), failures.length > 0)
      if (failures.length > 0) {
        setError(
          `${failures.length} of ${courses.length} courses couldn't be added: ` +
            failures
              .map(({ course, result }) => `"${course.name}" (${result.reason?.message ?? 'unknown error'})`)
              .join('; ')
        )
        return
      }
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="bulk-push-catalogue-title"
      describedBy="bulk-push-catalogue-description"
      onClose={submitting ? undefined : onClose}
      closeOnBackdrop={!submitting}
      panelClassName="w-full max-w-lg rounded-xl bg-card border border-hairline p-5 shadow-xl"
    >
      <h2 id="bulk-push-catalogue-title" className="font-display text-lg text-ink">
        Push {courses.length} {courses.length === 1 ? 'course' : 'courses'} to catalogue
      </h2>
      <p id="bulk-push-catalogue-description" className="text-sm text-secondary mt-1 mb-3">
        Choose one catalogue to add the selected courses to. Each becomes visible there as soon as it's added -- a
        platform admin still has to approve anything added to the global catalogue.
      </p>
      {excludedCourses.length > 0 && (
        <p className="text-xs text-amber-700 mb-3">
          {excludedCourses.length} of the selected {excludedCourses.length === 1 ? 'course isn’t' : 'courses aren’t'}{' '}
          an approved, currently published version, so {excludedCourses.length === 1 ? "it won't" : "they won't"} be
          included: {excludedCourses.map((course) => `"${course.name}"`).join(', ')}.
        </p>
      )}

      {error && <p role="alert" className="text-sm text-red-700 mb-3">{error}</p>}
      {loading ? (
        <p role="status" className="text-sm text-secondary">Loading catalogues…</p>
      ) : catalogues.length === 0 ? (
        <p className="text-sm text-secondary">No publishing destinations are available.</p>
      ) : (
        <div className="divide-y divide-hairline border-y border-hairline">
          {catalogues.map((catalogue) => (
            <label key={catalogue.id} className="flex items-start gap-3 py-3 cursor-pointer">
              <input
                type="radio"
                name="bulk-push-catalogue"
                checked={catalogueId === catalogue.id}
                onChange={() => setCatalogueId(catalogue.id)}
                className="mt-0.5 h-4 w-4 accent-moss"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{catalogue.name}</span>
                {catalogue.description && (
                  <span className="block text-xs text-secondary mt-0.5">{catalogue.description}</span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="flex justify-end gap-2 mt-5">
        <button type="button" onClick={onClose} disabled={submitting} className="rounded-md border border-hairline px-3 py-1.5 text-sm text-ink hover:bg-paper disabled:opacity-50">
          Cancel
        </button>
        <button
          type="button"
          onClick={handlePush}
          disabled={submitting || loading || !catalogueId || courses.length === 0}
          className="rounded-md bg-moss px-3 py-1.5 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Adding…' : 'Add to catalogue'}
        </button>
      </div>
    </AccessibleDialog>
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
                <p className="mt-0.5 text-xs text-secondary">{COURSE_STATUS_LABELS[version.status] ?? version.status}</p>
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
