import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import AppHeader from '../../components/AppHeader'
import { useAuth } from '../../context/AuthContext'
import { listOrganisationMembers } from '../../lib/admin/organisations'
import { listOrganisationOfferedSkills } from '../../lib/admin/providerSkills'
import { listPublishedOrganisationResources } from '../../lib/courseContent'
import {
  addProviderCatalogueResource,
  addProviderCatalogueSkill,
  assignProviderCourseToCatalogue,
  approveProviderCatalogueCourse,
  getProviderCatalogue,
  listProviderCatalogueCourses,
  listProviderCatalogueMembers,
  listPublishedProviderCourses,
  listProviderCatalogueResources,
  listProviderCatalogueSkills,
  removeProviderCatalogueMember,
  removeProviderCatalogueResource,
  removeProviderCatalogueSkill,
  updateProviderCatalogue,
  upsertProviderCatalogueMember,
} from '../../lib/admin/providerCatalogues'
import { COURSE_STATUS_LABELS, RESOURCE_TYPE_LABELS } from '../../lib/statusLabels'
import { handleTabListKeyDown } from '../../lib/tabsKeyboard'
import { useRowSelection } from '../../lib/useSortedPage'
import { BulkActionBar } from '../../components/TableControls'

const TABS = [
  { key: 'courses', label: 'Courses' },
  { key: 'skills', label: 'Skills' },
  { key: 'resources', label: 'Resources' },
]

export default function ProviderCatalogueDetail() {
  const { catalogueId } = useParams()
  const { user, organisationMemberships } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [catalogue, setCatalogue] = useState(null)
  const [courses, setCourses] = useState([])
  const [organisationCourses, setOrganisationCourses] = useState([])
  const [skills, setSkills] = useState([])
  const [resources, setResources] = useState([])
  const [members, setMembers] = useState([])
  const [orgMembers, setOrgMembers] = useState([])
  const [offeredSkills, setOfferedSkills] = useState([])
  const [organisationResources, setOrganisationResources] = useState([])
  // ?tab= (default 'courses') -- mirrors ProviderSkillDetail.jsx's own tab
  // query param, so refresh/Back/Forward/a shared link all land on the
  // same catalogue-detail tab instead of resetting to Courses.
  const activeTab = TABS.some((t) => t.key === searchParams.get('tab')) ? searchParams.get('tab') : 'courses'
  // Users/approvers used to be its own tab; it's a catalogue setting now
  // (see the header cog below), but the catalogue list's "N users" link
  // (ProviderConsole.jsx) still points at ?tab=users, so that same param
  // keeps working as the deep link into this settings panel.
  const showUsersPanel = searchParams.get('tab') === 'users'
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', description: '', learnerVisible: false })
  const [saving, setSaving] = useState(false)
  const tabRefs = useRef({})

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const catalogueData = await getProviderCatalogue(catalogueId)
      if (!catalogueData) {
        setCatalogue(null)
        return
      }
      const [courseData, organisationCourseData, skillData, resourceData, memberData, organisationMemberData, offeredSkillData, organisationResourceData] = await Promise.all([
        listProviderCatalogueCourses(catalogueId),
        listPublishedProviderCourses(catalogueData.organisation_id),
        listProviderCatalogueSkills(catalogueId),
        listProviderCatalogueResources(catalogueId),
        listProviderCatalogueMembers(catalogueId),
        listOrganisationMembers(catalogueData.organisation_id),
        listOrganisationOfferedSkills(catalogueData.organisation_id),
        listPublishedOrganisationResources(catalogueData.organisation_id),
      ])
      setCatalogue(catalogueData)
      setEditForm({ name: catalogueData.name, description: catalogueData.description ?? '', learnerVisible: catalogueData.learner_visible })
      setCourses(courseData)
      setOrganisationCourses(organisationCourseData)
      setSkills(skillData)
      setResources(resourceData)
      setMembers(memberData)
      setOrgMembers(organisationMemberData)
      setOfferedSkills(offeredSkillData)
      setOrganisationResources(organisationResourceData)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // load is also reused after mutations; catalogueId is the route boundary.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogueId])

  const organisationRole = useMemo(
    () => (organisationMemberships ?? []).find((membership) => membership.organisation_id === catalogue?.organisation_id)?.role,
    [catalogue?.organisation_id, organisationMemberships]
  )
  const catalogueRole = members.find((member) => member.user_id === user.id)?.role
  const canManage = organisationRole === 'admin' || catalogueRole === 'admin'
  const canApprove = canManage || catalogueRole === 'approver'

  async function handleSaveCatalogue(event) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const updated = await updateProviderCatalogue(catalogue.id, editForm)
      setCatalogue(updated)
      setEditing(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <ProviderPage><p className="text-secondary" role="status">Loading catalogue…</p></ProviderPage>
  }

  if (!catalogue) {
    return (
      <ProviderPage>
        <h1 className="font-display text-xl text-ink">Catalogue not found</h1>
        <p className="mt-2 text-sm text-secondary">It may have been removed or you may not have access.</p>
        <Link to="/provider" className="mt-4 inline-block text-sm font-medium text-moss hover:underline">Back to provider console</Link>
      </ProviderPage>
    )
  }

  // Reconstructed from the loaded catalogue itself, not passed-through
  // navigation state -- so "All catalogues" always returns to the right
  // organisation/section even after a refresh or a bookmarked link here.
  const backToProviderConsole = `/provider?org=${catalogue.organisation_id}&section=catalogues`

  return (
    <ProviderPage>
      <Link to={backToProviderConsole} className="text-sm text-secondary hover:text-ink">← All catalogues</Link>
      <div className="mt-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl text-ink">{catalogue.name}</h1>
          <p className="mt-1 max-w-2xl text-sm text-secondary">
            {catalogue.description || 'Courses, skills and the people responsible for this catalogue.'}
          </p>
        </div>
        {canManage && (
          <CogMenu
            label="Catalogue settings"
            onEdit={() => {
              setEditing((value) => !value)
              if (showUsersPanel) setSearchParams({})
            }}
            options={[
              {
                label: 'Manage users & approvers',
                action: () => {
                  setEditing(false)
                  setSearchParams(showUsersPanel ? {} : { tab: 'users' })
                },
              },
            ]}
          />
        )}
      </div>

      {showUsersPanel && (
        <div className="mt-5 border-y border-hairline py-5">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-secondary">Catalogue setting</p>
            <button type="button" onClick={() => setSearchParams({})} className="text-xs font-medium text-secondary hover:text-ink">Close</button>
          </div>
          <UsersTab catalogueId={catalogue.id} members={members} orgMembers={orgMembers} canManage={canManage} userId={user.id} onReload={load} onError={setError} />
        </div>
      )}

      {editing && (
        <form onSubmit={handleSaveCatalogue} className="mt-5 border-y border-hairline py-5 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-secondary">Name
              <input required value={editForm.name} onChange={(event) => setEditForm((form) => ({ ...form, name: event.target.value }))} className="mt-1 w-full rounded-md border border-hairline bg-card px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
            </label>
            <label className="text-sm text-secondary sm:row-span-2">Description
              <textarea rows={3} value={editForm.description} onChange={(event) => setEditForm((form) => ({ ...form, description: event.target.value }))} className="mt-1 w-full rounded-md border border-hairline bg-card px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
            </label>
          </div>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={editForm.learnerVisible}
              onChange={(event) => setEditForm((form) => ({ ...form, learnerVisible: event.target.checked }))}
              className="mt-0.5 rounded border-hairline accent-moss"
            />
            <span>
              Learner-facing
              <span className="block text-xs text-secondary">Its courses can appear on your public provider profile. Leave unchecked to keep this catalogue backend-only, for admin-driven assignment only.</span>
            </span>
          </label>
          <div className="flex gap-2">
            <button disabled={saving} className="rounded-md bg-moss px-3 py-2 text-sm font-medium text-paper disabled:opacity-50">{saving ? 'Saving…' : 'Save catalogue'}</button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-md border border-hairline px-3 py-2 text-sm font-medium text-ink hover:bg-card">Cancel</button>
          </div>
        </form>
      )}

      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}

      <div role="tablist" aria-label="Catalogue sections" className="mt-7 flex flex-wrap gap-1 border-b border-hairline">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            ref={(el) => { tabRefs.current[tab.key] = el }}
            id={`catalogue-tab-${tab.key}`}
            to={{ search: tab.key === 'courses' ? '' : `?tab=${tab.key}` }}
            role="tab"
            aria-selected={activeTab === tab.key}
            aria-controls={`catalogue-panel-${tab.key}`}
            tabIndex={activeTab === tab.key ? 0 : -1}
            onKeyDown={(event) =>
              handleTabListKeyDown(event, {
                keys: TABS.map((t) => t.key),
                activeKey: activeTab,
                refs: tabRefs,
                onChange: (tabKey) => setSearchParams(tabKey === 'courses' ? {} : { tab: tabKey }),
              })
            }
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${activeTab === tab.key ? 'border-moss font-medium text-ink' : 'border-transparent text-secondary hover:text-ink'}`}
          >
            {tab.label}
            <span className="ml-2 tabular-nums text-xs text-secondary">{tab.key === 'courses' ? courses.length : tab.key === 'skills' ? skills.length : resources.length}</span>
          </Link>
        ))}
      </div>

      <div
        id={`catalogue-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`catalogue-tab-${activeTab}`}
        tabIndex={0}
        className="pt-6"
      >
        {activeTab === 'courses' && <CoursesTab catalogue={catalogue} courses={courses} organisationCourses={organisationCourses} canManage={canManage} canApprove={canApprove} onReload={load} onError={setError} />}
        {activeTab === 'skills' && <SkillsTab catalogueId={catalogue.id} skills={skills} offeredSkills={offeredSkills} canManage={canManage} userId={user.id} onReload={load} onError={setError} />}
        {activeTab === 'resources' && <ResourcesTab catalogueId={catalogue.id} resources={resources} organisationResources={organisationResources} canManage={canManage} userId={user.id} onReload={load} onError={setError} />}
      </div>
    </ProviderPage>
  )
}

function ProviderPage({ children }) {
  return <div className="min-h-screen bg-paper"><AppHeader hideNavLinks /><main id="main-content" tabIndex={-1} className="mx-auto max-w-5xl px-4 py-8">{children}</main></div>
}

function CoursesTab({ catalogue, courses, organisationCourses, canManage, canApprove, onReload, onError }) {
  const [adding, setAdding] = useState(false)
  const available = organisationCourses.filter((course) => !courses.some((assigned) => assigned.id === course.id))

  async function handleApprove(courseId) {
    onError(null)
    try {
      await approveProviderCatalogueCourse(courseId)
      await onReload()
    } catch (err) {
      onError(err.message)
    }
  }

  return (
    <section>
      <SectionHeading title="Courses" description="Training available through this catalogue." action={canManage && available.length ? { label: adding ? 'Cancel' : 'Add courses', onClick: () => setAdding((value) => !value) } : null} />
      {adding && (
        <MultiAddList
          items={available}
          getId={(course) => course.id}
          renderLabel={(course) => course.name}
          renderMeta={(course) => `${course.course_code || course.course_type || 'Course'} · Published`}
          addOne={(course) => assignProviderCourseToCatalogue(catalogue.id, course.id)}
          onDone={onReload}
          onError={onError}
          addingLabel="Add courses"
          introText="Choose from your organisation’s published courses."
        />
      )}
      {courses.length === 0 ? <EmptyState>No courses have been added to this catalogue.</EmptyState> : (
        <ul className="divide-y divide-hairline border-y border-hairline">
          {courses.map((course) => (
            <li key={course.id} className="flex items-center justify-between gap-4 py-4">
              <div className="min-w-0"><Link to={`/provider/training/${course.id}`} className="font-medium text-ink hover:text-moss">{course.name}</Link><p className="mt-1 text-sm text-secondary">{course.course_type || 'Course'}{course.duration ? ` · ${course.duration}` : ''}</p></div>
              <div className="flex items-center gap-3"><span className="text-xs text-secondary">{COURSE_STATUS_LABELS[course.status] ?? course.status}</span>{(canManage || (canApprove && course.status === 'pending_approval')) && <CogMenu label={`Manage ${course.name}`} href={canManage ? `/provider/training/${course.id}` : null} options={canApprove && course.status === 'pending_approval' ? [{ label: 'Approve course', action: () => handleApprove(course.id) }] : []} />}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function SkillsTab({ catalogueId, skills, offeredSkills, canManage, userId, onReload, onError }) {
  const [adding, setAdding] = useState(false)
  const available = offeredSkills.filter((offered) => !skills.some((skill) => skill.id === offered.skillLibraryId))
  async function remove(linkId) { onError(null); try { await removeProviderCatalogueSkill(linkId); await onReload() } catch (err) { onError(err.message) } }
  return <section><SectionHeading title="Skills" description="Capabilities represented by the courses in this catalogue." action={canManage && available.length ? { label: adding ? 'Cancel' : 'Add skills', onClick: () => setAdding((value) => !value) } : null} />
    {adding && (
      <MultiAddList
        items={available}
        getId={(skill) => skill.skillLibraryId}
        renderLabel={(skill) => skill.name}
        addOne={(skill) => addProviderCatalogueSkill(catalogueId, skill.skillLibraryId, userId)}
        onDone={onReload}
        onError={onError}
        addingLabel="Add skills"
        introText="Choose from skills your organisation offers."
      />
    )}
    {skills.length === 0 ? <EmptyState>No skills have been added to this catalogue.</EmptyState> : <ul className="divide-y divide-hairline border-y border-hairline">{skills.map((skill) => <li key={skill.linkId} className="flex items-center justify-between gap-4 py-4"><div><p className="font-medium text-ink">{skill.name}</p><p className="mt-1 text-sm text-secondary">{skill.category || 'Uncategorised'}</p></div>{canManage && <CogMenu label={`Manage ${skill.name}`} destructiveLabel="Remove from catalogue" onDestructive={() => remove(skill.linkId)} />}</li>)}</ul>}
  </section>
}

function ResourcesTab({ catalogueId, resources, organisationResources, canManage, userId, onReload, onError }) {
  const [adding, setAdding] = useState(false)
  const available = organisationResources.filter((resource) =>
    resource.status === 'published'
    && resource.is_current_published
    && !resources.some((assigned) => assigned.id === resource.id)
  )

  async function remove(linkId) {
    onError(null)
    try {
      await removeProviderCatalogueResource(linkId)
      await onReload()
    } catch (err) {
      onError(err.message)
    }
  }

  return <section><SectionHeading title="Resources" description="Learning resources shared through this catalogue." action={canManage && available.length ? { label: adding ? 'Cancel' : 'Add resources', onClick: () => setAdding((value) => !value) } : null} />
    {adding && (
      <MultiAddList
        items={available}
        getId={(resource) => resource.id}
        renderLabel={(resource) => resource.title}
        renderMeta={(resource) => RESOURCE_TYPE_LABELS[resource.type] ?? resource.type}
        addOne={(resource) => addProviderCatalogueResource(catalogueId, resource.id, userId)}
        onDone={onReload}
        onError={onError}
        addingLabel="Add resources"
        introText="Choose from your organisation’s resource library."
      />
    )}
    {resources.length === 0 ? <EmptyState>No resources have been added to this catalogue.</EmptyState> : <ul className="divide-y divide-hairline border-y border-hairline">{resources.map((resource) => <li key={resource.linkId} className="flex items-center justify-between gap-4 py-4"><div className="min-w-0"><p className="truncate font-medium text-ink">{resource.title}</p><p className="mt-1 text-sm text-secondary">{RESOURCE_TYPE_LABELS[resource.type] ?? resource.type} · v{resource.version_number ?? 1}</p></div>{canManage && <CogMenu label={`Manage ${resource.title}`} destructiveLabel="Remove from catalogue" onDestructive={() => remove(resource.linkId)} />}</li>)}</ul>}
    {resources.length > 0 && canManage && <p className="mt-3 text-xs text-secondary">Removing a resource only unlinks it from this catalogue.</p>}
  </section>
}

function UsersTab({ catalogueId, members, orgMembers, canManage, userId, onReload, onError }) {
  const [adding, setAdding] = useState(false)
  const [selectedUser, setSelectedUser] = useState('')
  const [role, setRole] = useState('admin')
  const emailByUser = new Map(orgMembers.map((member) => [member.user_id, member.email || member.user_id]))
  const inheritedAdmins = orgMembers
    .filter((member) => member.status === 'active' && member.role === 'admin')
    .map((member) => ({ ...member, id: `organisation-admin-${member.user_id}`, role: 'admin', inherited: true }))
  const effectiveMembers = [
    ...inheritedAdmins,
    ...members.filter((member) => !inheritedAdmins.some((admin) => admin.user_id === member.user_id)),
  ]
  const available = orgMembers.filter((member) => member.status !== 'pending' && !effectiveMembers.some((item) => item.user_id === member.user_id))
  async function saveMember(event) { event.preventDefault(); onError(null); try { await upsertProviderCatalogueMember(catalogueId, selectedUser, role, userId); setAdding(false); setSelectedUser(''); await onReload() } catch (err) { onError(err.message) } }
  async function changeRole(member, nextRole) { onError(null); try { await upsertProviderCatalogueMember(catalogueId, member.user_id, nextRole, userId); await onReload() } catch (err) { onError(err.message) } }
  async function remove(id) { onError(null); try { await removeProviderCatalogueMember(id); await onReload() } catch (err) { onError(err.message) } }
  return <section><SectionHeading title="Users" description="Catalogue admins manage content and access. Approvers review what is ready to publish." action={canManage && available.length ? { label: adding ? 'Cancel' : 'Add user', onClick: () => setAdding((value) => !value) } : null} />
    {adding && <form onSubmit={saveMember} className="mb-5 flex flex-wrap items-end gap-3 border-y border-hairline py-4"><label className="min-w-[220px] flex-1 text-sm text-secondary">Organisation user<select required value={selectedUser} onChange={(event) => setSelectedUser(event.target.value)} className="mt-1 w-full rounded-md border border-hairline bg-card px-3 py-2 text-ink"><option value="">Choose a user…</option>{available.map((member) => <option key={member.user_id} value={member.user_id}>{member.email || member.user_id}</option>)}</select></label><label className="text-sm text-secondary">Catalogue role<select value={role} onChange={(event) => setRole(event.target.value)} className="mt-1 block rounded-md border border-hairline bg-card px-3 py-2 text-ink"><option value="admin">Admin</option><option value="approver">Approver</option></select></label><button disabled={!selectedUser} className="rounded-md bg-moss px-3 py-2 text-sm font-medium text-paper disabled:opacity-50">Add user</button></form>}
    {effectiveMembers.length === 0 ? <EmptyState>No catalogue users yet.</EmptyState> : <ul className="divide-y divide-hairline border-y border-hairline">{effectiveMembers.map((member) => <li key={member.id} className="flex items-center justify-between gap-4 py-4"><div className="min-w-0"><p className="truncate font-medium text-ink">{emailByUser.get(member.user_id) || member.user_id}</p><p className="mt-1 text-sm text-secondary">{member.inherited ? 'Organisation admin · Catalogue admin' : `Catalogue ${member.role}`}</p></div>{canManage && !member.inherited && <CogMenu label={`Manage ${emailByUser.get(member.user_id) || 'user'}`} options={[member.role === 'admin' ? { label: 'Make approver', action: () => changeRole(member, 'approver') } : { label: 'Make admin', action: () => changeRole(member, 'admin') }]} destructiveLabel="Remove from catalogue" onDestructive={() => remove(member.id)} />}</li>)}</ul>}
  </section>
}

// Shared by the Courses/Skills/Resources "available to add" pickers above --
// select any number of items and add them all in one action, instead of the
// old one-Add-click-per-item flow. addOne(item) does the actual per-item
// mutation; this owns just the selection UI and the Promise.allSettled
// partial-failure idiom already used by ResourceLibrarySection.jsx's own
// bulk actions (kept-selected-on-failure, cleared-on-success).
function MultiAddList({ items, getId, renderLabel, renderMeta, addOne, onDone, onError, addingLabel, introText }) {
  const ids = useMemo(() => items.map(getId), [items, getId])
  const selection = useRowSelection(ids)
  const [busy, setBusy] = useState(false)

  async function handleAdd() {
    const targets = items.filter((item) => selection.selected.has(getId(item)))
    setBusy(true)
    onError(null)
    try {
      const results = await Promise.allSettled(targets.map((item) => addOne(item)))
      const failures = results
        .map((result, index) => ({ result, item: targets[index] }))
        .filter(({ result }) => result.status === 'rejected')
      const succeededIds = targets.filter((_, index) => results[index].status === 'fulfilled').map(getId)
      if (failures.length > 0) selection.clearIds(succeededIds)
      else selection.clear()
      await onDone()
      if (failures.length > 0) {
        onError(
          `${failures.length} of ${targets.length} couldn't be added: ` +
            failures.map(({ item, result }) => `"${renderLabel(item)}" (${result.reason?.message ?? 'unknown error'})`).join('; ')
        )
      }
    } catch (err) {
      onError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-5 border-y border-hairline py-3">
      {introText && <p className="mb-2 text-xs text-secondary">{introText}</p>}
      <label className="mb-2 flex items-center gap-2 text-xs text-secondary">
        <input
          type="checkbox"
          checked={selection.isAllSelected(ids)}
          onChange={() => selection.toggleAll(ids)}
          className="rounded border-hairline accent-moss"
        />
        Select all
      </label>
      <BulkActionBar
        count={selection.selected.size}
        onClear={selection.clear}
        busy={busy}
        actions={[{ label: busy ? 'Adding…' : addingLabel, onClick: handleAdd }]}
      />
      <ul className="divide-y divide-hairline">
        {items.map((item) => {
          const id = getId(item)
          return (
            <li key={id} className="flex items-center gap-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={selection.selected.has(id)}
                onChange={() => selection.toggle(id)}
                className="shrink-0 rounded border-hairline accent-moss"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-ink">{renderLabel(item)}</p>
                {renderMeta && <p className="mt-0.5 text-xs text-secondary">{renderMeta(item)}</p>}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function SectionHeading({ title, description, action }) {
  return <div className="mb-5 flex items-start justify-between gap-4"><div><h2 className="font-display text-lg text-ink">{title}</h2><p className="mt-1 text-sm text-secondary">{description}</p></div>{action && <button type="button" onClick={action.onClick} className="shrink-0 rounded-md bg-moss px-3 py-2 text-sm font-medium text-paper hover:opacity-90">{action.label}</button>}</div>
}

function EmptyState({ children }) { return <div className="border-y border-dashed border-hairline py-12 text-center text-sm text-secondary">{children}</div> }

function CogMenu({ label, onEdit, href, options = [], destructiveLabel, onDestructive }) {
  return <details className="relative"><summary aria-label={label} title={label} className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-md border border-hairline text-secondary hover:bg-card hover:text-ink [&::-webkit-details-marker]:hidden"><CogIcon /></summary><div className="absolute right-0 z-20 mt-2 w-48 overflow-hidden rounded-md border border-hairline bg-card py-1 shadow-lg">{onEdit && <button type="button" onClick={onEdit} className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-paper">Edit catalogue</button>}{href && <Link to={href} className="block px-3 py-2 text-sm text-ink hover:bg-paper">Open course editor</Link>}{options.map((option) => <button key={option.label} type="button" onClick={option.action} className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-paper">{option.label}</button>)}{destructiveLabel && <button type="button" onClick={onDestructive} className="block w-full px-3 py-2 text-left text-sm text-red-700 hover:bg-paper">{destructiveLabel}</button>}</div></details>
}

function CogIcon() { return <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.3 17l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 7 4.3l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1A2 2 0 1 1 19.7 7l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1h.2a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg> }
