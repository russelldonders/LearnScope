import { requestedDataSummary } from '../../lib/employerDataAccess'
import RequestDataAccessDialog from './RequestDataAccessDialog'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import AppHeader from '../../components/AppHeader'
import AccessibleDialog from '../../components/AccessibleDialog'
import ConfirmDialog from '../../components/ConfirmDialog'
import ResourceLibrarySection from '../../components/ResourceLibrarySection'
import ProviderSkillsSection from '../../components/ProviderSkillsSection'
import ProviderLtiToolsSection from '../../components/ProviderLtiToolsSection'
import OrganisationSettingsModal from '../../components/OrganisationSettingsModal'
import { ProviderTrainingSection, ProviderCataloguesSection } from '../provider/ProviderConsole'
import TrainingTeamAccessDialog from './TrainingTeamAccessDialog'
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
  listFieldDefinitionsForEmployer,
  listEmployerMemberFieldValues,
  upsertEmployerMemberFieldValue,
  createFieldDefinition,
  updateFieldDefinition,
  deleteFieldDefinition,
  reorderFieldDefinitions,
} from '../../lib/admin/employers'
import EmployerMemberFieldsModal from '../../components/EmployerMemberFieldsModal'
import FieldDefinitionsManager from '../../components/FieldDefinitionsManager'
import { listOrganisationMembers, listOrganisations } from '../../lib/admin/organisations'
import { listLibrarySkills } from '../../lib/skillLibrary'
import { listEmployerRoleProfiles, assignEmployerRoleProfile } from '../../lib/employerRoleProfiles'
import { LEVELS, LEVEL_LABELS } from '../../lib/levels'
import { useColumnPreferences, useSortedPage, useRowSelection, useUrlParam, writeUrlParams } from '../../lib/useSortedPage'
import { handleTabListKeyDown } from '../../lib/tabsKeyboard'
import { ColumnCustomizer, SortableTh, TablePagination, SelectionTh, BulkActionBar } from '../../components/TableControls'
import MutationFeedback from '../../components/MutationFeedback'
import StatusBadge from '../../components/StatusBadge'
import EmployerRoleProfilesSection from './EmployerRoleProfilesSection'
import EmployerOverviewPanel from './EmployerOverviewPanel'

// Training, Skills, Catalogues and Resources belong to the attached provider
// organisation (the same components ProviderConsole.jsx mounts, reused
// verbatim), folded into this single tab bar instead of handing off to a
// separate /provider page -- an employer admin is automatically an admin of
// that org too (addEmployerMember/decide_employer_invite grant it, and
// 20260905110000's trigger makes it permanent while they hold this role), so
// there's no separate consent step before these tabs work. providerTab marks
// all four so the tab bar below collapses them into a single "Provider"
// dropdown (see ProviderSectionMenu) instead of four standalone tabs, since
// they are provider-console functionality surfaced here, not employer
// functionality -- styled identically to every other tab (border-moss when
// active), the same as AdminLayout.jsx/ProviderConsole.jsx's own tabs, just
// grouped under one extra affordance rather than four separate stops. Skills
// alone stays providerOnly (hidden without an actual organisation_members
// role, same as before this change) since its own component has no
// read-only mode to fall back to; Training/Catalogues/Resources stay
// visible even without one, same as the single combined "Training" tab did
// before this split, falling back to their own read-only views (below) for
// the rare employer admin who doesn't yet have the grant.
const SECTIONS = [
  { key: 'overview', label: 'Overview' },
  { key: 'provider-training', label: 'Training', providerTab: true },
  { key: 'skills', label: 'Skills', providerOnly: true, providerTab: true },
  { key: 'provider-catalogues', label: 'Catalogues', providerTab: true },
  { key: 'provider-resources', label: 'Resources', providerTab: true },
  { key: 'provider-lti-tools', label: 'LTI tools', adminOnly: true, providerTab: true },
  { key: 'users', label: 'Users' },
  { key: 'member-fields', label: 'Member fields' },
  { key: 'roles', label: 'Role profiles' },
  { key: 'providers', label: 'Providers' },
]

const LEARNER_SORT_ACCESSORS = {
  id: (m) => m.userCode ?? '',
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

// Customizable data columns only -- the leading selection checkbox stays
// pinned outside this list (EmployerLearnersPanel has no trailing actions
// column). "Training access" only exists at all when attachedProviderOrg is
// truthy, so it's built conditionally into the array itself rather than
// left always-visible-and-toggleable -- mirrors AdminEmployers.jsx's
// employerColumns(organisationById) factory, just with two closed-over
// values (attachedProviderOrg, dataAccessByLearner) instead of one.
function employerLearnerColumns(attachedProviderOrg, dataAccessByLearner) {
  const trainingAccessColumn = {
    key: 'training_access',
    label: 'Training access',
    sortable: false,
    thClassName: 'whitespace-nowrap',
    cellClassName: 'px-4 py-2 text-xs whitespace-nowrap',
    renderCell: (m) =>
      m.trainingAccess
        ? `${m.trainingAccess.role === 'admin' ? 'Admin' : 'Trainer'}${m.trainingAccess.status === 'pending' ? ' (pending)' : ''}`
        : 'None',
  }
  return [
    {
      key: 'id',
      label: 'ID',
      sortable: true,
      thClassName: 'whitespace-nowrap',
      cellClassName: 'px-4 py-2 font-mono text-xs text-secondary whitespace-nowrap',
      renderCell: (m) => m.userCode || '—',
    },
    {
      key: 'email',
      label: 'User',
      sortable: true,
      cellClassName: 'px-4 py-2 text-ink text-xs truncate max-w-[220px]',
      renderCell: (m) => m.email || m.user_id,
    },
    {
      key: 'role',
      label: 'Role',
      sortable: true,
      thClassName: 'whitespace-nowrap',
      cellClassName: 'px-4 py-2 whitespace-nowrap',
      renderCell: (m) => (
        <StatusBadge label={!m.employerMember ? 'Training team' : m.role === 'admin' ? 'Admin' : 'Member'} tone="neutral" />
      ),
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      thClassName: 'whitespace-nowrap',
      cellClassName: 'px-4 py-2 whitespace-nowrap',
      renderCell: (m) => <StatusBadge label={m.status === 'pending' ? 'Pending' : 'Active'} tone="neutral" />,
    },
    ...(attachedProviderOrg ? [trainingAccessColumn] : []),
    {
      key: 'data_access',
      label: 'Data access',
      sortable: false,
      thClassName: 'whitespace-nowrap',
      cellClassName: 'px-4 py-2 text-xs max-w-[220px]',
      renderCell: (m) => {
        const dataAccess = dataAccessByLearner[m.user_id]
        return (
          <div className="flex flex-col gap-1 items-start">
            <StatusBadge
              label={!m.employerMember ? 'Not applicable' : dataAccess ? DATA_ACCESS_STATUS_LABELS[dataAccess.status] : 'No request yet'}
              tone={dataAccess?.status === 'declined' || dataAccess?.status === 'revoked' ? 'danger' : 'neutral'}
            />
            {dataAccess && (
              <p className="text-[10px] text-secondary leading-snug">
                Requested: {requestedDataSummary(dataAccess)}
                {dataAccess.status === 'approved' && (
                  <>. Approved: {(dataAccess.approved_data || ['skills']).join(', ')}</>
                )}
              </p>
            )}
          </div>
        )
      },
    },
  ]
}

// Customizable data columns only -- the trailing "Unlink" actions column
// stays pinned outside this list, same as AdminEmployers.jsx's "Add admin"
// column. No external dependency needed, so a plain constant rather than a
// factory function.
const EMPLOYER_PROVIDER_COLUMNS = [
  {
    key: 'name',
    label: 'Provider',
    sortable: true,
    cellClassName: 'px-4 py-2 text-ink text-xs truncate max-w-[220px]',
    renderCell: (p) => p.organisations?.name || 'Deleted organisation',
  },
  {
    key: 'org_code',
    label: 'Code',
    sortable: true,
    thClassName: 'whitespace-nowrap',
    cellClassName: 'px-4 py-2 text-secondary text-xs whitespace-nowrap font-mono',
    renderCell: (p) => p.organisations?.org_code || '—',
  },
  {
    key: 'created_at',
    label: 'Linked',
    sortable: true,
    thClassName: 'whitespace-nowrap',
    cellClassName: 'px-4 py-2 text-secondary text-xs whitespace-nowrap',
    renderCell: (p) => new Date(p.created_at).toLocaleDateString(),
  },
]

// Every panel below (Users, Providers) keeps its own search/sort/page state
// in the URL, same convention as the Training tab's ProviderTrainingSection.
// Each panel's "primary" table uses the plain q/status/sort/dir/page/
// pageSize names (safe -- only one section is ever mounted at a time, so
// there's no runtime collision, mirroring ProviderConsole.jsx's org
// switcher). Assignment dialogs keep history filters local to each selection.
// Used to reset all of them together on both an employer switch and a
// section switch, so a stale filter/page from one view never carries over
// and makes the newly-selected view look empty (or, since several sections
// share the plain q/status/page names, silently pre-filtered by a search
// typed into a different section) -- mirrors the pre-existing q/status/page
// reset for the Training tab.
const EMPLOYER_FILTER_RESET = { usersView: null, q: null, status: null, page: null, aq: null, aPage: null, sq: null, sPage: null }

// Foundation console for an employer's own admin (employer_members
// role = 'admin', gated by EmployerAdminRoute). Training/Skills and the
// training-team controls inside Users reuse
// the existing provider console components verbatim, scoped to the
// employer's own auto-provisioned attached provider organisation
// (create_employer, 20260902090000) -- no forked UI. Authoring there is
// enabled/disabled by this same employer admin's real organisation_members
// role on that attached org (myProviderRole below), exactly as it would be
// in the standalone Provider console -- this stays the *only* place an
// employer admin manages that org's training, so there's no separate
// /provider hand-off to a second page (and no exposure to any *other*
// provider organisation they might separately belong to). The Users tab
// combines the employer's managed learner/admin roster
// (employer_members) alongside the attached provider organisation's
// training-team permissions, while keeping their distinct access scopes
// clear inside the combined page.
export default function EmployerConsole() {
  const { user, employerMemberships, organisationMemberships } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [employers, setEmployers] = useState([])
  const [organisations, setOrganisations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  // employer/section selection lives in the URL (?employer=&section=), the
  // same convention as ProviderConsole.jsx -- re-derived from searchParams
  // on every render so refresh, Back/Forward, and a shared link all restore
  // the same view.
  const selectedEmployerId = searchParams.get('employer')
  const requestedSection = searchParams.get('section') ?? 'overview'
  // Preserve old bookmarked links after merging the former Users and
  // Learners tabs (both legacy destinations now open the combined view),
  // after splitting the former combined Training tab into the separate
  // provider-training/provider-catalogues/provider-resources tabs below (an
  // old link to the bundled view now opens just the Training portion), and
  // after folding the standalone Assign training/Suggest skills tabs into
  // bulk actions on the Users tab's learner roster (EmployerLearnersPanel)
  // -- old links to either now land on Users, where that functionality
  // actually lives now.
  const activeSection = ['staff', 'learners', 'assign', 'suggest-skills'].includes(requestedSection)
    ? 'users'
    : requestedSection === 'training'
      ? 'provider-training'
      : requestedSection
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
  // The attached provider org, required to actually be active -- mirrors
  // ProviderConsole.jsx's own myOrgs filter ("Deactivating an organisation
  // revokes its staff's actual access (RLS, 0069) -- filter to active orgs
  // ... so a staff member doesn't see a tab for an org that can no longer
  // create training or manage staff"). Without this check here, a
  // deactivated org's former admin could still reach the inline Users tab
  // below and invite new staff into it via the service-role staff-invite
  // API, which (unlike the RLS-gated writes) doesn't itself re-check
  // organisation status.
  const attachedProviderOrg = organisations.find(
    (o) => o.id === selectedEmployer?.provider_organisation_id && o.status === 'active'
  )
  // Training-tab authoring is gated by organisation_members on the
  // attached provider org (is_org_admin/is_org_member RLS), which is a
  // separate relationship from employer_members -- mirrors ProviderConsole
  // .jsx's own myRole, derived the same way from a real membership row
  // rather than assumed. addEmployerMember (api/admin/actions.js) upserts
  // this row whenever an employer admin is added, so in practice it's
  // present for every employer admin, but it's still the actual source of
  // truth for what they're allowed to do in the reused provider components.
  const myProviderRole = attachedProviderOrg
    ? (organisationMemberships ?? []).find((m) => m.organisation_id === attachedProviderOrg.id)?.role
    : undefined
  const visibleSections = SECTIONS.filter((s) => {
    if (s.adminOnly) return myProviderRole === 'admin'
    if (s.providerOnly) return !!myProviderRole
    return true
  })
  // Guards against a stale provider-only tab surviving a switch to an
  // employer where this admin no longer has the corresponding role.
  const currentSection = visibleSections.some((section) => section.key === activeSection) ? activeSection : 'overview'
  const providerSections = useMemo(() => visibleSections.filter((s) => s.providerTab), [visibleSections])
  const activeSectionIsProvider = providerSections.some((s) => s.key === currentSection)
  // Roving-tabindex keys for the top-level tablist's arrow-key navigation
  // (handleTabListKeyDown) -- the four providerTab sections collapse into
  // one 'provider-group' stop (the dropdown trigger button below) instead
  // of four separate stops, mirroring how they're rendered as a single
  // control rather than four tabs.
  const rovingSectionKeys = useMemo(() => {
    const keys = []
    visibleSections.forEach((section, index) => {
      if (section.providerTab) {
        if (!visibleSections[index - 1]?.providerTab) keys.push('provider-group')
      } else {
        keys.push(section.key)
      }
    })
    return keys
  }, [visibleSections])
  const rovingActiveKey = activeSectionIsProvider ? 'provider-group' : currentSection
  // Arrow-key navigation onto the dropdown trigger activates whichever
  // provider sub-section is already open, or the first one otherwise --
  // it doesn't itself open the menu (that still needs a click/Enter).
  function handleSectionRovingChange(key) {
    const targetSection = key === 'provider-group'
      ? (activeSectionIsProvider ? currentSection : providerSections[0]?.key)
      : key
    if (targetSection) setSearchParams(buildParams({ section: targetSection, ...EMPLOYER_FILTER_RESET }))
  }

  useEffect(() => {
    Promise.all([listEmployers(), listOrganisations()])
      .then(([employersData, organisationsData]) => {
        setEmployers(employersData)
        setOrganisations(organisationsData)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  // Refreshes attachedProviderOrg after the settings modal saves branding
  // changes -- mirrors ProviderConsole.jsx's own reloadOrganisations.
  function reloadOrganisations() {
    listOrganisations()
      .then(setOrganisations)
      .catch((err) => setError(err.message))
  }

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
                <div className="flex items-center justify-between flex-wrap gap-x-1 gap-y-2 mb-6 border-b border-hairline">
                  <div role="tablist" aria-label="Console section" className="flex items-center flex-wrap gap-x-1 gap-y-2">
                    {visibleSections.map((section, index) => {
                      if (section.providerTab) {
                        // Renders once for the whole consecutive run of
                        // providerTab sections (Training/Skills/Catalogues/
                        // Resources), as a single "Provider" dropdown rather
                        // than four standalone tabs -- the tabs behave
                        // identically either way (same ?section= navigation,
                        // same employer-console frame), this only changes how
                        // they're grouped in the tab bar.
                        if (visibleSections[index - 1]?.providerTab) return null
                        return (
                          <ProviderSectionMenu
                            key="provider-group"
                            items={providerSections}
                            currentSection={currentSection}
                            isActive={activeSectionIsProvider}
                            buttonRef={(el) => { sectionTabRefs.current['provider-group'] = el }}
                            hrefFor={(sectionKey) => `?${buildParams({ section: sectionKey, ...EMPLOYER_FILTER_RESET }).toString()}`}
                            onKeyDown={(event) =>
                              handleTabListKeyDown(event, {
                                keys: rovingSectionKeys,
                                activeKey: rovingActiveKey,
                                refs: sectionTabRefs,
                                onChange: handleSectionRovingChange,
                              })
                            }
                          />
                        )
                      }
                      return (
                        <Link
                          key={section.key}
                          ref={(el) => { sectionTabRefs.current[section.key] = el }}
                          id={`employer-section-tab-${section.key}`}
                          to={`?${buildParams({ section: section.key, ...EMPLOYER_FILTER_RESET }).toString()}`}
                          role="tab"
                          aria-selected={currentSection === section.key}
                          aria-controls={`employer-section-panel-${section.key}`}
                          tabIndex={currentSection === section.key ? 0 : -1}
                          onKeyDown={(event) =>
                            handleTabListKeyDown(event, {
                              keys: rovingSectionKeys,
                              activeKey: rovingActiveKey,
                              refs: sectionTabRefs,
                              // Several sections now share the same plain q/status/page
                              // param names for their own "primary" table (only one
                              // section is ever mounted at a time, so there's no runtime
                              // collision) -- clearing them on a section switch too, not
                              // just an employer switch, stops a search typed into one
                              // section's box from silently pre-filtering the next
                              // section's unrelated table.
                              onChange: handleSectionRovingChange,
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
                      )
                    })}
                  </div>
                  {myProviderRole === 'admin' && (
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
                  {myProviderRole !== 'admin' && (
                    <p className="text-xs text-secondary shrink-0 mb-2">
                      Organisation settings need provider admin access.
                    </p>
                  )}
                </div>

                <div
                  id={`employer-section-panel-${currentSection}`}
                  role="tabpanel"
                  aria-labelledby={
                    activeSectionIsProvider ? 'employer-section-tab-provider-group' : `employer-section-tab-${currentSection}`
                  }
                  tabIndex={0}
                >
                  {currentSection === 'overview' && (
                    <EmployerOverviewPanel key={`${selectedEmployer.id}-overview`} employer={selectedEmployer} />
                  )}
                  {currentSection === 'provider-training' && (
                    <div className="space-y-4">
                      {!myProviderRole && (
                        <p className="text-sm text-secondary">
                          This view is read-only. Ask an admin of this employer's provider organisation to manage
                          courses there.
                        </p>
                      )}
                      <ProviderTrainingSection
                        key={`${selectedEmployer.id}-training`}
                        organisation={{ id: selectedEmployer.provider_organisation_id }}
                        userId={user.id}
                        canViewParticipants={myProviderRole === 'admin'}
                        searchParams={searchParams}
                        setSearchParams={setSearchParams}
                        readOnly={!myProviderRole}
                      />
                    </div>
                  )}
                  {currentSection === 'provider-catalogues' && (
                    <div className="space-y-4">
                      {!myProviderRole && (
                        <p className="text-sm text-secondary">
                          This view is read-only. Ask an admin of this employer's provider organisation to manage
                          catalogues there.
                        </p>
                      )}
                      <ProviderCataloguesSection
                        key={`${selectedEmployer.id}-catalogues`}
                        organisation={{ id: selectedEmployer.provider_organisation_id }}
                        userId={user.id}
                        canCreate={myProviderRole === 'admin'}
                        readOnly={!myProviderRole}
                      />
                    </div>
                  )}
                  {currentSection === 'provider-resources' && (
                    <div className="space-y-4">
                      {!myProviderRole && (
                        <p className="text-sm text-secondary">
                          This view is read-only. Ask an admin of this employer's provider organisation to manage
                          resources there.
                        </p>
                      )}
                      <ResourceLibrarySection
                        key={`${selectedEmployer.id}-resources`}
                        organisationId={selectedEmployer.provider_organisation_id}
                        userId={user.id}
                        readOnly={!myProviderRole}
                      />
                    </div>
                  )}
                  {currentSection === 'provider-lti-tools' && myProviderRole === 'admin' && (
                    <ProviderLtiToolsSection
                      key={`${selectedEmployer.id}-lti-tools`}
                      organisationId={selectedEmployer.provider_organisation_id}
                      userId={user.id}
                    />
                  )}
                  {currentSection === 'skills' && myProviderRole && (
                    <ProviderSkillsSection
                      key={`${selectedEmployer.id}-skills`}
                      organisationId={selectedEmployer.provider_organisation_id}
                      userId={user.id}
                    />
                  )}
                  {currentSection === 'users' && (
                    <EmployerUsersPanel
                      key={`${selectedEmployer.id}-users`}
                      employer={selectedEmployer}
                      attachedProviderOrg={attachedProviderOrg}
                      canManageTrainingTeam={myProviderRole === 'admin'}
                      searchParams={searchParams}
                      setSearchParams={setSearchParams}
                    />
                  )}
                  {currentSection === 'member-fields' && (
                    <EmployerMemberFieldsSection
                      key={selectedEmployer.id}
                      employer={selectedEmployer}
                      userId={user.id}
                    />
                  )}
                  {currentSection === 'roles' && (
                    <EmployerRoleProfilesSection
                      key={selectedEmployer.id}
                      employer={selectedEmployer}
                      user={user}
                      searchParams={searchParams}
                      setSearchParams={setSearchParams}
                      onOpenProfile={(id) => navigate(`/employer/roles/${id}`)}
                    />
                  )}
                  {currentSection === 'providers' && (
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

      {showSettings && attachedProviderOrg && (
        <OrganisationSettingsModal
          organisation={attachedProviderOrg}
          onClose={() => {
            setShowSettings(false)
            reloadOrganisations()
          }}
        />
      )}
    </div>
  )
}

// Collapses the providerTab sections (Training/Skills/Catalogues/Resources)
// into a single dropdown tab, same outside-click/Escape-to-close pattern as
// AppHeader.jsx's own account menu. Still a real `role="tab"` so it slots
// into the surrounding tablist/roving-tabindex the same as any other section
// tab -- opening it is a separate affordance (click/Enter/Space) from
// selecting a section, which only happens by choosing one of its menu items.
function ProviderSectionMenu({ items, currentSection, isActive, buttonRef, hrefFor, onKeyDown }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function handleOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    function handleEscape(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  const activeItem = items.find((item) => item.key === currentSection)

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        ref={buttonRef}
        id="employer-section-tab-provider-group"
        role="tab"
        aria-selected={isActive}
        aria-controls={isActive ? `employer-section-panel-${currentSection}` : undefined}
        aria-haspopup="true"
        aria-expanded={open}
        tabIndex={isActive ? 0 : -1}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        className={`flex items-center gap-1 text-sm px-3 py-2 -mb-px border-b-2 whitespace-nowrap ${
          isActive ? 'border-moss text-ink font-medium' : 'border-transparent text-secondary hover:text-ink'
        }`}
      >
        {activeItem ? `Provider: ${activeItem.label}` : 'Provider'}
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div role="menu" aria-label="Provider" className="absolute z-10 mt-1 min-w-[10rem] bg-card border border-hairline rounded-md shadow-lg py-1">
          {items.map((item) => (
            <Link
              key={item.key}
              role="menuitem"
              to={hrefFor(item.key)}
              onClick={() => setOpen(false)}
              className={`block px-4 py-2 text-sm whitespace-nowrap ${
                item.key === currentSection ? 'text-ink font-medium bg-paper' : 'text-ink hover:bg-paper'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

const DATA_ACCESS_STATUS_LABELS = {
  pending: 'Access requested',
  approved: 'Access granted',
  declined: 'Access declined',
  revoked: 'Access revoked',
}

// Lets this employer's own admins manage their own additional roster
// fields, on top of the platform-admin-owned base fields (AdminEmployers.jsx)
// every employer starts with -- reuses FieldDefinitionsManager verbatim,
// scoped to employer.id instead of the global (employer_id null) set.
function EmployerMemberFieldsSection({ employer, userId }) {
  const [fields, setFields] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    load()
  }, [employer.id])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setFields(await listFieldDefinitionsForEmployer(employer.id))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const baseFields = fields.filter((f) => f.employer_id === null)
  const ownFields = fields.filter((f) => f.employer_id !== null)

  async function handleCreate(payload) {
    await createFieldDefinition({
      ...payload,
      employerId: employer.id,
      createdBy: userId,
      sortOrder: ownFields.length > 0 ? Math.max(...ownFields.map((f) => f.sort_order)) + 10 : 1000,
    })
    await load()
  }

  async function handleUpdate(id, payload) {
    await updateFieldDefinition(id, payload)
    await load()
  }

  async function handleDelete(id) {
    await deleteFieldDefinition(id)
    await load()
  }

  async function handleReorder(updates) {
    await reorderFieldDefinitions(updates)
    await load()
  }

  return (
    <div>
      <h2 className="font-display text-lg text-ink mb-1">Member fields</h2>
      <p className="text-sm text-secondary mb-5 max-w-2xl">
        These fields appear when editing a user's details from the Users tab. Base fields (set by LearnScope) apply
        to every employer; add your own below for anything specific to {employer.name}.
      </p>

      {error && <p role="alert" className="text-sm text-red-700 mb-4">{error}</p>}

      {loading ? (
        <p className="text-secondary">Loading…</p>
      ) : (
        <div className="space-y-8">
          <div>
            <h3 className="text-sm font-medium text-ink mb-2">Base fields</h3>
            <div className="space-y-2">
              {baseFields.map((field) => (
                <div key={field.id} className="bg-card border border-hairline rounded-lg p-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-ink">{field.label}{field.required && <span className="ml-1.5 text-xs text-secondary">(required)</span>}</p>
                    <p className="text-xs text-secondary mt-0.5">{field.field_type}</p>
                  </div>
                  <span className="text-[10px] uppercase tracking-wide text-secondary">Set by LearnScope</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-ink mb-2">Your own fields</h3>
            <FieldDefinitionsManager
              fields={ownFields}
              scopeLabel="field"
              onCreate={handleCreate}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              onReorder={handleReorder}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function EmployerUsersPanel({ employer, attachedProviderOrg, canManageTrainingTeam, searchParams, setSearchParams }) {
  return (
    <div>
      <EmployerLearnersPanel
        employer={employer}
        searchParams={searchParams}
        setSearchParams={setSearchParams}
        attachedProviderOrg={canManageTrainingTeam ? attachedProviderOrg : null}
      />

    </div>
  )
}

export function EmployerLearnersPanel({ employer, searchParams, setSearchParams, attachedProviderOrg }) {
  const { isPlatformAdmin, user } = useAuth()
  const [members, setMembers] = useState([])
  const [trainingStaff, setTrainingStaff] = useState([])
  const [trainingStaffError, setTrainingStaffError] = useState(null)
  const [trainingStaffLoading, setTrainingStaffLoading] = useState(Boolean(attachedProviderOrg))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [email, setEmail] = useState('')
  const [role, setRole] = useState('member')
  const [adding, setAdding] = useState(false)
  const [message, setMessage] = useState(null)
  const [removeTarget, setRemoveTarget] = useState(null)
  const [removing, setRemoving] = useState(false)
  const showAddUsers = searchParams.get('usersView') === 'add'
  const addParams = new URLSearchParams(searchParams)
  addParams.set('usersView', 'add')
  const listParams = new URLSearchParams(searchParams)
  listParams.delete('usersView')

  // Assign training/Assign skill used to be their own top-level tabs, each
  // with its own copy of this same learner roster to pick targets from --
  // folded into bulk actions on this one roster instead (select learners
  // here, then choose which to run), so there's a single place to manage
  // who's covered by this employer and a single selection model for acting
  // on them. 'assignModal' is which picker dialog (if any) is open;
  // 'assignResult' surfaces the last run's outcome (assigned/skipped) the
  // same way the old panels' inline result banner did.
  const [assignModal, setAssignModal] = useState(null)
  const [assignResult, setAssignResult] = useState(null)

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

  // Roster field values (20260911130000) -- the employer's own record about
  // each member, separate from their actual LearnScope profile. Keyed by
  // employer_member_id (not user_id) since that's what the values table
  // itself is keyed to.
  const [fieldDefinitions, setFieldDefinitions] = useState([])
  const [fieldValuesByMember, setFieldValuesByMember] = useState({})
  const [editingFieldsMember, setEditingFieldsMember] = useState(null)

  const EMPLOYER_LEARNER_COLUMNS = useMemo(
    () => employerLearnerColumns(attachedProviderOrg, dataAccessByLearner),
    [attachedProviderOrg, dataAccessByLearner]
  )
  const { columns, visibleColumns, toggleColumn, moveColumn, resetToDefault } =
    useColumnPreferences('employer-learners', EMPLOYER_LEARNER_COLUMNS)

  // Search/sort/page all live in the URL (?q=&sort=&dir=&page=&pageSize=),
  // same convention as AdminCatalogue.jsx/AdminTags.jsx -- this is this
  // panel's own "primary" table, so it uses the plain param names.
  const [query, setQuery] = useUrlParam(searchParams, setSearchParams, 'q', '', { resetParams: ['page'] })
  const q = query.trim().toLowerCase()
  const users = useMemo(() => {
    const staffById = new Map(trainingStaff.map((staff) => [staff.user_id, staff]))
    const employerUserIds = new Set(members.map((member) => member.user_id))
    return [
      ...members.map((member) => ({ ...member, employerMember: true, trainingAccess: staffById.get(member.user_id) })),
      ...trainingStaff.filter((staff) => !employerUserIds.has(staff.user_id)).map((staff) => ({
        ...staff, role: null, employerMember: false, trainingAccess: staff,
      })),
    ]
  }, [members, trainingStaff])

  useEffect(() => {
    let cancelled = false
    setTrainingStaff([])
    setTrainingStaffError(null)
    setTrainingStaffLoading(Boolean(attachedProviderOrg))
    if (attachedProviderOrg) {
      listOrganisationMembers(attachedProviderOrg.id)
        .then((staff) => { if (!cancelled) setTrainingStaff(staff) })
        .catch((err) => { if (!cancelled) setTrainingStaffError(err.message) })
        .finally(() => { if (!cancelled) setTrainingStaffLoading(false) })
    }
    return () => { cancelled = true }
  }, [attachedProviderOrg])

  const filteredMembers = useMemo(
    () => (q ? users.filter((m) => (m.email || m.user_id || '').toLowerCase().includes(q)) : users),
    [users, q]
  )
  const filtersActive = query !== ''

  function resetFilters() {
    writeUrlParams(searchParams, setSearchParams, { q: null, page: null })
  }

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(filteredMembers, LEARNER_SORT_ACCESSORS, { urlSync: { searchParams, setSearchParams } })

  // Staff access can be managed for any listed user; learning actions still
  // require an active employer membership for every selected user.
  const eligibleMembers = filteredMembers
  const selection = useRowSelection(eligibleMembers.map((m) => m.user_id))
  const eligiblePageIds = pageItems.map((m) => m.user_id)
  const selectedOnPage = eligiblePageIds.filter((id) => selection.selected.has(id)).length
  const selectedMembers = useMemo(
    () => eligibleMembers.filter((m) => selection.selected.has(m.user_id)),
    [eligibleMembers, selection.selected]
  )

  useEffect(() => {
    load()
  }, [employer.id])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [membersData, dataAccessData, fields, values] = await Promise.all([
        listEmployerMembers(employer.id),
        listEmployerDataAccessRequests(employer.id),
        listFieldDefinitionsForEmployer(employer.id),
        listEmployerMemberFieldValues(employer.id),
      ])
      setMembers(membersData)
      setDataAccessByLearner(Object.fromEntries(dataAccessData.map((r) => [r.learner_id, r])))
      setFieldDefinitions(fields)
      const byMember = {}
      for (const v of values) {
        byMember[v.employer_member_id] = { ...byMember[v.employer_member_id], [v.field_definition_id]: v.value }
      }
      setFieldValuesByMember(byMember)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Saves every field one at a time (not a single batched call) so a
  // failure on one field doesn't silently drop edits to the others -- same
  // Promise.allSettled reasoning as handleBulkRequestDataAccess above.
  async function handleSaveMemberFields(values) {
    const results = await Promise.allSettled(
      fieldDefinitions.map((f) => upsertEmployerMemberFieldValue(editingFieldsMember.id, f.id, values[f.id] || null, user.id))
    )
    const failed = results.find((r) => r.status === 'rejected')
    if (failed) throw new Error(failed.reason?.message || 'Some fields failed to save.')
    setFieldValuesByMember((prev) => ({ ...prev, [editingFieldsMember.id]: values }))
  }

  const requestableMembers = selectedMembers.filter((m) => m.employerMember && m.status === 'active' && (!dataAccessByLearner[m.user_id] || ['declined', 'revoked'].includes(dataAccessByLearner[m.user_id].status)))
  // Same "active employer member" eligibility rule as the buttons' own
  // disabled condition previously enforced by blocking the whole action --
  // now the action narrows to just the eligible subset instead, matching
  // requestableMembers' own pattern above, so a mixed selection doesn't
  // force manually deselecting the ineligible rows first.
  const assignableMembers = selectedMembers.filter((m) => m.employerMember && m.status === 'active')
  const assignSkippedCount = selectedMembers.length - assignableMembers.length

  async function handleBulkRequestDataAccess(options) {
    setDataAccessError(null)
    setDataAccessRequestingId('bulk')
    const results = await Promise.allSettled(requestableMembers.map(async (member) => {
      const row = await requestEmployerDataAccess(employer.id, member.user_id, options)
      setDataAccessByLearner((prev) => ({ ...prev, [member.user_id]: row }))
    }))
    const failures = results.flatMap((r, i) => r.status === 'rejected' ? [requestableMembers[i].email + ': ' + (r.reason?.message || 'Request failed')] : [])
    setMessage((results.length - failures.length) + ' data access request(s) sent. ' + (selectedMembers.length - results.length) + ' ineligible user(s) skipped.')
    setDataAccessError(failures.join('; ') || null)
    setDataAccessRequestingId(null)
    if (failures.length && failures.length === results.length) throw new Error(failures.join('; '))
    setAssignModal(null)
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
      const results = await Promise.allSettled(removeTarget.map((m) => removeEmployerMember(m.id)))
      const failures = results.flatMap((r, i) => r.status === 'rejected' ? [removeTarget[i].email + ': ' + (r.reason?.message || 'Removal failed')] : [])
      setMessage((results.length - failures.length) + ' user(s) removed.')
      selection.clear()
      setRemoveTarget(null)
      await load()
      setError(failures.join('; ') || null)
    } catch (err) {
      setError(err.message)
    } finally {
      setRemoving(false)
    }
  }

  function handleAssignDone(result) {
    setAssignModal(null)
    setAssignResult(result)
    selection.clear()
  }

  if (showAddUsers) return (
    <section aria-labelledby="employer-add-users-heading" className="max-w-3xl">
      <Link to={`?${listParams}`} className="inline-block mb-4 text-sm text-moss hover:underline">Back to users</Link>
      <h2 id="employer-add-users-heading" className="font-display text-lg text-ink mb-5">Add users</h2>
      <MutationFeedback status="success" message={message} size="xs" className="mb-3" />
      <MutationFeedback status="error" message={error} size="xs" className="mb-3" />
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
    </section>
  )

  return (
    <section aria-labelledby="employer-learners-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <h2 id="employer-learners-heading" className="font-display text-lg text-ink">Users</h2>
        <div className="flex items-center gap-2">
          {isPlatformAdmin && (
            <ColumnCustomizer
              idPrefix="employer-learners"
              columns={columns}
              onToggle={toggleColumn}
              onMove={moveColumn}
              onReset={resetToDefault}
            />
          )}
          {selection.selected.size === 0 && <Link to={`?${addParams}`} className="rounded-md bg-moss text-paper px-3 py-2 text-sm font-medium hover:opacity-90">Add users</Link>}
        </div>
      </div>

      <MutationFeedback status="success" message={message} size="xs" className="mb-3" />
      <MutationFeedback status="error" message={error} size="xs" className="mb-3" />
      <MutationFeedback status="error" message={dataAccessError} size="xs" className="mb-3" />

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

      <MutationFeedback status="error" message={trainingStaffError ? `Could not load training team access: ${trainingStaffError}` : null} size="xs" />

      <BulkActionBar
        count={selection.selected.size}
        busy={Boolean(dataAccessRequestingId) || removing}
        onClear={selection.clear}
        actions={[
          { label: 'Request data access', title: "Ask selected active users for permission to view their learning data. Pending or granted requests are skipped.", onClick: () => setAssignModal('data-access'), disabled: requestableMembers.length === 0 },
          { label: 'Assign training', title: "Assign a course to the selected users. Only active employer members are eligible; others in the selection are skipped.", onClick: () => setAssignModal('training'), disabled: assignableMembers.length === 0 },
          { label: 'Assign skill', title: "Suggest a skill and target level to the selected users. Only active employer members are eligible; others in the selection are skipped.", onClick: () => setAssignModal('skill'), disabled: assignableMembers.length === 0 },
          ...(attachedProviderOrg ? [{ label: 'Training team access', title: "Manage the selected users’ administrator or trainer access to the training catalogue.", onClick: () => setAssignModal('access'), disabled: trainingStaffLoading || Boolean(trainingStaffError) }] : []),
          { label: 'Assign role profile', title: "Propose a role profile for the selected users to review and accept. Only active employer members are eligible; others in the selection are skipped.", onClick: () => setAssignModal('role'), disabled: assignableMembers.length === 0 },
          { label: 'Remove', title: "Remove the selected users from this employer after confirmation. Only employer members can be removed.", onClick: () => setRemoveTarget([...selectedMembers]), variant: 'danger', disabled: selectedMembers.some((m) => !m.employerMember) },
        ]}
      />

      {assignResult && (
        <div className="bg-card border border-hairline rounded-lg p-3 mb-3 text-xs">
          <MutationFeedback
            status="success"
            message={
              assignResult.kind === 'training'
                ? `${assignResult.count} learner(s) assigned this course.`
                : assignResult.kind === 'role'
                  ? `${assignResult.count} learner(s) proposed this role profile.`
                  : `${assignResult.count} learner(s) assigned this skill.`
            }
            size="xs"
          />
          {assignResult.skippedEmails.length > 0 && (
            <p className="text-secondary mt-1">
              Skipped ({assignResult.kind === 'training'
                ? 'already had a live assignment for this course'
                : assignResult.kind === 'role'
                  ? 'already linked to this role, or not an eligible learner'
                  : 'already had a live suggestion for this skill'}):{' '}
              {assignResult.skippedEmails.join(', ')}
            </p>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-xs text-secondary">Loading learners…</p>
      ) : filteredMembers.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">{users.length === 0 ? 'No users yet.' : 'No users match your search.'}</p>
        </div>
      ) : (
        <div className="bg-card border border-hairline rounded-lg">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-secondary">
                  <SelectionTh
                    idPrefix="employer-learners"
                    checked={selection.isAllSelected(eligiblePageIds)}
                    indeterminate={selectedOnPage > 0 && selectedOnPage < eligiblePageIds.length}
                    onChange={() => selection.toggleAll(eligiblePageIds)}
                  />
                  {visibleColumns.map((col) =>
                    col.sortable ? (
                      <SortableTh key={col.key} label={col.label} columnKey={col.key} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className={col.thClassName} />
                    ) : (
                      <th key={col.key} className={`px-4 py-2 font-medium ${col.thClassName || ''}`}>{col.label}</th>
                    )
                  )}
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((m) => {
                  return (
                    <tr key={m.id} className="border-b border-hairline last:border-0">
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          checked={selection.selected.has(m.user_id)}
                          onChange={() => selection.toggle(m.user_id)}
                          aria-label={`Select ${m.email || m.user_id}`}
                          className="rounded border-hairline accent-moss disabled:opacity-30"
                        />
                      </td>
                      {visibleColumns.map((col) => (
                        <td key={col.key} className={col.cellClassName}>
                          {col.renderCell(m)}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        {m.employerMember && (
                          <button
                            type="button"
                            onClick={() => setEditingFieldsMember(m)}
                            className="text-xs font-medium text-moss hover:underline"
                          >
                            Edit details
                          </button>
                        )}
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
          confirmLabel="Remove"
          message={`Remove ${removeTarget.length === 1 ? (removeTarget[0].email || removeTarget[0].userCode) : `${removeTarget.length} selected users`} from ${employer.name}? They'll lose their employer access.`}
          onConfirm={handleRemove}
          onCancel={() => setRemoveTarget(null)}
          confirming={removing}
        />
      )}

      {editingFieldsMember && (
        <EmployerMemberFieldsModal
          memberLabel={editingFieldsMember.email || editingFieldsMember.user_id}
          fields={fieldDefinitions}
          initialValues={fieldValuesByMember[editingFieldsMember.id] || {}}
          onSave={handleSaveMemberFields}
          onClose={() => setEditingFieldsMember(null)}
        />
      )}

      {assignModal === 'data-access' && <RequestDataAccessDialog count={requestableMembers.length} onSubmit={handleBulkRequestDataAccess} onClose={() => setAssignModal(null)} />}
      {assignModal === 'access' && attachedProviderOrg && (
        <TrainingTeamAccessDialog
          organisation={attachedProviderOrg}
          members={selectedMembers}
          onClose={() => setAssignModal(null)}
          onUpdated={async () => {
            try {
              setTrainingStaff(await listOrganisationMembers(attachedProviderOrg.id))
              setTrainingStaffError(null)
            } catch (err) {
              setTrainingStaffError(err.message)
            }
          }}
        />
      )}
      {assignModal === 'training' && (
        <AssignTrainingModal
          employer={employer}
          members={assignableMembers}
          skippedCount={assignSkippedCount}
          onClose={() => setAssignModal(null)}
          onAssigned={handleAssignDone}
        />
      )}
      {assignModal === 'skill' && (
        <AssignSkillModal
          employer={employer}
          members={assignableMembers}
          skippedCount={assignSkippedCount}
          onClose={() => setAssignModal(null)}
          onAssigned={handleAssignDone}
        />
      )}
      {assignModal === 'role' && (
        <AssignRoleModal
          employer={employer}
          members={assignableMembers}
          skippedCount={assignSkippedCount}
          onClose={() => setAssignModal(null)}
          onAssigned={handleAssignDone}
        />
      )}
    </section>
  )
}

// Course picker for the "Assign training" bulk action on the Users tab's
// learner roster (EmployerLearnersPanel) -- used to be its own top-level
// tab with its own copy of the learner picker; folded into a modal opened
// from a selection made on that one roster instead, so there's a single
// place to pick "who" (see EmployerLearnersPanel) and this only has to ask
// "which course". Course choices are scoped to courses actually published
// in one of this employer's own catalogues (listEmployerCatalogueCourses --
// the RPC re-validates this server-side regardless, this is only the
// picker's convenience list). Assigning never enrols anyone by itself --
// assign_course_to_employer_members only creates a course_assignments row;
// the learner still has to click "Start" on their own /actions page
// (respondToCourseAssignment) to create the real enrolment.
function AssignTrainingModal({ employer, members, skippedCount = 0, onClose, onAssigned }) {
  const [historyParams, setHistoryParams] = useState(() => new URLSearchParams())
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedCourseId, setSelectedCourseId] = useState('')
  const [assigning, setAssigning] = useState(false)

  useEffect(() => {
    listEmployerCatalogueCourses(employer.provider_organisation_id)
      .then(setCourses)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [employer.provider_organisation_id])

  async function handleAssign(e) {
    e.preventDefault()
    if (!selectedCourseId) return
    setAssigning(true)
    setError(null)
    try {
      const requestedIds = members.map((m) => m.user_id)
      const inserted = await assignCourseToEmployerMembers(employer.id, selectedCourseId, requestedIds)
      const insertedIds = new Set(inserted.map((row) => row.assigned_to))
      // Everyone passed in here already cleared the roster's own "active"
      // filter -- the only reason the RPC would still skip one is an
      // existing live assignment for this course (on conflict do nothing).
      const skippedEmails = requestedIds
        .filter((id) => !insertedIds.has(id))
        .map((id) => members.find((m) => m.user_id === id)?.email || id)
      onAssigned({ kind: 'training', count: inserted.length, skippedEmails })
    } catch (err) {
      setError(err.message)
      setAssigning(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="assign-training-dialog-title"
      onClose={assigning ? undefined : onClose}
      closeOnBackdrop={!assigning}
      panelClassName="w-full max-w-3xl bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 id="assign-training-dialog-title" className="font-display text-xl text-ink mb-1">Assign training</h2>
      <p className="text-sm text-secondary mb-4">
        Push a course from {employer.name}'s own catalogue to {members.length} selected learner{members.length === 1 ? '' : 's'}.
        They'll see it on their Actions page and choose whether to start it -- this doesn't enrol anyone
        automatically.
      </p>
      {skippedCount > 0 && (
        <p className="text-xs text-secondary mb-4">
          {skippedCount} of the selected user{skippedCount === 1 ? '' : 's'} {skippedCount === 1 ? 'is' : 'are'} not an active employer member and won't be included.
        </p>
      )}

      <MutationFeedback status="error" message={error} size="xs" className="mb-3" />

      {loading ? (
        <p className="text-sm text-secondary">Loading courses…</p>
      ) : courses.length === 0 ? (
        <p className="text-sm text-secondary">
          No published courses yet -- publish a course to one of this employer's own catalogues from the Training
          tab first.
        </p>
      ) : (
        <form onSubmit={handleAssign} className="space-y-4">
          <div>
            <label className="block text-xs text-secondary mb-1" htmlFor="employerAssignCourse">
              Course
            </label>
            <select
              id="employerAssignCourse"
              required
              value={selectedCourseId}
              onChange={(e) => setSelectedCourseId(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            >
              <option value="">Choose a course…</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={assigning}
              className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!selectedCourseId || assigning}
              className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
            >
              {assigning ? 'Assigning…' : `Assign to ${members.length}`}
            </button>
          </div>
        </form>
      )}
      <section aria-labelledby="employer-training-history-heading" className="mt-6 border-t border-hairline pt-6">
        <EmployerTrainingAssignmentsHistory
          employer={employer}
          members={members}
          searchParams={historyParams}
          setSearchParams={setHistoryParams}
        />
      </section>
    </AccessibleDialog>
  )
}

// Assignment history for the selected users in the matching assignment dialog.

function EmployerTrainingAssignmentsHistory({ employer, members, searchParams, setSearchParams }) {
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    load()
  }, [employer.id, members])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const rows = await listEmployerCourseAssignments(employer.id)
      const selectedUserIds = new Set(members.map((member) => member.user_id))
      setAssignments(rows.filter((row) => selectedUserIds.has(row.assigned_to)))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const emailByUserId = useMemo(() => new Map(members.map((m) => [m.user_id, m.email || m.user_id])), [members])
  const assignmentsWithEmail = useMemo(
    () => assignments.map((a) => ({ ...a, learnerEmail: emailByUserId.get(a.assigned_to) })),
    [assignments, emailByUserId]
  )
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

  return (
    <div>
      <h3 id="employer-training-history-heading" className="font-display text-base text-ink mb-3">Training assigned so far</h3>
      <MutationFeedback status="error" message={error} size="xs" className="mb-3" />
      {loading ? (
        <p className="text-xs text-secondary">Loading…</p>
      ) : assignments.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No training assigned to the selected users yet.</p>
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
  )
}

// Skill (+ optional target level/date) picker for the "Assign skill" bulk
// action on the Users tab's learner roster (EmployerLearnersPanel) -- used
// to be its own top-level "Suggest skills" tab with its own copy of the
// learner picker; folded into a modal opened from a selection made on that
// one roster instead, mirroring AssignTrainingModal's shape exactly.
// Suggesting never creates or modifies anyone's actual skills/skill_targets
// rows by itself -- suggest_skill_to_employer_members only creates an
// employer_skill_suggestions row; the learner still has to click "Add to my
// skills" on their own /actions page (adoptSkillSuggestion) to create the
// real skill (and, if they choose, a target) via the same unmodified
// findOrCreatePersonalSkill/skill_targets path any other learner-initiated
// skill-add already uses. Skill choices come from listLibrarySkills
// (src/lib/skillLibrary.js) -- the same active, public-or-own-private
// library search every learner-facing "Find skill" flow already uses,
// rather than the platform-admin-only listAllLibrarySkills
// (src/lib/admin/skills.js), which surfaces inactive/moderated entries and
// pulls in owner-identity fields that have no place in this picker.
function AssignSkillModal({ employer, members, skippedCount = 0, onClose, onAssigned }) {
  const [historyParams, setHistoryParams] = useState(() => new URLSearchParams())
  const [librarySkills, setLibrarySkills] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [skillQuery, setSkillQuery] = useState('')
  const [selectedSkill, setSelectedSkill] = useState(null)
  const [targetLevel, setTargetLevel] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [comments, setComments] = useState('')
  const [assigning, setAssigning] = useState(false)

  useEffect(() => {
    listLibrarySkills()
      .then(setLibrarySkills)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const skillMatches = useMemo(() => {
    const q = skillQuery.trim().toLowerCase()
    if (!q) return []
    return librarySkills.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 20)
  }, [librarySkills, skillQuery])

  function chooseSkill(skill) {
    setSelectedSkill(skill)
    setSkillQuery(skill.name)
  }

  function clearSkill() {
    setSelectedSkill(null)
    setSkillQuery('')
  }

  async function handleAssign(e) {
    e.preventDefault()
    if (!selectedSkill) return
    if (targetLevel && !targetDate) {
      setError('A target date is required when a target level is set.')
      return
    }
    setAssigning(true)
    setError(null)
    try {
      const requestedIds = members.map((m) => m.user_id)
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
      // Everyone passed in here already cleared the roster's own "active"
      // filter -- the only reason the RPC would still skip one is an
      // existing live ('suggested'/'adopted') suggestion for this skill.
      const skippedEmails = requestedIds
        .filter((id) => !insertedIds.has(id))
        .map((id) => members.find((m) => m.user_id === id)?.email || id)
      onAssigned({ kind: 'skill', count: inserted.length, skippedEmails })
    } catch (err) {
      setError(err.message)
      setAssigning(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="assign-skill-dialog-title"
      onClose={assigning ? undefined : onClose}
      closeOnBackdrop={!assigning}
      panelClassName="w-full max-w-3xl bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 id="assign-skill-dialog-title" className="font-display text-xl text-ink mb-1">Assign skill</h2>
      <p className="text-sm text-secondary mb-4">
        Suggest a skill (and optionally a target level/date) to {members.length} selected learner{members.length === 1 ? '' : 's'}.
        They'll see it on their Actions page and decide whether to add it to their own profile -- this doesn't
        touch their skills automatically.
      </p>
      {skippedCount > 0 && (
        <p className="text-xs text-secondary mb-4">
          {skippedCount} of the selected user{skippedCount === 1 ? '' : 's'} {skippedCount === 1 ? 'is' : 'are'} not an active employer member and won't be included.
        </p>
      )}

      <MutationFeedback status="error" message={error} size="xs" className="mb-3" />

      {loading ? (
        <p className="text-sm text-secondary">Loading the skill library…</p>
      ) : (
        <form onSubmit={handleAssign} className="space-y-3">
          <div className="relative">
            <label className="block text-xs text-secondary mb-1" htmlFor="employerAssignSkill">
              Skill
            </label>
            <input
              id="employerAssignSkill"
              value={skillQuery}
              onChange={(e) => {
                setSkillQuery(e.target.value)
                if (selectedSkill) setSelectedSkill(null)
              }}
              placeholder="Search the skill library…"
              autoComplete="off"
              className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
            {selectedSkill && (
              <button
                type="button"
                onClick={clearSkill}
                className="mt-1 text-xs text-secondary hover:text-ink hover:underline"
              >
                Change
              </button>
            )}
            {!selectedSkill && skillQuery.trim() && (
              <div className="absolute z-10 mt-1 w-full bg-card border border-hairline rounded-md shadow-sm max-h-56 overflow-y-auto">
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
              <label className="block text-xs text-secondary mb-1" htmlFor="employerAssignLevel">
                Target level (optional)
              </label>
              <select
                id="employerAssignLevel"
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
              <label className="block text-xs text-secondary mb-1" htmlFor="employerAssignDate">
                Target date {targetLevel ? '' : '(optional)'}
              </label>
              <input
                id="employerAssignDate"
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-secondary mb-1" htmlFor="employerAssignComments">
              Why this matters (optional)
            </label>
            <textarea
              id="employerAssignComments"
              rows={2}
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={assigning}
              className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!selectedSkill || assigning}
              className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
            >
              {assigning ? 'Assigning…' : `Assign to ${members.length}`}
            </button>
          </div>
        </form>
      )}
      <section aria-labelledby="employer-skill-history-heading" className="mt-6 border-t border-hairline pt-6">
        <EmployerSkillAssignmentsHistory
          employer={employer}
          members={members}
          searchParams={historyParams}
          setSearchParams={setHistoryParams}
        />
      </section>
    </AccessibleDialog>
  )
}

// Role profile picker for the "Assign role profile" bulk action on the Users
// tab's learner roster (EmployerLearnersPanel) -- mirrors AssignTrainingModal/
// AssignSkillModal's shape, except assign_employer_role_profile only takes
// one employer_member_id at a time (no bulk RPC, unlike course/skill
// assignment), so this calls it once per selected member via
// Promise.allSettled and reports failures as skipped the same way
// handleBulkImport (above) already does for invites. Assigning only
// *proposes* the role (same as RoleProfileLinkedEmployeesPanel's own
// onAssignEmployee) -- each employee still has to accept it themselves and
// link it to one of their own current roles before it's linked. The RPC
// also only accepts an active employer_members row with role='member', so a
// selected employer admin always lands in the skipped bucket -- selection
// here isn't filtered to exclude them (the roster's own "active" filter is
// shared across all three bulk actions), so that's reported the same way as
// an already-live assignment rather than distinguished.
function AssignRoleModal({ employer, members, skippedCount = 0, onClose, onAssigned }) {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [assigning, setAssigning] = useState(false)

  useEffect(() => {
    listEmployerRoleProfiles(employer.id)
      .then(setProfiles)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [employer.id])

  async function handleAssign(e) {
    e.preventDefault()
    if (!selectedProfileId) return
    setAssigning(true)
    setError(null)
    try {
      const results = await Promise.allSettled(
        members.map((member) => assignEmployerRoleProfile(selectedProfileId, member.id))
      )
      const skippedEmails = members
        .filter((_, index) => results[index].status === 'rejected')
        .map((member) => member.email || member.user_id)
      onAssigned({ kind: 'role', count: results.length - skippedEmails.length, skippedEmails })
    } catch (err) {
      setError(err.message)
      setAssigning(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="assign-role-dialog-title"
      onClose={assigning ? undefined : onClose}
      closeOnBackdrop={!assigning}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 id="assign-role-dialog-title" className="font-display text-xl text-ink mb-1">Assign role profile</h2>
      <p className="text-sm text-secondary mb-4">
        Propose one of {employer.name}'s role profiles to {members.length} selected learner{members.length === 1 ? '' : 's'}.
        They'll see it on their Actions page and choose whether to link it to one of their own current roles --
        this doesn't change their profile automatically.
      </p>
      {skippedCount > 0 && (
        <p className="text-xs text-secondary mb-4">
          {skippedCount} of the selected user{skippedCount === 1 ? '' : 's'} {skippedCount === 1 ? 'is' : 'are'} not an active employer member and won't be included.
        </p>
      )}

      <MutationFeedback status="error" message={error} size="xs" className="mb-3" />

      {loading ? (
        <p className="text-sm text-secondary">Loading role profiles…</p>
      ) : profiles.length === 0 ? (
        <p className="text-sm text-secondary">
          No role profiles yet -- create one from the Role profiles tab first.
        </p>
      ) : (
        <form onSubmit={handleAssign} className="space-y-4">
          <div>
            <label className="block text-xs text-secondary mb-1" htmlFor="employerAssignRoleProfile">
              Role profile
            </label>
            <select
              id="employerAssignRoleProfile"
              required
              value={selectedProfileId}
              onChange={(e) => setSelectedProfileId(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            >
              <option value="">Choose a role profile…</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={assigning}
              className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!selectedProfileId || assigning}
              className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
            >
              {assigning ? 'Assigning…' : `Propose to ${members.length}`}
            </button>
          </div>
        </form>
      )}
    </AccessibleDialog>
  )
}

// Assignment history for the selected users in the matching assignment dialog.

function EmployerSkillAssignmentsHistory({ employer, members, searchParams, setSearchParams }) {
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    load()
  }, [employer.id, members])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const rows = await listEmployerSkillSuggestions(employer.id)
      const selectedUserIds = new Set(members.map((member) => member.user_id))
      setSuggestions(rows.filter((row) => selectedUserIds.has(row.learner_id)))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const emailByUserId = useMemo(() => new Map(members.map((m) => [m.user_id, m.email || m.user_id])), [members])
  const suggestionsWithEmail = useMemo(
    () => suggestions.map((s) => ({ ...s, learnerEmail: emailByUserId.get(s.learner_id) })),
    [suggestions, emailByUserId]
  )
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

  return (
    <div>
      <h3 id="employer-skill-history-heading" className="font-display text-base text-ink mb-3">Skills assigned so far</h3>
      <MutationFeedback status="error" message={error} size="xs" className="mb-3" />
      {loading ? (
        <p className="text-xs text-secondary">Loading…</p>
      ) : suggestions.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No skills assigned to the selected users yet.</p>
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
  const { isPlatformAdmin } = useAuth()
  const { columns, visibleColumns, toggleColumn, moveColumn, resetToDefault } =
    useColumnPreferences('employer-providers', EMPLOYER_PROVIDER_COLUMNS)
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="employer-providers-heading" className="font-display text-lg text-ink">Providers</h2>
          {isPlatformAdmin && (
            <ColumnCustomizer
              idPrefix="employer-providers"
              columns={columns}
              onToggle={toggleColumn}
              onMove={moveColumn}
              onReset={resetToDefault}
            />
          )}
        </div>
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
                      {visibleColumns.map((col) =>
                        col.sortable ? (
                          <SortableTh key={col.key} label={col.label} columnKey={col.key} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className={col.thClassName} />
                        ) : (
                          <th key={col.key} className={`px-4 py-2 font-medium ${col.thClassName || ''}`}>{col.label}</th>
                        )
                      )}
                      <th className="px-4 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((p) => (
                      <tr key={p.id} className="border-b border-hairline last:border-0">
                        {visibleColumns.map((col) => (
                          <td key={col.key} className={col.cellClassName}>
                            {col.renderCell(p)}
                          </td>
                        ))}
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
