import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import AppHeader from '../../components/AppHeader'
import ConfirmDialog from '../../components/ConfirmDialog'
import ResourceLibrarySection from '../../components/ResourceLibrarySection'
import { ProviderTrainingSection, ProviderCataloguesSection } from '../provider/ProviderConsole'
import {
  listEmployers,
  listEmployerMembers,
  addEmployerMember,
  removeEmployerMember,
  listEmployerCatalogueCourses,
  assignCourseToEmployerMembers,
  listEmployerCourseAssignments,
  requestEmployerDataAccess,
  listEmployerDataAccessRequests,
  suggestSkillToEmployerMembers,
  listEmployerSkillSuggestions,
  listEmployerLinkedProviders,
  linkProviderToEmployer,
  unlinkProviderFromEmployer,
} from '../../lib/admin/employers'
import { listOrganisations } from '../../lib/admin/organisations'
import { listLibrarySkills } from '../../lib/skillLibrary'
import { LEVELS, LEVEL_LABELS } from '../../lib/levels'
import { useSortedPage, useRowSelection, useUrlParam, writeUrlParams } from '../../lib/useSortedPage'
import { handleTabListKeyDown } from '../../lib/tabsKeyboard'
import { SortableTh, TablePagination, SelectionTh, BulkActionBar } from '../../components/TableControls'
import MutationFeedback from '../../components/MutationFeedback'
import StatusBadge from '../../components/StatusBadge'

const SECTIONS = [
  { key: 'training', label: 'Training' },
  { key: 'learners', label: 'Learners' },
  { key: 'assign', label: 'Assign training' },
  { key: 'suggest-skills', label: 'Suggest skills' },
  { key: 'providers', label: 'Providers' },
]

// Mirrors ProviderConsole.jsx's own (module-private) SECTIONS labels/keys --
// not the actual provider tab content, just enough to render matching,
// visually distinct nav buttons here that hand off to the real /provider
// console (via its ?org=&section= query params) rather than re-authoring
// provider functionality a second time. Keep in sync with
// ProviderConsole.jsx's SECTIONS if that ever changes.
const PROVIDER_SECTIONS = [
  { key: 'training', label: 'Training' },
  { key: 'skills', label: 'Skills' },
  { key: 'catalogues', label: 'Catalogues' },
  { key: 'staff', label: 'Users', adminOnly: true },
  { key: 'resources', label: 'Resources' },
]

const LEARNER_SORT_ACCESSORS = {
  id: (m) => m.id ?? '',
  email: (m) => (m.email || m.user_id || '').toLowerCase(),
  role: (m) => m.role ?? '',
  status: (m) => m.status ?? '',
}

const ASSIGNMENT_SORT_ACCESSORS = {
  course: (a) => a.course_catalogue?.name?.toLowerCase() ?? '',
  learner: (a) => (a.learnerEmail || '').toLowerCase(),
  status: (a) => a.status ?? '',
  created_at: (a) => a.created_at ?? '',
}

const ASSIGNMENT_STATUS_LABELS = {
  assigned: 'Assigned',
  enrolled: 'Started',
  dismissed: 'Dismissed',
}

const SKILL_SUGGESTION_SORT_ACCESSORS = {
  skill: (s) => s.skill_name?.toLowerCase() ?? '',
  learner: (s) => (s.learnerEmail || '').toLowerCase(),
  status: (s) => s.status ?? '',
  created_at: (s) => s.created_at ?? '',
}

const SKILL_SUGGESTION_STATUS_LABELS = {
  suggested: 'Suggested',
  adopted: 'Added by learner',
  dismissed: 'Dismissed',
}

const LINKED_PROVIDER_SORT_ACCESSORS = {
  name: (p) => p.organisations?.name?.toLowerCase() ?? '',
  org_code: (p) => p.organisations?.org_code?.toLowerCase() ?? '',
  created_at: (p) => p.created_at ?? '',
}

// Every panel below (Learners, Assign training, Suggest skills, Providers)
// keeps its own search/sort/page state in the URL, same convention as the
// Training tab's ProviderTrainingSection. Each panel's "primary" table uses
// the plain q/status/sort/dir/page/pageSize names (safe -- only one section
// is ever mounted at a time, so there's no runtime collision, mirroring
// ProviderConsole.jsx's org switcher); a panel with a second, simultaneously-
// visible table (Assign training's assignment roster, Suggest skills'
// suggestion roster) prefixes its own names (aq/aSort/..., sq/sSort/...) to
// avoid colliding with the first. Used to reset all of them together on
// both an employer switch and a section switch, so a stale filter/page from
// one view never carries over and makes the newly-selected view look empty
// (or, since several sections now share the plain q/status/page names,
// silently pre-filtered by a search typed into a different section) --
// mirrors the pre-existing q/status/page reset for the Training tab.
const EMPLOYER_FILTER_RESET = { q: null, status: null, page: null, aq: null, aPage: null, sq: null, sPage: null }

// Foundation console for an employer's own admin (employer_members
// role = 'admin', gated by EmployerAdminRoute). Training reuses the
// existing provider console components verbatim (readOnly), scoped to the
// employer's own auto-provisioned attached provider organisation
// (create_employer, 20260902090000) -- no forked view-only UI. Authoring
// (create/edit/delete/publish) only happens in the standalone Provider
// console at /provider, where this employer admin's real organisation_
// members role on that same org already grants it -- this tab is purely a
// second, view-only window onto the same data, not a second place to
// change it. Learners is a separate, new roster of the employer's own
// managed learners (employer_members), not provider staff -- one-at-a-time
// add-by-email plus (Phase 2) bulk import; course assignment and any
// learner-facing UI are still later phases.
export default function EmployerConsole() {
  const { user, employerMemberships, organisationMemberships } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [employers, setEmployers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // employer/section selection lives in the URL (?employer=&section=), the
  // same convention as ProviderConsole.jsx -- re-derived from searchParams
  // on every render so refresh, Back/Forward, and a shared link all restore
  // the same view.
  const selectedEmployerId = searchParams.get('employer')
  const activeSection = searchParams.get('section') ?? 'training'
  const employerTabRefs = useRef({})
  const sectionTabRefs = useRef({})

  // Builds the next ?employer=&section= query string, preserving whichever
  // of the two isn't being changed.
  function buildParams(overrides) {
    const next = new URLSearchParams(searchParams)
    Object.entries(overrides).forEach(([key, value]) => {
      if (value === null || value === undefined) next.delete(key)
      else next.set(key, value)
    })
    return next
  }

  const myEmployerIds = useMemo(
    () => (employerMemberships ?? []).filter((m) => m.role === 'admin').map((m) => m.employer_id),
    [employerMemberships]
  )
  const myEmployers = useMemo(
    () => employers.filter((e) => myEmployerIds.includes(e.id)),
    [employers, myEmployerIds]
  )
  const selectedEmployer = myEmployers.find((e) => e.id === selectedEmployerId)
  // Training-tab authoring is gated by organisation_members on the
  // attached provider org (is_org_admin/is_org_member RLS), which is a
  // separate relationship from employer_members -- mirrors ProviderConsole
  // .jsx's own myRole, derived the same way from a real membership row
  // rather than assumed. addEmployerMember (api/admin/actions.js) upserts
  // this row whenever an employer admin is added, so in practice it's
  // present for every employer admin, but it's still the actual source of
  // truth for what they're allowed to do in the reused provider components.
  const myProviderRole = (organisationMemberships ?? []).find(
    (m) => m.organisation_id === selectedEmployer?.provider_organisation_id
  )?.role

  useEffect(() => {
    listEmployers()
      .then(setEmployers)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  // Defaults ?employer= to the first employer this user admins whenever
  // it's absent or points at one they no longer admin -- replace: true so
  // this correction doesn't itself become a Back-button stop.
  useEffect(() => {
    if (myEmployers.length > 0 && !myEmployers.some((e) => e.id === selectedEmployerId)) {
      setSearchParams(buildParams({ employer: myEmployers[0].id }), { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myEmployers, selectedEmployerId])

  return (
    <div className="min-h-screen bg-paper">
      {/* hideNavLinks: same reasoning as ProviderConsole.jsx -- this is a
          distinct workspace from the learner-facing app. */}
      <AppHeader hideNavLinks />
      <main id="main-content" tabIndex={-1} className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="font-display text-xl text-ink mb-1">Employer console</h1>
        <p className="text-sm text-secondary mb-6">
          Build out your organisation's own training and manage the people it covers.
        </p>

        <MutationFeedback status="error" message={error} className="mb-4" />

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : myEmployers.length === 0 ? (
          <p className="text-secondary">You're not an admin of any employer.</p>
        ) : (
          <>
            {myEmployers.length > 1 && (
              <div role="tablist" aria-label="Employer" className="flex items-center flex-wrap gap-1 mb-4 border-b border-hairline">
                {myEmployers.map((employer) => (
                  <Link
                    key={employer.id}
                    ref={(el) => { employerTabRefs.current[employer.id] = el }}
                    id={`employer-tab-${employer.id}`}
                    to={`?${buildParams({ employer: employer.id, ...EMPLOYER_FILTER_RESET }).toString()}`}
                    role="tab"
                    aria-selected={selectedEmployerId === employer.id}
                    aria-controls={`employer-panel-${employer.id}`}
                    tabIndex={selectedEmployerId === employer.id ? 0 : -1}
                    onKeyDown={(event) =>
                      handleTabListKeyDown(event, {
                        keys: myEmployers.map((e) => e.id),
                        activeKey: selectedEmployerId,
                        refs: employerTabRefs,
                        // Clears the (read-only) training list's own filters on an
                        // employer switch, same reasoning as ProviderConsole's org
                        // switcher -- a stale q/status filter would otherwise carry
                        // over and make the new employer's list look empty/wrong.
                        onChange: (employerId) => setSearchParams(buildParams({ employer: employerId, ...EMPLOYER_FILTER_RESET })),
                      })
                    }
                    className={`text-sm px-3 py-2 -mb-px border-b-2 whitespace-nowrap ${
                      selectedEmployerId === employer.id
                        ? 'border-moss text-ink font-medium'
                        : 'border-transparent text-secondary hover:text-ink'
                    }`}
                  >
                    {employer.name}
                  </Link>
                ))}
              </div>
            )}

            {selectedEmployer && (
              <div
                {...(myEmployers.length > 1
                  ? {
                      role: 'tabpanel',
                      id: `employer-panel-${selectedEmployer.id}`,
                      'aria-labelledby': `employer-tab-${selectedEmployer.id}`,
                      tabIndex: 0,
                    }
                  : {})}
              >
                <div className="flex items-center flex-wrap gap-x-1 gap-y-2 mb-1 border-b border-hairline">
                  <div role="tablist" aria-label="Console section" className="flex items-center flex-wrap gap-x-1 gap-y-2">
                    {SECTIONS.map((section) => (
                      <Link
                        key={section.key}
                        ref={(el) => { sectionTabRefs.current[section.key] = el }}
                        id={`employer-section-tab-${section.key}`}
                        to={`?${buildParams({ section: section.key, ...EMPLOYER_FILTER_RESET }).toString()}`}
                        role="tab"
                        aria-selected={activeSection === section.key}
                        aria-controls={`employer-section-panel-${section.key}`}
                        tabIndex={activeSection === section.key ? 0 : -1}
                        onKeyDown={(event) =>
                          handleTabListKeyDown(event, {
                            keys: SECTIONS.map((s) => s.key),
                            activeKey: activeSection,
                            refs: sectionTabRefs,
                            // Several sections now share the same plain q/status/page
                            // param names for their own "primary" table (only one
                            // section is ever mounted at a time, so there's no runtime
                            // collision) -- clearing them on a section switch too, not
                            // just an employer switch, stops a search typed into one
                            // section's box from silently pre-filtering the next
                            // section's unrelated table.
                            onChange: (sectionKey) => setSearchParams(buildParams({ section: sectionKey, ...EMPLOYER_FILTER_RESET })),
                          })
                        }
                        className={`text-sm px-3 py-2 -mb-px border-b-2 whitespace-nowrap ${
                          activeSection === section.key
                            ? 'border-moss text-ink font-medium'
                            : 'border-transparent text-secondary hover:text-ink'
                        }`}
                      >
                        {section.label}
                      </Link>
                    ))}
                  </div>
                  {myProviderRole && (
                    <>
                      <span className="mx-1 h-5 w-px bg-hairline shrink-0" aria-hidden="true" />
                      <span className="font-mono text-[10px] uppercase tracking-wide text-secondary self-center mr-1">
                        Provider
                      </span>
                      {PROVIDER_SECTIONS.filter((s) => !s.adminOnly || myProviderRole === 'admin').map((section) => (
                        <Link
                          key={section.key}
                          to={`/provider?org=${selectedEmployer.provider_organisation_id}&section=${section.key}`}
                          className="text-sm px-3 py-2 -mb-px border-b-2 border-transparent whitespace-nowrap text-gold hover:border-gold"
                        >
                          {section.label} →
                        </Link>
                      ))}
                    </>
                  )}
                </div>
                <p className="text-xs text-secondary mb-6">
                  Gold tabs open the full Provider console, where you manage this employer's actual courses,
                  catalogues, and resources.
                </p>

                <div
                  id={`employer-section-panel-${activeSection}`}
                  role="tabpanel"
                  aria-labelledby={`employer-section-tab-${activeSection}`}
                  tabIndex={0}
                >
                  {activeSection === 'training' && (
                    <div className="space-y-10">
                      {!myProviderRole && (
                        <p className="text-sm text-secondary">
                          This view is read-only. Ask an admin of this employer's provider organisation to manage
                          courses, catalogues, and resources there.
                        </p>
                      )}
                      <ProviderTrainingSection
                        key={`${selectedEmployer.id}-training`}
                        organisation={{ id: selectedEmployer.provider_organisation_id }}
                        userId={user.id}
                        canViewParticipants={myProviderRole === 'admin'}
                        searchParams={searchParams}
                        setSearchParams={setSearchParams}
                        readOnly
                      />
                      <ProviderCataloguesSection
                        key={`${selectedEmployer.id}-catalogues`}
                        organisation={{ id: selectedEmployer.provider_organisation_id }}
                        userId={user.id}
                        readOnly
                      />
                      <ResourceLibrarySection
                        key={`${selectedEmployer.id}-resources`}
                        organisationId={selectedEmployer.provider_organisation_id}
                        userId={user.id}
                        readOnly
                      />
                    </div>
                  )}
                  {activeSection === 'learners' && (
                    <EmployerLearnersPanel
                      key={selectedEmployer.id}
                      employer={selectedEmployer}
                      searchParams={searchParams}
                      setSearchParams={setSearchParams}
                    />
                  )}
                  {activeSection === 'assign' && (
                    <EmployerAssignTrainingPanel
                      key={selectedEmployer.id}
                      employer={selectedEmployer}
                      searchParams={searchParams}
                      setSearchParams={setSearchParams}
                    />
                  )}
                  {activeSection === 'suggest-skills' && (
                    <EmployerSuggestSkillsPanel
                      key={selectedEmployer.id}
                      employer={selectedEmployer}
                      searchParams={searchParams}
                      setSearchParams={setSearchParams}
                    />
                  )}
                  {activeSection === 'providers' && (
                    <EmployerProvidersPanel
                      key={selectedEmployer.id}
                      employer={selectedEmployer}
                      user={user}
                      searchParams={searchParams}
                      setSearchParams={setSearchParams}
                    />
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

const DATA_ACCESS_STATUS_LABELS = {
  pending: 'Access requested',
  approved: 'Access granted',
  declined: 'Access declined',
  revoked: 'Access revoked',
}

function EmployerLearnersPanel({ employer, searchParams, setSearchParams }) {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [email, setEmail] = useState('')
  const [role, setRole] = useState('member')
  const [adding, setAdding] = useState(false)
  const [message, setMessage] = useState(null)
  const [removeTarget, setRemoveTarget] = useState(null)
  const [removing, setRemoving] = useState(false)

  const [bulkEmails, setBulkEmails] = useState('')
  const [bulkRole, setBulkRole] = useState('member')
  const [bulkSubmitting, setBulkSubmitting] = useState(false)
  const [bulkResults, setBulkResults] = useState(null)

  // Phase 5: employer-side view of each member's data-access consent state.
  // Keyed by learner_id -- there's at most one row per (employer, learner)
  // pair (unique constraint), so a plain map is enough.
  const [dataAccessByLearner, setDataAccessByLearner] = useState({})
  const [dataAccessRequestingId, setDataAccessRequestingId] = useState(null)
  const [dataAccessError, setDataAccessError] = useState(null)

  // Search/sort/page all live in the URL (?q=&sort=&dir=&page=&pageSize=),
  // same convention as AdminCatalogue.jsx/AdminTags.jsx -- this is this
  // panel's own "primary" table, so it uses the plain param names.
  const [query, setQuery] = useUrlParam(searchParams, setSearchParams, 'q', '', { resetParams: ['page'] })
  const q = query.trim().toLowerCase()
  const filteredMembers = useMemo(
    () => (q ? members.filter((m) => (m.email || m.user_id || '').toLowerCase().includes(q)) : members),
    [members, q]
  )
  const filtersActive = query !== ''

  function resetFilters() {
    writeUrlParams(searchParams, setSearchParams, { q: null, page: null })
  }

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(filteredMembers, LEARNER_SORT_ACCESSORS, { urlSync: { searchParams, setSearchParams } })

  useEffect(() => {
    load()
  }, [employer.id])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [membersData, dataAccessData] = await Promise.all([
        listEmployerMembers(employer.id),
        listEmployerDataAccessRequests(employer.id),
      ])
      setMembers(membersData)
      setDataAccessByLearner(Object.fromEntries(dataAccessData.map((r) => [r.learner_id, r])))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleRequestDataAccess(member) {
    setDataAccessError(null)
    setDataAccessRequestingId(member.user_id)
    try {
      const row = await requestEmployerDataAccess(employer.id, member.user_id)
      setDataAccessByLearner((prev) => ({ ...prev, [member.user_id]: row }))
    } catch (err) {
      setDataAccessError({ id: member.user_id, message: err.message })
    } finally {
      setDataAccessRequestingId(null)
    }
  }

  async function handleAdd(e) {
    e.preventDefault()
    setAdding(true)
    setMessage(null)
    setError(null)
    try {
      const result = await addEmployerMember(employer.id, email.trim(), role)
      setMessage(
        result.alreadyExisted
          ? `${email.trim()} added, pending their acceptance (see their Actions page).`
          : `${email.trim()} invited. They'll get access once they accept the invite email.`
      )
      setEmail('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setAdding(false)
    }
  }

  // Bulk-invite path alongside the one-at-a-time form above -- one
  // addEmployerMember call per email via Promise.allSettled, same partial-
  // failure shape as ProviderConsole.jsx's own bulk handlers (e.g.
  // handleBulkDelete), just reporting per-row outcomes instead of only
  // failures since a successful add here can mean either "invited" (new
  // account) or "added, pending acceptance" (existing account) -- both
  // worth surfacing distinctly, not just "succeeded".
  async function handleBulkImport(e) {
    e.preventDefault()
    const emails = Array.from(new Set(bulkEmails.split(/[\n,]+/).map((entry) => entry.trim()).filter(Boolean)))
    if (emails.length === 0) return

    setBulkSubmitting(true)
    setBulkResults(null)
    setError(null)
    try {
      const results = await Promise.allSettled(emails.map((addr) => addEmployerMember(employer.id, addr, bulkRole)))
      setBulkResults(
        emails.map((addr, index) => {
          const result = results[index]
          if (result.status === 'fulfilled') {
            return result.value.alreadyExisted
              ? { email: addr, outcome: 'added', detail: 'Added -- pending their acceptance' }
              : { email: addr, outcome: 'invited', detail: 'Invited -- new account created' }
          }
          const reason = result.reason?.message ?? 'Unknown error'
          // addEmployerMember's own 409 message (api/admin/actions.js) --
          // matched here only to give this one expected failure its own
          // clearer label instead of lumping it in with unexpected ones.
          return reason === 'This person is already a member of this employer.'
            ? { email: addr, outcome: 'already-member', detail: 'Already a member' }
            : { email: addr, outcome: 'failed', detail: `Failed -- ${reason}` }
        })
      )
      setBulkEmails('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBulkSubmitting(false)
    }
  }

  async function handleRemove() {
    setError(null)
    setRemoving(true)
    try {
      await removeEmployerMember(removeTarget.id)
      setRemoveTarget(null)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setRemoving(false)
    }
  }

  return (
    <section aria-labelledby="employer-learners-heading">
      <div className="mb-5">
        <h2 id="employer-learners-heading" className="font-display text-lg text-ink">Learners</h2>
        <p className="text-sm text-secondary mt-1 max-w-2xl">
          People managed under {employer.name}. Invite someone by email below, or paste multiple emails to bulk
          import learners at once.
        </p>
      </div>

      <form onSubmit={handleAdd} className="bg-card border border-hairline rounded-lg p-4 flex flex-wrap items-end gap-2 mb-4">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs text-secondary mb-1" htmlFor="employerMemberEmail">
            Add or invite by email
          </label>
          <input
            id="employerMemberEmail"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
          />
        </div>
        <div>
          <label className="block text-xs text-secondary mb-1" htmlFor="employerMemberRole">
            Role
          </label>
          <select
            id="employerMemberRole"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={adding}
          className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
        >
          {adding ? 'Adding…' : 'Add'}
        </button>
      </form>

      <MutationFeedback status="success" message={message} size="xs" className="mb-3" />
      <MutationFeedback status="error" message={error} size="xs" className="mb-3" />

      <details className="bg-card border border-hairline rounded-lg p-4 mb-4">
        <summary className="text-sm font-medium text-ink cursor-pointer">Bulk import learners</summary>
        <form onSubmit={handleBulkImport} className="mt-3 space-y-3">
          <div>
            <label className="block text-xs text-secondary mb-1" htmlFor="employerBulkEmails">
              Emails (one per line, or comma-separated)
            </label>
            <textarea
              id="employerBulkEmails"
              rows={4}
              value={bulkEmails}
              onChange={(e) => setBulkEmails(e.target.value)}
              placeholder={'jane@example.com\njohn@example.com'}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-xs text-secondary mb-1" htmlFor="employerBulkRole">
                Role
              </label>
              <select
                id="employerBulkRole"
                value={bulkRole}
                onChange={(e) => setBulkRole(e.target.value)}
                className="rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={bulkSubmitting || !bulkEmails.trim()}
              className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
            >
              {bulkSubmitting ? 'Importing…' : 'Bulk import'}
            </button>
          </div>
        </form>

        {bulkResults && (
          <div className="mt-3 border-t border-hairline pt-3">
            <p className="text-xs text-secondary mb-2">
              {bulkResults.length} {bulkResults.length === 1 ? 'result' : 'results'}:
            </p>
            <ul className="space-y-1">
              {bulkResults.map((r) => (
                <li key={r.email} className="text-xs flex flex-wrap gap-1">
                  <span className="font-mono text-ink">{r.email}</span>
                  <span
                    className={
                      r.outcome === 'failed'
                        ? 'text-red-700'
                        : r.outcome === 'already-member'
                          ? 'text-secondary'
                          : 'text-moss'
                    }
                  >
                    {r.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </details>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          aria-label="Search learners"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by email…"
          className="flex-1 min-w-[220px] rounded-md border border-hairline bg-card px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
        />
        {filtersActive && (
          <button
            type="button"
            onClick={resetFilters}
            className="text-xs text-secondary hover:text-ink py-1.5 px-2 whitespace-nowrap"
          >
            Reset filters
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-secondary">Loading learners…</p>
      ) : filteredMembers.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">{members.length === 0 ? 'No learners yet.' : 'No learners match your search.'}</p>
        </div>
      ) : (
        <div className="bg-card border border-hairline rounded-lg">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-secondary">
                  <SortableTh label="ID" columnKey="id" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                  <SortableTh label="Learner" columnKey="email" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Role" columnKey="role" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                  <SortableTh label="Status" columnKey="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                  <th className="px-4 py-2 font-medium whitespace-nowrap">Data access</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((m) => {
                  const dataAccess = dataAccessByLearner[m.user_id]
                  const canRequest = m.status === 'active' && (!dataAccess || dataAccess.status === 'declined' || dataAccess.status === 'revoked')
                  return (
                    <tr key={m.id} className="border-b border-hairline last:border-0">
                      <td className="px-4 py-2 font-mono text-[10px] text-secondary whitespace-nowrap">{m.id.slice(0, 8)}</td>
                      <td className="px-4 py-2 text-ink text-xs truncate max-w-[220px]">{m.email || m.user_id}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <StatusBadge label={m.role === 'admin' ? 'Admin' : 'Member'} tone="neutral" />
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <StatusBadge label={m.status === 'pending' ? 'Pending' : 'Active'} tone="neutral" />
                      </td>
                      <td className="px-4 py-2 text-xs whitespace-nowrap">
                        <div className="flex flex-col gap-1 items-start">
                          <StatusBadge
                            label={dataAccess ? DATA_ACCESS_STATUS_LABELS[dataAccess.status] : 'No request yet'}
                            tone={dataAccess?.status === 'declined' || dataAccess?.status === 'revoked' ? 'danger' : 'neutral'}
                          />
                          {canRequest && (
                            <button
                              type="button"
                              onClick={() => handleRequestDataAccess(m)}
                              disabled={dataAccessRequestingId === m.user_id}
                              className="text-moss hover:underline disabled:opacity-60"
                            >
                              {dataAccessRequestingId === m.user_id ? 'Requesting…' : 'Request data access'}
                            </button>
                          )}
                          {dataAccessError?.id === m.user_id && (
                            <MutationFeedback status="error" message={dataAccessError.message} size="xs" />
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button type="button" onClick={() => setRemoveTarget(m)} className="text-xs text-red-700 hover:underline whitespace-nowrap">
                          Remove
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <TablePagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} totalItems={totalItems} idPrefix={`employer-learners-${employer.id}`} />
        </div>
      )}

      {removeTarget && (
        <ConfirmDialog
          message={`Remove ${removeTarget.email || removeTarget.user_id} from ${employer.name}? They'll lose their ${removeTarget.role} access.`}
          onConfirm={handleRemove}
          onCancel={() => setRemoveTarget(null)}
          confirming={removing}
        />
      )}
    </section>
  )
}

// Phase 3: push training to specific learners rather than relying on 100%
// learner-initiated browse/enrol (courseCatalogue.js's listCatalogueCourses/
// enrolInCatalogueCourse, untouched by this phase). Course choices are
// scoped to courses actually published in one of this employer's own
// catalogues (listEmployerCatalogueCourses -- the RPC re-validates this
// server-side regardless, this is only the picker's convenience list).
// Assigning never enrols anyone by itself -- assign_course_to_employer_
// members only creates a course_assignments row; the learner still has to
// click "Start" on their own /actions page (respondToCourseAssignment) to
// create the real enrolment. Member selection reuses the same
// useRowSelection/SelectionTh/BulkActionBar primitives as ProviderConsole
// .jsx's own bulk "Push to catalogue" table, for a consistent picker feel
// across this console.
function EmployerAssignTrainingPanel({ employer, searchParams, setSearchParams }) {
  const [courses, setCourses] = useState([])
  const [members, setMembers] = useState([])
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [selectedCourseId, setSelectedCourseId] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [assignResult, setAssignResult] = useState(null)

  useEffect(() => {
    load()
  }, [employer.id])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [coursesData, membersData, assignmentsData] = await Promise.all([
        listEmployerCatalogueCourses(employer.provider_organisation_id),
        listEmployerMembers(employer.id),
        listEmployerCourseAssignments(employer.id),
      ])
      setCourses(coursesData)
      setMembers(membersData)
      setAssignments(assignmentsData)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Only an active employer_members row is assignable -- mirrors the RPC's
  // own membership filter (status = 'active'), so the picker never offers a
  // pending invitee it would just silently skip.
  const activeMembers = useMemo(() => members.filter((m) => m.status === 'active'), [members])
  const emailByUserId = useMemo(() => new Map(members.map((m) => [m.user_id, m.email || m.user_id])), [members])

  // Member picker's own search/sort/page -- this panel's "primary" table, so
  // it uses the plain q/sort/dir/page/pageSize param names.
  const [memberQuery, setMemberQuery] = useUrlParam(searchParams, setSearchParams, 'q', '', { resetParams: ['page'] })
  const memberQ = memberQuery.trim().toLowerCase()
  const filteredMembers = useMemo(
    () => (memberQ ? activeMembers.filter((m) => (m.email || m.user_id || '').toLowerCase().includes(memberQ)) : activeMembers),
    [activeMembers, memberQ]
  )
  const memberFiltersActive = memberQuery !== ''

  function resetMemberFilters() {
    writeUrlParams(searchParams, setSearchParams, { q: null, page: null })
  }

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(filteredMembers, LEARNER_SORT_ACCESSORS, { urlSync: { searchParams, setSearchParams } })
  const selection = useRowSelection(filteredMembers.map((m) => m.user_id))
  const pageUserIds = pageItems.map((m) => m.user_id)
  const selectedOnPage = pageUserIds.filter((id) => selection.selected.has(id)).length

  const assignmentsWithEmail = useMemo(
    () => assignments.map((a) => ({ ...a, learnerEmail: emailByUserId.get(a.assigned_to) })),
    [assignments, emailByUserId]
  )
  // Assignment roster's own search/sort/page -- prefixed (aq/aSort/...)
  // since it's visible on screen at the same time as the member picker
  // above, and would otherwise collide with its plain param names.
  const [assignmentQuery, setAssignmentQuery] = useUrlParam(searchParams, setSearchParams, 'aq', '', { resetParams: ['aPage'] })
  const aq = assignmentQuery.trim().toLowerCase()
  const filteredAssignments = useMemo(
    () =>
      aq
        ? assignmentsWithEmail.filter(
            (a) => a.course_catalogue?.name?.toLowerCase().includes(aq) || (a.learnerEmail || '').toLowerCase().includes(aq)
          )
        : assignmentsWithEmail,
    [assignmentsWithEmail, aq]
  )
  const assignmentFiltersActive = assignmentQuery !== ''

  function resetAssignmentFilters() {
    writeUrlParams(searchParams, setSearchParams, { aq: null, aPage: null })
  }

  const {
    sortKey: aSortKey,
    sortDir: aSortDir,
    toggleSort: aToggleSort,
    page: aPage,
    setPage: aSetPage,
    pageSize: aPageSize,
    setPageSize: aSetPageSize,
    pageItems: aPageItems,
    totalItems: aTotalItems,
  } = useSortedPage(filteredAssignments, ASSIGNMENT_SORT_ACCESSORS, {
    defaultSortKey: 'created_at',
    defaultSortDir: 'desc',
    urlSync: { searchParams, setSearchParams, paramNames: { sort: 'aSort', dir: 'aDir', page: 'aPage', pageSize: 'aPageSize' } },
  })

  async function handleAssign() {
    if (!selectedCourseId || selection.selected.size === 0) return
    setAssigning(true)
    setAssignResult(null)
    setError(null)
    try {
      const requestedIds = Array.from(selection.selected)
      const inserted = await assignCourseToEmployerMembers(employer.id, selectedCourseId, requestedIds)
      const insertedIds = new Set(inserted.map((row) => row.assigned_to))
      // The RPC silently skips anyone not an active member by the time it
      // ran, or already assigned this course (on conflict do nothing) --
      // report that explicitly rather than claiming every requested person
      // was assigned.
      const skippedEmails = requestedIds
        .filter((id) => !insertedIds.has(id))
        .map((id) => emailByUserId.get(id) || id)
      setAssignResult({ assignedCount: inserted.length, skippedEmails })
      selection.clear()
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setAssigning(false)
    }
  }

  return (
    <section aria-labelledby="employer-assign-training-heading">
      <div className="mb-5">
        <h2 id="employer-assign-training-heading" className="font-display text-lg text-ink">Assign training</h2>
        <p className="text-sm text-secondary mt-1 max-w-2xl">
          Push a course from {employer.name}'s own catalogue to specific learners. They'll see it on their Actions
          page and choose whether to start it -- assigning doesn't enrol anyone automatically.
        </p>
      </div>

      <MutationFeedback status="error" message={error} className="mb-3" />

      {loading ? (
        <p className="text-secondary">Loading…</p>
      ) : (
        <>
          <div className="bg-card border border-hairline rounded-lg p-4 mb-4">
            <label className="block text-xs text-secondary mb-1" htmlFor="employerAssignCourse">
              Course
            </label>
            {courses.length === 0 ? (
              <p className="text-xs text-secondary">
                No published courses yet -- publish a course to one of this employer's own catalogues from the
                Training tab first.
              </p>
            ) : (
              <select
                id="employerAssignCourse"
                value={selectedCourseId}
                onChange={(e) => setSelectedCourseId(e.target.value)}
                className="w-full max-w-md rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              >
                <option value="">Choose a course…</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
          </div>

          {assignResult && (
            <div className="bg-card border border-hairline rounded-lg p-4 mb-4">
              <MutationFeedback status="success" message={`${assignResult.assignedCount} learner(s) assigned.`} size="xs" />
              {assignResult.skippedEmails.length > 0 && (
                <p className="text-xs text-secondary mt-1">
                  Skipped (not an active member, or already assigned this course): {assignResult.skippedEmails.join(', ')}
                </p>
              )}
            </div>
          )}

          {activeMembers.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-hairline rounded-lg mb-8">
              <p className="text-secondary">No active learners to assign training to yet.</p>
            </div>
          ) : (
            <div className="bg-card border border-hairline rounded-lg mb-8">
              <div className="flex flex-wrap items-center gap-2 p-3 pb-0">
                <input
                  aria-label="Search learners"
                  type="text"
                  value={memberQuery}
                  onChange={(e) => setMemberQuery(e.target.value)}
                  placeholder="Search by email…"
                  className="flex-1 min-w-[220px] rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
                />
                {memberFiltersActive && (
                  <button
                    type="button"
                    onClick={resetMemberFilters}
                    className="text-xs text-secondary hover:text-ink py-1.5 px-2 whitespace-nowrap"
                  >
                    Reset filters
                  </button>
                )}
              </div>
              <div className="p-3 pb-0">
                <BulkActionBar
                  count={selection.selected.size}
                  onClear={selection.clear}
                  busy={assigning}
                  actions={[
                    {
                      label: assigning ? 'Assigning…' : `Assign course (${selection.selected.size})`,
                      disabled: !selectedCourseId || selection.selected.size === 0,
                      title: !selectedCourseId ? 'Choose a course above first' : undefined,
                      onClick: handleAssign,
                    },
                  ]}
                />
              </div>
              {filteredMembers.length === 0 ? (
                <p className="text-center text-xs text-secondary py-8">No learners match your search.</p>
              ) : (
              <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-left text-secondary">
                      <SelectionTh
                        idPrefix="employer-assign-members"
                        checked={selection.isAllSelected(pageUserIds)}
                        indeterminate={selectedOnPage > 0 && selectedOnPage < pageUserIds.length}
                        onChange={() => selection.toggleAll(pageUserIds)}
                      />
                      <SortableTh label="Learner" columnKey="email" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <SortableTh label="Role" columnKey="role" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((m) => (
                      <tr key={m.user_id} className="border-b border-hairline last:border-0">
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            checked={selection.selected.has(m.user_id)}
                            onChange={() => selection.toggle(m.user_id)}
                            aria-label={`Select ${m.email || m.user_id}`}
                            className="rounded border-hairline accent-moss"
                          />
                        </td>
                        <td className="px-4 py-2 text-ink text-xs truncate max-w-[220px]">{m.email || m.user_id}</td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <StatusBadge label={m.role === 'admin' ? 'Admin' : 'Member'} tone="neutral" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} totalItems={totalItems} idPrefix={`employer-assign-members-${employer.id}`} />
              </>
              )}
            </div>
          )}

          <div>
            <h3 className="font-display text-base text-ink mb-3">Assigned so far</h3>
            {assignments.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
                <p className="text-secondary">No training assigned yet.</p>
              </div>
            ) : (
              <div className="bg-card border border-hairline rounded-lg">
                <div className="flex flex-wrap items-center gap-2 p-3">
                  <input
                    aria-label="Search assignments"
                    type="text"
                    value={assignmentQuery}
                    onChange={(e) => setAssignmentQuery(e.target.value)}
                    placeholder="Search by course or learner…"
                    className="flex-1 min-w-[220px] rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
                  />
                  {assignmentFiltersActive && (
                    <button
                      type="button"
                      onClick={resetAssignmentFilters}
                      className="text-xs text-secondary hover:text-ink py-1.5 px-2 whitespace-nowrap"
                    >
                      Reset filters
                    </button>
                  )}
                </div>
                {filteredAssignments.length === 0 ? (
                  <p className="text-center text-xs text-secondary py-8">No assignments match your search.</p>
                ) : (
                <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-hairline text-left text-secondary">
                        <SortableTh label="Course" columnKey="course" sortKey={aSortKey} sortDir={aSortDir} onSort={aToggleSort} />
                        <SortableTh label="Learner" columnKey="learner" sortKey={aSortKey} sortDir={aSortDir} onSort={aToggleSort} />
                        <SortableTh label="Status" columnKey="status" sortKey={aSortKey} sortDir={aSortDir} onSort={aToggleSort} className="whitespace-nowrap" />
                        <SortableTh label="Assigned" columnKey="created_at" sortKey={aSortKey} sortDir={aSortDir} onSort={aToggleSort} className="whitespace-nowrap" />
                      </tr>
                    </thead>
                    <tbody>
                      {aPageItems.map((a) => (
                        <tr key={a.id} className="border-b border-hairline last:border-0">
                          <td className="px-4 py-2 text-ink text-xs truncate max-w-[220px]">{a.course_catalogue?.name || 'Deleted course'}</td>
                          <td className="px-4 py-2 text-secondary text-xs truncate max-w-[220px]">{a.learnerEmail || a.assigned_to}</td>
                          <td className="px-4 py-2 whitespace-nowrap">
                            <StatusBadge label={ASSIGNMENT_STATUS_LABELS[a.status] || a.status} tone={a.status === 'dismissed' ? 'danger' : 'neutral'} />
                          </td>
                          <td className="px-4 py-2 text-secondary text-xs whitespace-nowrap">{new Date(a.created_at).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <TablePagination page={aPage} setPage={aSetPage} pageSize={aPageSize} setPageSize={aSetPageSize} totalItems={aTotalItems} idPrefix={`employer-assignments-${employer.id}`} />
                </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}

// Phase 6: push a skill (with an optional target level/date) to specific
// learners, mirroring EmployerAssignTrainingPanel's "push, don't force"
// shape exactly. Suggesting never creates or modifies anyone's actual
// skills/skill_targets rows by itself -- suggest_skill_to_employer_members
// only creates an employer_skill_suggestions row; the learner still has to
// click "Add to my skills" on their own /actions page
// (adoptSkillSuggestion) to create the real skill (and, if they choose,
// a target) via the same unmodified findOrCreatePersonalSkill/skill_targets
// path any other learner-initiated skill-add already uses. Skill choices
// come from listLibrarySkills (src/lib/skillLibrary.js) -- the same active,
// public-or-own-private library search every learner-facing "Find skill"
// flow already uses, rather than the platform-admin-only listAllLibrarySkills
// (src/lib/admin/skills.js), which surfaces inactive/moderated entries and
// pulls in owner-identity fields that have no place in this picker. Member
// selection reuses the same useRowSelection/SelectionTh/BulkActionBar
// primitives as the Assign training tab above, for a consistent picker feel.
function EmployerSuggestSkillsPanel({ employer, searchParams, setSearchParams }) {
  const [librarySkills, setLibrarySkills] = useState([])
  const [members, setMembers] = useState([])
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [skillQuery, setSkillQuery] = useState('')
  const [selectedSkill, setSelectedSkill] = useState(null)
  const [targetLevel, setTargetLevel] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [comments, setComments] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const [suggestResult, setSuggestResult] = useState(null)

  useEffect(() => {
    load()
  }, [employer.id])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [skillsData, membersData, suggestionsData] = await Promise.all([
        listLibrarySkills(),
        listEmployerMembers(employer.id),
        listEmployerSkillSuggestions(employer.id),
      ])
      setLibrarySkills(skillsData)
      setMembers(membersData)
      setSuggestions(suggestionsData)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const activeMembers = useMemo(() => members.filter((m) => m.status === 'active'), [members])
  const emailByUserId = useMemo(() => new Map(members.map((m) => [m.user_id, m.email || m.user_id])), [members])

  // Member picker's own search/sort/page -- this panel's "primary" table, so
  // it uses the plain q/sort/dir/page/pageSize param names.
  const [memberQuery, setMemberQuery] = useUrlParam(searchParams, setSearchParams, 'q', '', { resetParams: ['page'] })
  const memberQ = memberQuery.trim().toLowerCase()
  const filteredMembers = useMemo(
    () => (memberQ ? activeMembers.filter((m) => (m.email || m.user_id || '').toLowerCase().includes(memberQ)) : activeMembers),
    [activeMembers, memberQ]
  )
  const memberFiltersActive = memberQuery !== ''

  function resetMemberFilters() {
    writeUrlParams(searchParams, setSearchParams, { q: null, page: null })
  }

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(filteredMembers, LEARNER_SORT_ACCESSORS, { urlSync: { searchParams, setSearchParams } })
  const selection = useRowSelection(filteredMembers.map((m) => m.user_id))
  const pageUserIds = pageItems.map((m) => m.user_id)
  const selectedOnPage = pageUserIds.filter((id) => selection.selected.has(id)).length

  const skillMatches = useMemo(() => {
    const q = skillQuery.trim().toLowerCase()
    if (!q) return []
    return librarySkills.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 20)
  }, [librarySkills, skillQuery])

  const suggestionsWithEmail = useMemo(
    () => suggestions.map((s) => ({ ...s, learnerEmail: emailByUserId.get(s.learner_id) })),
    [suggestions, emailByUserId]
  )
  // Suggestions roster's own search/sort/page -- prefixed (sq/sSort/...)
  // since it's visible on screen at the same time as the member picker
  // above, and would otherwise collide with its plain param names.
  const [suggestionQuery, setSuggestionQuery] = useUrlParam(searchParams, setSearchParams, 'sq', '', { resetParams: ['sPage'] })
  const sq = suggestionQuery.trim().toLowerCase()
  const filteredSuggestions = useMemo(
    () =>
      sq
        ? suggestionsWithEmail.filter(
            (s) => s.skill_name?.toLowerCase().includes(sq) || (s.learnerEmail || '').toLowerCase().includes(sq)
          )
        : suggestionsWithEmail,
    [suggestionsWithEmail, sq]
  )
  const suggestionFiltersActive = suggestionQuery !== ''

  function resetSuggestionFilters() {
    writeUrlParams(searchParams, setSearchParams, { sq: null, sPage: null })
  }

  const {
    sortKey: sSortKey,
    sortDir: sSortDir,
    toggleSort: sToggleSort,
    page: sPage,
    setPage: sSetPage,
    pageSize: sPageSize,
    setPageSize: sSetPageSize,
    pageItems: sPageItems,
    totalItems: sTotalItems,
  } = useSortedPage(filteredSuggestions, SKILL_SUGGESTION_SORT_ACCESSORS, {
    defaultSortKey: 'created_at',
    defaultSortDir: 'desc',
    urlSync: { searchParams, setSearchParams, paramNames: { sort: 'sSort', dir: 'sDir', page: 'sPage', pageSize: 'sPageSize' } },
  })

  function chooseSkill(skill) {
    setSelectedSkill(skill)
    setSkillQuery(skill.name)
  }

  function clearSkill() {
    setSelectedSkill(null)
    setSkillQuery('')
  }

  async function handleSuggest() {
    if (!selectedSkill || selection.selected.size === 0) return
    if (targetLevel && !targetDate) {
      setError('A target date is required when a target level is set.')
      return
    }
    setSuggesting(true)
    setSuggestResult(null)
    setError(null)
    try {
      const requestedIds = Array.from(selection.selected)
      const inserted = await suggestSkillToEmployerMembers(
        employer.id,
        selectedSkill.id,
        selectedSkill.name,
        requestedIds,
        {
          targetLevel: targetLevel ? Number(targetLevel) : null,
          targetDate: targetDate || null,
          comments: comments.trim() || null,
        }
      )
      const insertedIds = new Set(inserted.map((row) => row.learner_id))
      // The RPC silently skips anyone not an active member by the time it
      // ran, or already has a live ('suggested'/'adopted') suggestion for
      // this skill -- report that explicitly rather than claiming a uniform
      // success.
      const skippedEmails = requestedIds
        .filter((id) => !insertedIds.has(id))
        .map((id) => emailByUserId.get(id) || id)
      setSuggestResult({ suggestedCount: inserted.length, skippedEmails })
      selection.clear()
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSuggesting(false)
    }
  }

  return (
    <section aria-labelledby="employer-suggest-skills-heading">
      <div className="mb-5">
        <h2 id="employer-suggest-skills-heading" className="font-display text-lg text-ink">Suggest skills</h2>
        <p className="text-sm text-secondary mt-1 max-w-2xl">
          Suggest a skill (and optionally a target level/date) for specific learners to develop. They'll see it on
          their Actions page and decide whether to add it to their own profile -- suggesting doesn't touch their
          skills automatically.
        </p>
      </div>

      <MutationFeedback status="error" message={error} className="mb-3" />

      {loading ? (
        <p className="text-secondary">Loading…</p>
      ) : (
        <>
          <div className="bg-card border border-hairline rounded-lg p-4 mb-4 space-y-3">
            <div className="relative">
              <label className="block text-xs text-secondary mb-1" htmlFor="employerSuggestSkill">
                Skill
              </label>
              <input
                id="employerSuggestSkill"
                value={skillQuery}
                onChange={(e) => {
                  setSkillQuery(e.target.value)
                  if (selectedSkill) setSelectedSkill(null)
                }}
                placeholder="Search the skill library…"
                autoComplete="off"
                className="w-full max-w-md rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
              {selectedSkill && (
                <button
                  type="button"
                  onClick={clearSkill}
                  className="ml-2 text-xs text-secondary hover:text-ink hover:underline"
                >
                  Change
                </button>
              )}
              {!selectedSkill && skillQuery.trim() && (
                <div className="absolute z-10 mt-1 w-full max-w-md bg-card border border-hairline rounded-md shadow-sm max-h-56 overflow-y-auto">
                  {skillMatches.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-secondary">No matching skills.</p>
                  ) : (
                    skillMatches.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => chooseSkill(s)}
                        className="block w-full text-left px-3 py-2 text-sm text-ink hover:bg-paper"
                      >
                        {s.name}
                        {s.category && <span className="text-xs text-secondary ml-1.5">({s.category})</span>}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              <div>
                <label className="block text-xs text-secondary mb-1" htmlFor="employerSuggestLevel">
                  Target level (optional)
                </label>
                <select
                  id="employerSuggestLevel"
                  value={targetLevel}
                  onChange={(e) => setTargetLevel(e.target.value)}
                  className="rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                >
                  <option value="">No specific level</option>
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-secondary mb-1" htmlFor="employerSuggestDate">
                  Target date {targetLevel ? '' : '(optional)'}
                </label>
                <input
                  id="employerSuggestDate"
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-secondary mb-1" htmlFor="employerSuggestComments">
                Why this matters (optional)
              </label>
              <textarea
                id="employerSuggestComments"
                rows={2}
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                className="w-full max-w-md rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
          </div>

          {suggestResult && (
            <div className="bg-card border border-hairline rounded-lg p-4 mb-4">
              <MutationFeedback status="success" message={`${suggestResult.suggestedCount} learner(s) suggested this skill.`} size="xs" />
              {suggestResult.skippedEmails.length > 0 && (
                <p className="text-xs text-secondary mt-1">
                  Skipped (not an active member, or already have a live suggestion for this skill): {suggestResult.skippedEmails.join(', ')}
                </p>
              )}
            </div>
          )}

          {activeMembers.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-hairline rounded-lg mb-8">
              <p className="text-secondary">No active learners to suggest skills to yet.</p>
            </div>
          ) : (
            <div className="bg-card border border-hairline rounded-lg mb-8">
              <div className="flex flex-wrap items-center gap-2 p-3 pb-0">
                <input
                  aria-label="Search learners"
                  type="text"
                  value={memberQuery}
                  onChange={(e) => setMemberQuery(e.target.value)}
                  placeholder="Search by email…"
                  className="flex-1 min-w-[220px] rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
                />
                {memberFiltersActive && (
                  <button
                    type="button"
                    onClick={resetMemberFilters}
                    className="text-xs text-secondary hover:text-ink py-1.5 px-2 whitespace-nowrap"
                  >
                    Reset filters
                  </button>
                )}
              </div>
              <div className="p-3 pb-0">
                <BulkActionBar
                  count={selection.selected.size}
                  onClear={selection.clear}
                  busy={suggesting}
                  actions={[
                    {
                      label: suggesting ? 'Suggesting…' : `Suggest skill (${selection.selected.size})`,
                      disabled: !selectedSkill || selection.selected.size === 0,
                      title: !selectedSkill ? 'Choose a skill above first' : undefined,
                      onClick: handleSuggest,
                    },
                  ]}
                />
              </div>
              {filteredMembers.length === 0 ? (
                <p className="text-center text-xs text-secondary py-8">No learners match your search.</p>
              ) : (
              <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-left text-secondary">
                      <SelectionTh
                        idPrefix="employer-suggest-members"
                        checked={selection.isAllSelected(pageUserIds)}
                        indeterminate={selectedOnPage > 0 && selectedOnPage < pageUserIds.length}
                        onChange={() => selection.toggleAll(pageUserIds)}
                      />
                      <SortableTh label="Learner" columnKey="email" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <SortableTh label="Role" columnKey="role" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((m) => (
                      <tr key={m.user_id} className="border-b border-hairline last:border-0">
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            checked={selection.selected.has(m.user_id)}
                            onChange={() => selection.toggle(m.user_id)}
                            aria-label={`Select ${m.email || m.user_id}`}
                            className="rounded border-hairline accent-moss"
                          />
                        </td>
                        <td className="px-4 py-2 text-ink text-xs truncate max-w-[220px]">{m.email || m.user_id}</td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <StatusBadge label={m.role === 'admin' ? 'Admin' : 'Member'} tone="neutral" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} totalItems={totalItems} idPrefix={`employer-suggest-members-${employer.id}`} />
              </>
              )}
            </div>
          )}

          <div>
            <h3 className="font-display text-base text-ink mb-3">Suggested so far</h3>
            {suggestions.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
                <p className="text-secondary">No skills suggested yet.</p>
              </div>
            ) : (
              <div className="bg-card border border-hairline rounded-lg">
                <div className="flex flex-wrap items-center gap-2 p-3">
                  <input
                    aria-label="Search suggestions"
                    type="text"
                    value={suggestionQuery}
                    onChange={(e) => setSuggestionQuery(e.target.value)}
                    placeholder="Search by skill or learner…"
                    className="flex-1 min-w-[220px] rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
                  />
                  {suggestionFiltersActive && (
                    <button
                      type="button"
                      onClick={resetSuggestionFilters}
                      className="text-xs text-secondary hover:text-ink py-1.5 px-2 whitespace-nowrap"
                    >
                      Reset filters
                    </button>
                  )}
                </div>
                {filteredSuggestions.length === 0 ? (
                  <p className="text-center text-xs text-secondary py-8">No suggestions match your search.</p>
                ) : (
                <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-hairline text-left text-secondary">
                        <SortableTh label="Skill" columnKey="skill" sortKey={sSortKey} sortDir={sSortDir} onSort={sToggleSort} />
                        <SortableTh label="Learner" columnKey="learner" sortKey={sSortKey} sortDir={sSortDir} onSort={sToggleSort} />
                        <th className="px-4 py-2 font-medium whitespace-nowrap">Target</th>
                        <SortableTh label="Status" columnKey="status" sortKey={sSortKey} sortDir={sSortDir} onSort={sToggleSort} className="whitespace-nowrap" />
                        <SortableTh label="Suggested" columnKey="created_at" sortKey={sSortKey} sortDir={sSortDir} onSort={sToggleSort} className="whitespace-nowrap" />
                      </tr>
                    </thead>
                    <tbody>
                      {sPageItems.map((s) => (
                        <tr key={s.id} className="border-b border-hairline last:border-0">
                          <td className="px-4 py-2 text-ink text-xs truncate max-w-[220px]">{s.skill_name}</td>
                          <td className="px-4 py-2 text-secondary text-xs truncate max-w-[220px]">{s.learnerEmail || s.learner_id}</td>
                          <td className="px-4 py-2 text-secondary text-xs whitespace-nowrap">
                            {s.suggested_target_level ? LEVEL_LABELS[s.suggested_target_level] : '—'}
                            {s.target_date ? ` by ${new Date(`${s.target_date}T00:00:00`).toLocaleDateString()}` : ''}
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap">
                            <StatusBadge label={SKILL_SUGGESTION_STATUS_LABELS[s.status] || s.status} tone={s.status === 'dismissed' ? 'danger' : 'neutral'} />
                          </td>
                          <td className="px-4 py-2 text-secondary text-xs whitespace-nowrap">{new Date(s.created_at).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <TablePagination page={sPage} setPage={sSetPage} pageSize={sPageSize} setPageSize={sSetPageSize} totalItems={sTotalItems} idPrefix={`employer-skill-suggestions-${employer.id}`} />
                </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}

// Phase 7 foundation: purely a listing/linking mechanism for now -- linking
// an additional provider organisation to this employer has no functional
// effect elsewhere yet (doesn't widen assign_course_to_employer_members'
// eligibility, doesn't grant the linked provider any access, needs no
// consent from it). This is deliberately separate from the employer's own
// auto-provisioned attached provider org (employer.provider_organisation_id,
// create_employer), which stays filtered out of the linkable list below --
// linking it to itself would be meaningless. organisations is already an
// openly browsable directory to any authenticated user ("Authenticated
// users can view organisations", 0065), so listOrganisations() (unmodified,
// same as AdminProviders.jsx's own use of it) is reused directly here rather
// than a new platform-admin-gated listing. A later phase can build real
// functionality on top of employer_linked_providers without changing its
// shape.
function EmployerProvidersPanel({ employer, user, searchParams, setSearchParams }) {
  const [linkedProviders, setLinkedProviders] = useState([])
  const [allOrganisations, setAllOrganisations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Transient "search all organisations to link" widget -- not a listing of
  // this panel's own persisted data (mirrors the Suggest-skills tab's
  // skillQuery autocomplete, also left as local state rather than
  // URL-synced).
  const [query, setQuery] = useState('')
  const [linkingId, setLinkingId] = useState(null)
  const [unlinkTarget, setUnlinkTarget] = useState(null)
  const [unlinking, setUnlinking] = useState(false)

  // The already-linked-providers roster below is this panel's own URL-synced
  // collection (?q=&sort=&dir=&page=&pageSize=), same convention as every
  // other panel's primary table.
  const [rosterQuery, setRosterQuery] = useUrlParam(searchParams, setSearchParams, 'q', '', { resetParams: ['page'] })
  const rq = rosterQuery.trim().toLowerCase()
  const filteredLinkedProviders = useMemo(
    () =>
      rq
        ? linkedProviders.filter(
            (p) => p.organisations?.name?.toLowerCase().includes(rq) || (p.organisations?.org_code || '').toLowerCase().includes(rq)
          )
        : linkedProviders,
    [linkedProviders, rq]
  )
  const rosterFiltersActive = rosterQuery !== ''

  function resetRosterFilters() {
    writeUrlParams(searchParams, setSearchParams, { q: null, page: null })
  }

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(filteredLinkedProviders, LINKED_PROVIDER_SORT_ACCESSORS, { urlSync: { searchParams, setSearchParams } })

  useEffect(() => {
    load()
  }, [employer.id])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [linked, orgs] = await Promise.all([listEmployerLinkedProviders(employer.id), listOrganisations()])
      setLinkedProviders(linked)
      setAllOrganisations(orgs)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const linkedOrgIds = useMemo(
    () => new Set(linkedProviders.map((p) => p.provider_organisation_id)),
    [linkedProviders]
  )

  const linkableMatches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return allOrganisations
      .filter((o) => o.id !== employer.provider_organisation_id && !linkedOrgIds.has(o.id))
      .filter((o) => o.name.toLowerCase().includes(q) || (o.org_code || '').toLowerCase().includes(q))
      .slice(0, 20)
  }, [allOrganisations, linkedOrgIds, employer.provider_organisation_id, query])

  async function handleLink(org) {
    setLinkingId(org.id)
    setError(null)
    try {
      await linkProviderToEmployer(employer.id, org.id, user.id)
      setQuery('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setLinkingId(null)
    }
  }

  async function handleUnlink() {
    setError(null)
    setUnlinking(true)
    try {
      await unlinkProviderFromEmployer(unlinkTarget.id)
      setUnlinkTarget(null)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setUnlinking(false)
    }
  }

  return (
    <section aria-labelledby="employer-providers-heading">
      <div className="mb-5">
        <h2 id="employer-providers-heading" className="font-display text-lg text-ink">Providers</h2>
        <p className="text-sm text-secondary mt-1 max-w-2xl">
          Link additional provider organisations to {employer.name}. This just records the association for now --
          it doesn't change course assignment or grant the provider any access to {employer.name}'s data.
        </p>
      </div>

      <MutationFeedback status="error" message={error} className="mb-3" />

      {loading ? (
        <p className="text-secondary">Loading…</p>
      ) : (
        <>
          <div className="bg-card border border-hairline rounded-lg p-4 mb-8 relative">
            <label className="block text-xs text-secondary mb-1" htmlFor="employerLinkProviderSearch">
              Link a provider organisation
            </label>
            <input
              id="employerLinkProviderSearch"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search organisations by name or code…"
              autoComplete="off"
              className="w-full max-w-md rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
            {query.trim() && (
              <div className="mt-1 w-full max-w-md bg-card border border-hairline rounded-md max-h-56 overflow-y-auto">
                {linkableMatches.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-secondary">No matching organisations to link.</p>
                ) : (
                  linkableMatches.map((org) => (
                    <div
                      key={org.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-sm border-b border-hairline last:border-0"
                    >
                      <div className="min-w-0">
                        <p className="text-ink truncate">{org.name}</p>
                        {org.org_code && <p className="text-[10px] font-mono text-secondary">{org.org_code}</p>}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleLink(org)}
                        disabled={linkingId === org.id}
                        className="text-xs text-moss hover:underline disabled:opacity-60 shrink-0"
                      >
                        {linkingId === org.id ? 'Linking…' : 'Link'}
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {linkedProviders.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
              <p className="text-secondary">No additional providers linked yet.</p>
            </div>
          ) : (
            <div className="bg-card border border-hairline rounded-lg">
              <div className="flex flex-wrap items-center gap-2 p-3">
                <input
                  aria-label="Search linked providers"
                  type="text"
                  value={rosterQuery}
                  onChange={(e) => setRosterQuery(e.target.value)}
                  placeholder="Search by name or code…"
                  className="flex-1 min-w-[220px] rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
                />
                {rosterFiltersActive && (
                  <button
                    type="button"
                    onClick={resetRosterFilters}
                    className="text-xs text-secondary hover:text-ink py-1.5 px-2 whitespace-nowrap"
                  >
                    Reset filters
                  </button>
                )}
              </div>
              {filteredLinkedProviders.length === 0 ? (
                <p className="text-center text-xs text-secondary py-8">No linked providers match your search.</p>
              ) : (
              <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-left text-secondary">
                      <SortableTh label="Provider" columnKey="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <SortableTh label="Code" columnKey="org_code" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                      <SortableTh label="Linked" columnKey="created_at" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                      <th className="px-4 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((p) => (
                      <tr key={p.id} className="border-b border-hairline last:border-0">
                        <td className="px-4 py-2 text-ink text-xs truncate max-w-[220px]">
                          {p.organisations?.name || 'Deleted organisation'}
                        </td>
                        <td className="px-4 py-2 text-secondary text-xs whitespace-nowrap font-mono">
                          {p.organisations?.org_code || '—'}
                        </td>
                        <td className="px-4 py-2 text-secondary text-xs whitespace-nowrap">
                          {new Date(p.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => setUnlinkTarget(p)}
                            className="text-xs text-red-700 hover:underline whitespace-nowrap"
                          >
                            Unlink
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} totalItems={totalItems} idPrefix={`employer-linked-providers-${employer.id}`} />
              </>
              )}
            </div>
          )}
        </>
      )}

      {unlinkTarget && (
        <ConfirmDialog
          message={`Unlink ${unlinkTarget.organisations?.name || 'this provider'} from ${employer.name}? This only removes the association -- the provider organisation itself isn't affected.`}
          onConfirm={handleUnlink}
          onCancel={() => setUnlinkTarget(null)}
          confirming={unlinking}
        />
      )}
    </section>
  )
}
