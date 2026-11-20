import ProviderSharingPanel from '../../components/ProviderSharingPanel'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import AppHeader from '../../components/AppHeader'
import ResourceLibrarySection from '../../components/ResourceLibrarySection'
import ProviderSkillsSection from '../../components/ProviderSkillsSection'
import ProviderLtiToolsSection from '../../components/ProviderLtiToolsSection'
import { ProviderTrainingSection, ProviderCataloguesSection } from '../provider/ProviderConsole'
import EmployerMemberFieldsDialog from './EmployerMemberFieldsDialog'
import EmployerSettingsMenu from './EmployerSettingsMenu'
import ScrollableNavBar from '../../components/ScrollableNavBar'
import useAnchoredMenuPosition from '../../lib/useAnchoredMenuPosition'
import { listOrganisations } from '../../lib/admin/organisations'
import { handleTabListKeyDown } from '../../lib/tabsKeyboard'
import MutationFeedback from '../../components/MutationFeedback'
import OrganisationSwitcher from '../../components/OrganisationSwitcher'
import EmployerRoleProfilesSection from './EmployerRoleProfilesSection'
import EmployerOverviewPanel from './EmployerOverviewPanel'
import EmployerManagementSection from './EmployerManagementSection'
import EmployerCatalogueAccessPanel from './EmployerCatalogueAccessPanel'
import ProviderOverviewPanel from '../provider/ProviderOverviewPanel'
import OrganisationSettingsModal from '../../components/OrganisationSettingsModal'
import { OrganisationStaffPanel } from '../admin/AdminProviders'
import { EmployerLearnersPanel } from './EmployerLearnersPanel'

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
  { key: 'users', label: 'People' },
  { key: 'roles', label: 'Role profiles', workforceOnly: true },
  { key: 'providers', label: 'Distribution' },
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

// One organisation console. Workforce sections use employer_members to keep
// employment relationships distinct from authoring permissions, while the
// training and skills sections use organisation_members. Both scopes share
// the same canonical organisation identity and are composed here according
// to its enabled capabilities.
export default function EmployerConsole() {
  const { user, employerMemberships, organisationMemberships } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [organisations, setOrganisations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [settingsView, setSettingsView] = useState(null)
  // employer/section selection lives in the URL (?employer=&section=), the
  // same convention as ProviderConsole.jsx -- re-derived from searchParams
  // on every render so refresh, Back/Forward, and a shared link all restore
  // the same view.
  const selectedEmployerId = searchParams.get('org')
  const requestedSection = searchParams.get('section') ?? 'overview'
  // Preserve old bookmarked links after merging the former Users and
  // Learners tabs (both legacy destinations now open the combined view),
  // after splitting the former combined Training tab into the separate
  // provider-training/provider-catalogues/provider-resources tabs below (an
  // old link to the bundled view now opens just the Training portion), and
  // after folding the standalone Assign training/Suggest skills tabs into
  // bulk actions on the Users tab's learner roster (EmployerLearnersPanel)
  // -- old links to either now land on Users, where that functionality
  // actually lives now. Member fields has moved into the Settings menu, so
  // an old tab URL safely returns to Overview instead of leaving an invalid
  // tab selected.
  const activeSection = ['staff', 'learners', 'assign', 'suggest-skills'].includes(requestedSection)
    ? 'users'
    : requestedSection === 'member-fields'
      ? 'overview'
      : requestedSection === 'training'
        ? 'provider-training'
        : requestedSection
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
    () => [...new Set([
      ...(employerMemberships ?? []).filter((m) => m.role === 'admin').map((m) => m.employer_id),
      ...(organisationMemberships ?? []).filter((m) => m.role === 'admin').map((m) => m.organisation_id),
    ])],
    [employerMemberships, organisationMemberships]
  )
  const myEmployers = useMemo(
    () => organisations
      .filter((organisation) => myEmployerIds.includes(organisation.id) && organisation.status === 'active')
      .map((organisation) => ({
        ...organisation,
        employer_code: organisation.org_code,
        provider_organisation_id: organisation.id,
      })),
    [organisations, myEmployerIds]
  )
  const selectedEmployer = myEmployers.find((e) => e.id === selectedEmployerId)
  const activeCapabilities = new Set(
    (selectedEmployer?.organisation_capabilities ?? [])
      .filter((item) => item.status === 'active')
      .map((item) => item.capability)
  )
  const hasWorkforceCapability = activeCapabilities.has('employs_people')
  // For an organisation that employs people, the Distribution section is just
  // its linked providers, which lives under the Settings menu instead of the
  // tab bar -- still a normal ?section=providers page, just not a tab.
  const linkedProvidersInSettings = hasWorkforceCapability
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
  // Settings menu items. Organisation-level settings follow the same rules
  // the former cog used: for an organisation that employs people they need
  // the admin role on its (active) provider organisation; otherwise any
  // admin of this workspace could already open them. Member fields only
  // apply to organisations that employ people.
  const settingsOrganisation = hasWorkforceCapability
    ? (myProviderRole === 'admin' ? attachedProviderOrg : null)
    : selectedEmployer
  const settingsItems = [
    ...(settingsOrganisation
      ? [
          {
            key: 'organisation',
            label: 'Organisation details',
            description: 'Logo, brand colours, website, public profile and links',
            onSelect: () => setSettingsView('organisation'),
          },
          {
            key: 'lms-connections',
            label: 'LMS connections',
            description: 'Let other LMSs launch your courses and receive grades',
            to: `/organisation/organisations/${settingsOrganisation.id}/lms-connections`,
          },
          {
            key: 'lti-tools',
            label: 'LTI tools',
            description: 'External tools you can add to courses as resources',
            to: `/organisation/organisations/${settingsOrganisation.id}/lti-tools`,
          },
        ]
      : []),
    ...(linkedProvidersInSettings
      ? [{
          key: 'linked-providers',
          label: 'Linked providers',
          description: 'Training providers whose catalogues and courses you can use',
          to: `?${buildParams({ section: 'providers', ...EMPLOYER_FILTER_RESET }).toString()}`,
        }]
      : []),
    ...(hasWorkforceCapability
      ? [{
          key: 'member-fields',
          label: 'Member fields',
          description: 'Details kept on each member record',
          onSelect: () => setSettingsView('member-fields'),
        }]
      : []),
    ...(hasWorkforceCapability && selectedEmployer
      ? [{
          key: 'learner-workspace',
          label: 'Learner workspace',
          description: 'What members see: sections, Home page and catalogue rules',
          to: `/organisation/organisations/${selectedEmployer.id}/learner-workspace`,
        }]
      : []),
  ]
  const visibleSections = SECTIONS.filter((s) => {
    if (s.workforceOnly && !hasWorkforceCapability) return false
    if (s.adminOnly) return myProviderRole === 'admin'
    if (s.providerOnly) return !!myProviderRole
    return true
  })
  // Guards against a stale provider-only tab surviving a switch to an
  // employer where this admin no longer has the corresponding role.
  const currentSection = visibleSections.some((section) => section.key === activeSection) ? activeSection : 'overview'
  const tabSections = visibleSections.filter((s) => !(linkedProvidersInSettings && s.key === 'providers'))
  const currentSectionIsTab = tabSections.some((s) => s.key === currentSection)
  const providerSections = useMemo(() => visibleSections.filter((s) => s.providerTab), [visibleSections])
  const activeSectionIsProvider = providerSections.some((s) => s.key === currentSection)
  // Roving-tabindex keys for the top-level tablist's arrow-key navigation
  // (handleTabListKeyDown) -- the four providerTab sections collapse into
  // one 'provider-group' stop (the dropdown trigger button below) instead
  // of four separate stops, mirroring how they're rendered as a single
  // control rather than four tabs.
  const rovingSectionKeys = useMemo(() => {
    const keys = []
    tabSections.forEach((section, index) => {
      if (section.providerTab) {
        if (!tabSections[index - 1]?.providerTab) keys.push('provider-group')
      } else {
        keys.push(section.key)
      }
    })
    return keys
  }, [tabSections])
  // On a section opened from Settings (no tab of its own), Overview keeps the
  // tablist's single Tab stop so keyboard users can still reach the tabs.
  const rovingActiveKey = activeSectionIsProvider ? 'provider-group' : currentSectionIsTab ? currentSection : 'overview'
  // Keeps the selected tab visible in the sideways-scrolling tab bar.
  useEffect(() => {
    sectionTabRefs.current[rovingActiveKey]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [rovingActiveKey])
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
    listOrganisations()
      .then(setOrganisations)
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
      setSearchParams(buildParams({ org: myEmployers[0].id, employer: null }), { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myEmployers, selectedEmployerId])

  return (
    <div className="min-h-screen bg-paper">
      {/* hideNavLinks: same reasoning as ProviderConsole.jsx -- this is a
          distinct workspace from the learner-facing app. */}
      <AppHeader hideNavLinks />
      <main id="main-content" tabIndex={-1} className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="font-display text-xl text-ink mb-1">Organisation workspace</h1>
        <p className="text-sm text-secondary mb-6">
          Manage your people, roles, learning content and distribution from one place.
        </p>

        <MutationFeedback status="error" message={error} className="mb-4" />

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : myEmployers.length === 0 ? (
          <p className="text-secondary">You don't have administration access to an organisation.</p>
        ) : (
          <>
            {myEmployers.length > 1 && (
              <div className="mb-6">
                {/* Clears the (read-only) training list's own filters on an
                    employer switch, same reasoning as ProviderConsole's org
                    switcher -- a stale q/status filter would otherwise carry
                    over and make the new employer's list look empty/wrong. */}
                <OrganisationSwitcher
                  organisations={myEmployers}
                  selectedId={selectedEmployerId}
                  onChange={(employerId) => setSearchParams(buildParams({ org: employerId, employer: null, ...EMPLOYER_FILTER_RESET }))}
                />
              </div>
            )}

            {selectedEmployer && (
              <div>
                {/* One row on every screen size -- see ScrollableNavBar. */}
                <ScrollableNavBar className="mb-6">
                  <div role="tablist" aria-label="Console section" className="flex items-end gap-x-1 shrink-0">
                    {tabSections.map((section, index) => {
                      if (section.providerTab) {
                        // Renders once for the whole consecutive run of
                        // providerTab sections (Training/Skills/Catalogues/
                        // Resources), as a single "Provider" dropdown rather
                        // than four standalone tabs -- the tabs behave
                        // identically either way (same ?section= navigation,
                        // same employer-console frame), this only changes how
                        // they're grouped in the tab bar.
                        if (tabSections[index - 1]?.providerTab) return null
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
                          tabIndex={rovingActiveKey === section.key ? 0 : -1}
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
                          className={`shrink-0 text-sm px-3 py-2 border-b-2 whitespace-nowrap ${
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
                  <EmployerSettingsMenu items={settingsItems} active={!currentSectionIsTab} />
                </ScrollableNavBar>

                <div
                  id={`employer-section-panel-${currentSection}`}
                  {...(currentSectionIsTab
                    ? {
                        role: 'tabpanel',
                        'aria-labelledby': activeSectionIsProvider
                          ? 'employer-section-tab-provider-group'
                          : `employer-section-tab-${currentSection}`,
                      }
                    : { role: 'region', 'aria-label': 'Linked providers' })}
                  tabIndex={0}
                >
                  {currentSection === 'overview' && (
                    hasWorkforceCapability
                      ? <EmployerOverviewPanel key={`${selectedEmployer.id}-overview`} employer={selectedEmployer} />
                      : <ProviderOverviewPanel key={`${selectedEmployer.id}-overview`} organisation={selectedEmployer} role={myProviderRole} />
                  )}
                  {currentSection === 'provider-training' && (
                    <div className="space-y-4">
                      {!myProviderRole && (
                        <p className="text-sm text-secondary">
                          This view is read-only. Ask an organisation administrator to manage courses.
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
                        detailContext={`&org=${encodeURIComponent(selectedEmployer.id)}`}
                      />
                    </div>
                  )}
                  {currentSection === 'provider-catalogues' && (
                    <div className="space-y-4">
                      {hasWorkforceCapability && <EmployerCatalogueAccessPanel employerId={selectedEmployer.id} />}
                      {!myProviderRole && (
                        <p className="text-sm text-secondary">
                          This view is read-only. Ask an organisation administrator to manage catalogues.
                        </p>
                      )}
                      <ProviderCataloguesSection
                        key={`${selectedEmployer.id}-catalogues`}
                        organisation={{ id: selectedEmployer.provider_organisation_id }}
                        userId={user.id}
                        canCreate={myProviderRole === 'admin'}
                        readOnly={!myProviderRole}
                        detailContext={`&org=${encodeURIComponent(selectedEmployer.id)}`}
                      />
                    </div>
                  )}
                  {currentSection === 'provider-resources' && (
                    <div className="space-y-4">
                      {!myProviderRole && (
                        <p className="text-sm text-secondary">
                          This view is read-only. Ask an organisation administrator to manage resources.
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
                    hasWorkforceCapability ? (
                      <EmployerUsersPanel
                        key={`${selectedEmployer.id}-users`}
                        employer={selectedEmployer}
                        attachedProviderOrg={attachedProviderOrg}
                        canManageTrainingTeam={myProviderRole === 'admin'}
                        searchParams={searchParams}
                        setSearchParams={setSearchParams}
                      />
                    ) : (
                      <OrganisationStaffPanel key={`${selectedEmployer.id}-users`} organisation={selectedEmployer} heading="People" />
                    )
                  )}
                  {currentSection === 'roles' && (
                    <EmployerRoleProfilesSection
                      key={selectedEmployer.id}
                      employer={selectedEmployer}
                      user={user}
                      searchParams={searchParams}
                      setSearchParams={setSearchParams}
                      onOpenProfile={(id) => navigate(`/organisation/roles/${id}`)}
                    />
                  )}
                  {currentSection === 'providers' && (
                    hasWorkforceCapability ? (
                      <EmployerProvidersPanel
                        key={selectedEmployer.id}
                        employer={selectedEmployer}
                        user={user}
                        searchParams={searchParams}
                        setSearchParams={setSearchParams}
                      />
                    ) : (
                      <ProviderSharingPanel key={selectedEmployer.id} side="provider" organisation={selectedEmployer} userId={user.id} />
                    )
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {settingsView === 'organisation' && settingsOrganisation && (
        <OrganisationSettingsModal
          organisation={settingsOrganisation}
          learnerPortal={hasWorkforceCapability ? { name: selectedEmployer.name } : undefined}
          onClose={() => {
            setSettingsView(null)
            reloadOrganisations()
          }}
        />
      )}
      {settingsView === 'member-fields' && selectedEmployer && hasWorkforceCapability && (
        <EmployerMemberFieldsDialog
          employer={selectedEmployer}
          userId={user.id}
          onClose={() => setSettingsView(null)}
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
  const localButtonRef = useRef(null)
  const menuRef = useRef(null)
  const menuStyle = useAnchoredMenuPosition({
    open,
    buttonRef: localButtonRef,
    menuRef,
    align: 'left',
  })
  const containerRef = useRef(null)
  const itemRefs = useRef([])

  // The menu is portalled to <body> (see useAnchoredMenuPosition), so focus
  // moves into it on open, and clicks inside it aren't "outside" clicks.
  useEffect(() => {
    if (!open) return undefined
    itemRefs.current[0]?.focus({ preventScroll: true })
    function handleOutside(e) {
      if (!containerRef.current?.contains(e.target) && !menuRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  function closeMenu() {
    setOpen(false)
    localButtonRef.current?.focus({ preventScroll: true })
  }

  function handleMenuKeyDown(event) {
    const elements = itemRefs.current.filter(Boolean)
    const index = elements.indexOf(document.activeElement)
    const focusAt = (i) => elements[(i + elements.length) % elements.length]?.focus({ preventScroll: true })
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusAt(index + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusAt(index - 1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu()
    } else if (event.key === 'Tab') {
      closeMenu()
    }
  }

  const activeItem = items.find((item) => item.key === currentSection)

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        type="button"
        ref={(el) => {
          localButtonRef.current = el
          buttonRef?.(el)
        }}
        id="employer-section-tab-provider-group"
        role="tab"
        aria-selected={isActive}
        aria-controls={isActive ? `employer-section-panel-${currentSection}` : undefined}
        aria-haspopup="true"
        aria-expanded={open}
        tabIndex={isActive ? 0 : -1}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        className={`flex items-center gap-1 text-sm px-3 py-2 border-b-2 whitespace-nowrap ${
          isActive ? 'border-moss text-ink font-medium' : 'border-transparent text-secondary hover:text-ink'
        }`}
      >
        {activeItem ? `Learning content: ${activeItem.label}` : 'Learning content'}
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="Learning content"
          onKeyDown={handleMenuKeyDown}
          style={menuStyle}
          className="z-40 min-w-[10rem] bg-card border border-hairline rounded-md shadow-lg py-1"
        >
          {items.map((item, index) => (
            <Link
              key={item.key}
              ref={(el) => { itemRefs.current[index] = el }}
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
        </div>,
        document.body
      )}
    </div>
  )
}

export function EmployerUsersPanel({ employer, attachedProviderOrg, canManageTrainingTeam, searchParams, setSearchParams }) {
  const usersView = searchParams.get('usersView')
  const showManagement = usersView === 'reporting'

  function viewParams(view) {
    const next = new URLSearchParams(searchParams)
    if (view) next.set('usersView', view)
    else next.delete('usersView')
    ;['q', 'status', 'sort', 'dir', 'page', 'pageSize'].forEach((key) => next.delete(key))
    return next
  }

  if (usersView === 'add') {
    return (
      <EmployerLearnersPanel
        employer={employer}
        searchParams={searchParams}
        setSearchParams={setSearchParams}
        attachedProviderOrg={canManageTrainingTeam ? attachedProviderOrg : null}
      />
    )
  }

  return (
    <div>
      <nav aria-label="People workspace" className="mb-6 flex flex-wrap gap-1 border-b border-hairline">
        <Link
          to={`?${viewParams(null)}`}
          aria-current={!showManagement ? 'page' : undefined}
          className={`px-3 py-2 -mb-px border-b-2 text-sm whitespace-nowrap ${
            !showManagement ? 'border-moss text-ink font-medium' : 'border-transparent text-secondary hover:text-ink'
          }`}
        >
          People
        </Link>
        <Link
          to={`?${viewParams('reporting')}`}
          aria-current={showManagement ? 'page' : undefined}
          className={`px-3 py-2 -mb-px border-b-2 text-sm whitespace-nowrap ${
            showManagement ? 'border-moss text-ink font-medium' : 'border-transparent text-secondary hover:text-ink'
          }`}
        >
          Reporting &amp; management
        </Link>
      </nav>

      {showManagement ? (
        <EmployerManagementSection employer={employer} />
      ) : (
        <EmployerLearnersPanel
          employer={employer}
          searchParams={searchParams}
          setSearchParams={setSearchParams}
          attachedProviderOrg={canManageTrainingTeam ? attachedProviderOrg : null}
        />
      )}
    </div>
  )
}

// The main provider is permanent; additional providers require confirmed sharing.
function EmployerProvidersPanel({ employer, user }) {
  return <ProviderSharingPanel key={employer.id} employer={employer} userId={user.id} />
}
