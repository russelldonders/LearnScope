import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import { useAuth } from '../context/AuthContext'
import {
  assignCourseToManagedEmployerMember,
  confirmManagedEmployerSkillLevel,
  getMyEmployerTeamMemberSnapshot,
  listManagerAssignableCourses,
  listManagerSuggestibleSkills,
  listMyEmployerTeam,
  suggestSkillToManagedEmployerMember,
} from '../lib/employerManagement'

const DEFAULT_SERVICES = {
  assignCourseToManagedEmployerMember,
  confirmManagedEmployerSkillLevel,
  getMyEmployerTeamMemberSnapshot,
  listManagerAssignableCourses,
  listManagerSuggestibleSkills,
  listMyEmployerTeam,
  suggestSkillToManagedEmployerMember,
}

const RELATIONSHIP_LABELS = {
  primary: 'Primary',
  functional: 'Functional',
  project: 'Project',
  delegate: 'Delegate',
  indirect: 'Indirect',
}

const SCOPE_LABELS = {
  employment: 'Employment details',
  role_assignments: 'Role assignments',
  training_assignments: 'Training assignments',
  skill_management: 'Skill management',
  shared_skills: 'Shared skills',
  shared_skill_evidence: 'Shared evidence',
}

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'TM'
}

function formatDate(value) {
  if (!value) return null
  return new Date(value).toLocaleDateString()
}

function StatusPill({ children, tone = 'neutral' }) {
  const tones = {
    neutral: 'border-hairline text-secondary',
    active: 'border-moss text-moss',
    info: 'border-slate text-slate',
  }
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  )
}

function PersonAvatar({ name, avatarUrl, size = 'md' }) {
  const dimensions = size === 'lg' ? 'h-14 w-14 text-base' : 'h-10 w-10 text-sm'
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-moss text-paper font-medium ${dimensions}`}>
      {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : initials(name)}
    </span>
  )
}

function LoadingRows() {
  return (
    <div className="divide-y divide-hairline border-y border-hairline" aria-label="Loading team">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-4 py-5 animate-pulse">
          <span className="h-10 w-10 rounded-full bg-hairline/30" />
          <div className="flex-1 space-y-2">
            <span className="block h-4 w-36 rounded bg-hairline/30" />
            <span className="block h-3 w-52 rounded bg-hairline/20" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function MyTeam({ services = DEFAULT_SERVICES }) {
  const { employeeMemberId } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { managerContexts, managerContextsError, refreshManagerContexts } = useAuth()
  const contexts = managerContexts ?? []
  const requestedEmployerId = searchParams.get('employer')
  const activeContext = contexts.find((context) => context.employerId === requestedEmployerId) ?? contexts[0]
  const [team, setTeam] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [reportFilter, setReportFilter] = useState('all')

  const loadTeam = useCallback(async () => {
    if (!activeContext) return
    setLoading(true)
    setError(null)
    try {
      setTeam(await services.listMyEmployerTeam(activeContext.employerId))
    } catch (loadError) {
      setTeam([])
      setError(loadError.message || 'Your team could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [activeContext, services])

  useEffect(() => {
    loadTeam()
  }, [loadTeam])

  useEffect(() => {
    if (!activeContext || requestedEmployerId === activeContext.employerId) return
    const next = new URLSearchParams(searchParams)
    next.set('employer', activeContext.employerId)
    setSearchParams(next, { replace: true })
  }, [activeContext, requestedEmployerId, searchParams, setSearchParams])

  const filteredTeam = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return team.filter((member) => {
      if (reportFilter === 'direct' && member.reportDepth !== 1) return false
      if (reportFilter === 'indirect' && member.reportDepth <= 1) return false
      return !query || member.fullName.toLocaleLowerCase().includes(query)
    })
  }, [reportFilter, search, team])

  function selectEmployer(employerId) {
    setSearch('')
    setReportFilter('all')
    navigate(`/team?employer=${encodeURIComponent(employerId)}`)
  }

  if (!activeContext) {
    return (
      <div className="min-h-screen bg-paper">
        <AppHeader />
        <main id="main-content" tabIndex={-1} className="mx-auto max-w-4xl px-4 py-10">
          <p role="alert" className="text-sm text-red-700">
            {managerContextsError ? 'We couldn’t verify your team access.' : 'You do not currently have an active team.'}
          </p>
          {managerContextsError && (
            <button type="button" onClick={refreshManagerContexts} className="mt-4 rounded-md border border-hairline px-3 py-2 text-sm text-ink hover:bg-card">
              Try again
            </button>
          )}
        </main>
      </div>
    )
  }

  if (employeeMemberId) {
    return (
      <TeamMemberDetail
        context={activeContext}
        employeeMemberId={employeeMemberId}
        services={services}
      />
    )
  }

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
        <div className="flex flex-col gap-5 border-b border-hairline pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <h1 className="font-display text-3xl text-ink sm:text-4xl">My team</h1>
            <p className="mt-2 max-w-[65ch] text-secondary">
              Employer-owned development activity and information people have explicitly shared with this employer.
            </p>
          </div>
          {contexts.length > 1 && (
            <label className="text-sm font-medium text-ink">
              Employer
              <select
                value={activeContext.employerId}
                onChange={(event) => selectEmployer(event.target.value)}
                className="mt-1 block min-w-52 rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink"
              >
                {contexts.map((context) => (
                  <option key={context.employerId} value={context.employerId}>{context.employerName}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <section aria-label="Team summary" className="grid grid-cols-3 divide-x divide-hairline border-b border-hairline py-5 text-center sm:text-left">
          <div className="pr-3 sm:pr-6">
            <p className="text-2xl font-semibold tabular-nums text-ink">{team.length}</p>
            <p className="mt-1 text-xs text-secondary">Manageable people</p>
          </div>
          <div className="px-3 sm:px-6">
            <p className="text-2xl font-semibold tabular-nums text-ink">{activeContext.directReportCount}</p>
            <p className="mt-1 text-xs text-secondary">Direct reports</p>
          </div>
          <div className="pl-3 sm:pl-6">
            <p className="text-2xl font-semibold tabular-nums text-ink">{activeContext.indirectReportCount}</p>
            <p className="mt-1 text-xs text-secondary">Indirect reports</p>
          </div>
        </section>

        <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2" aria-label="Report type filter">
            {[
              ['all', 'All'],
              ['direct', 'Direct'],
              ['indirect', 'Indirect'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={reportFilter === value}
                onClick={() => setReportFilter(value)}
                className={`rounded-full border px-3 py-1.5 text-sm ${reportFilter === value ? 'border-moss bg-moss text-paper' : 'border-hairline text-secondary hover:text-ink'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="sr-only" htmlFor="team-search">Search team</label>
          <input
            id="team-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search team"
            className="w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink placeholder:text-secondary sm:w-64"
          />
        </div>

        {loading && <LoadingRows />}
        {error && (
          <div className="border-y border-hairline py-8">
            <p role="alert" className="text-sm text-red-700">{error}</p>
            <button type="button" onClick={loadTeam} className="mt-3 rounded-md border border-hairline px-3 py-2 text-sm text-ink hover:bg-card">Try again</button>
          </div>
        )}
        {!loading && !error && filteredTeam.length === 0 && (
          <div className="border-y border-dashed border-hairline py-12 text-center">
            <p className="font-medium text-ink">No team members match this view.</p>
            <p className="mt-1 text-sm text-secondary">Try another report filter or clear the search.</p>
          </div>
        )}
        {!loading && !error && filteredTeam.length > 0 && (
          <div className="divide-y divide-hairline border-y border-hairline">
            {filteredTeam.map((member) => (
              <Link
                key={member.employeeMemberId}
                to={`/team/${member.employeeMemberId}?employer=${encodeURIComponent(activeContext.employerId)}`}
                className="group flex items-center gap-4 py-4 focus-visible:rounded-md hover:bg-card/60 sm:px-2"
              >
                <PersonAvatar name={member.fullName} avatarUrl={member.avatarUrl} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate font-medium text-ink group-hover:text-moss">{member.fullName}</h2>
                    {member.isPrimary && <StatusPill tone="active">Primary</StatusPill>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {member.relationshipTypes.filter((type) => type !== 'primary' || !member.isPrimary).map((type) => (
                      <StatusPill key={type} tone={type === 'indirect' ? 'info' : 'neutral'}>
                        {RELATIONSHIP_LABELS[type] ?? type}
                      </StatusPill>
                    ))}
                    {member.reportDepth > 1 && <span className="text-xs text-secondary">Level {member.reportDepth}</span>}
                  </div>
                </div>
                <span aria-hidden="true" className="text-lg text-secondary group-hover:text-ink">›</span>
              </Link>
            ))}
          </div>
        )}

        <aside className="mt-6 border-t border-hairline pt-5 text-sm text-secondary">
          My Team never opens a person’s full LearnScope profile. Private learner information is absent unless the learner has actively shared it with this employer.
        </aside>
      </main>
    </div>
  )
}

export function TeamMemberDetail({ context, employeeMemberId, services = DEFAULT_SERVICES }) {
  const [snapshot, setSnapshot] = useState(null)
  const [courses, setCourses] = useState([])
  const [skills, setSkills] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [submitting, setSubmitting] = useState(null)
  const [selectedCourse, setSelectedCourse] = useState('')
  const [selectedSkill, setSelectedSkill] = useState('')
  const [targetLevel, setTargetLevel] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [comments, setComments] = useState('')
  const [confirmationSkill, setConfirmationSkill] = useState('')
  const [confirmationLevel, setConfirmationLevel] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const nextSnapshot = await services.getMyEmployerTeamMemberSnapshot(context.employerId, employeeMemberId)
      setSnapshot(nextSnapshot)
      const scope = nextSnapshot?.accessScope ?? []
      const [availableCourses, availableSkills] = await Promise.all([
        scope.includes('training_assignments')
          ? services.listManagerAssignableCourses(context.employerId, employeeMemberId)
          : Promise.resolve([]),
        scope.includes('skill_management')
          ? services.listManagerSuggestibleSkills(context.employerId, employeeMemberId)
          : Promise.resolve([]),
      ])
      setCourses(availableCourses)
      setSkills(availableSkills)
    } catch (loadError) {
      setSnapshot(null)
      setError(loadError.message || 'This team member could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [context.employerId, employeeMemberId, services])

  useEffect(() => {
    load()
  }, [load])

  async function runAction(key, successMessage, action) {
    if (submitting) return
    setSubmitting(key)
    setActionError(null)
    setNotice(null)
    try {
      await action()
      setNotice(successMessage)
      await load()
    } catch (submitError) {
      setActionError(submitError.message || 'The action could not be completed.')
    } finally {
      setSubmitting(null)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-paper">
        <AppHeader />
        <main id="main-content" className="mx-auto max-w-4xl px-4 py-10">
          <div className="h-5 w-28 animate-pulse rounded bg-hairline/30" />
          <div className="mt-8 h-24 animate-pulse rounded-lg bg-card" />
          <div className="mt-6 h-56 animate-pulse rounded-lg bg-card" />
        </main>
      </div>
    )
  }

  if (error || !snapshot) {
    return (
      <div className="min-h-screen bg-paper">
        <AppHeader />
        <main id="main-content" className="mx-auto max-w-4xl px-4 py-10">
          <Link to={`/team?employer=${encodeURIComponent(context.employerId)}`} className="text-sm text-secondary hover:text-ink">← Back to My team</Link>
          <p role="alert" className="mt-8 text-sm text-red-700">{error || 'This team member is not available.'}</p>
        </main>
      </div>
    )
  }

  const scope = snapshot.accessScope ?? []

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
        <Link to={`/team?employer=${encodeURIComponent(context.employerId)}`} className="text-sm text-secondary hover:text-ink">← Back to My team</Link>

        <header className="mt-6 flex flex-col gap-4 border-b border-hairline pb-6 sm:flex-row sm:items-center">
          <PersonAvatar name={snapshot.fullName} avatarUrl={snapshot.avatarUrl} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl text-ink">{snapshot.fullName}</h1>
            <p className="mt-1 text-sm text-secondary">{context.employerName} · {snapshot.reportDepth === 1 ? 'Direct report' : `Indirect report · level ${snapshot.reportDepth}`}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(snapshot.relationshipTypes ?? []).filter((type) => type !== 'primary' || !snapshot.isPrimary).map((type) => <StatusPill key={type}>{RELATIONSHIP_LABELS[type] ?? type}</StatusPill>)}
              {snapshot.isPrimary && <StatusPill tone="active">Primary</StatusPill>}
            </div>
          </div>
        </header>

        <section aria-labelledby="access-heading" className="border-b border-hairline py-5">
          <h2 id="access-heading" className="text-sm font-medium text-ink">Your access in this relationship</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {scope.map((item) => <StatusPill key={item} tone="info">{SCOPE_LABELS[item] ?? item}</StatusPill>)}
          </div>
        </section>

        {(scope.includes('training_assignments') || scope.includes('skill_management')) && (
          <section aria-labelledby="actions-heading" className="border-b border-hairline py-6">
            <h2 id="actions-heading" className="font-display text-xl text-ink">Manager actions</h2>
            <p className="mt-1 text-sm text-secondary">Actions create employer-owned assignments or assessments. They do not edit the learner’s personal record.</p>
            {actionError && <p role="alert" className="mt-4 text-sm text-red-700">{actionError}</p>}
            {notice && <p role="status" className="mt-4 text-sm text-moss">{notice}</p>}
            <div className="mt-5 grid gap-6 lg:grid-cols-2">
              {scope.includes('training_assignments') && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (!selectedCourse) return
                    runAction('training', 'Training assigned.', () => services.assignCourseToManagedEmployerMember(context.employerId, employeeMemberId, selectedCourse))
                  }}
                  className="border-t border-hairline pt-4"
                >
                  <h3 className="font-medium text-ink">Assign training</h3>
                  <label className="mt-3 block text-sm text-secondary" htmlFor="manager-course">Employer training</label>
                  <select id="manager-course" value={selectedCourse} onChange={(event) => setSelectedCourse(event.target.value)} className="mt-1 w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink">
                    <option value="">Choose training</option>
                    {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
                  </select>
                  <button type="submit" disabled={!selectedCourse || Boolean(submitting)} className="mt-3 rounded-md bg-moss px-4 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50">
                    {submitting === 'training' ? 'Assigning…' : 'Assign training'}
                  </button>
                </form>
              )}

              {scope.includes('skill_management') && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (!selectedSkill) return
                    runAction('suggestion', 'Skill suggested.', () => services.suggestSkillToManagedEmployerMember(context.employerId, employeeMemberId, selectedSkill, {
                      targetLevel: targetLevel ? Number(targetLevel) : null,
                      targetDate,
                      comments,
                    }))
                  }}
                  className="border-t border-hairline pt-4"
                >
                  <h3 className="font-medium text-ink">Suggest a skill</h3>
                  <label className="mt-3 block text-sm text-secondary" htmlFor="manager-skill">Employer skill</label>
                  <select id="manager-skill" value={selectedSkill} onChange={(event) => setSelectedSkill(event.target.value)} className="mt-1 w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink">
                    <option value="">Choose a skill</option>
                    {skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
                  </select>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="text-sm text-secondary">Target level
                      <select value={targetLevel} onChange={(event) => setTargetLevel(event.target.value)} className="mt-1 w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink">
                        <option value="">Optional</option>
                        {[1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>{level}</option>)}
                      </select>
                    </label>
                    <label className="text-sm text-secondary">Target date
                      <input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} className="mt-1 w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink" />
                    </label>
                  </div>
                  <label className="mt-3 block text-sm text-secondary" htmlFor="manager-skill-comments">Context</label>
                  <textarea id="manager-skill-comments" value={comments} onChange={(event) => setComments(event.target.value)} rows={2} className="mt-1 w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink" />
                  <button type="submit" disabled={!selectedSkill || Boolean(submitting)} className="mt-3 rounded-md bg-moss px-4 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50">
                    {submitting === 'suggestion' ? 'Suggesting…' : 'Suggest skill'}
                  </button>
                </form>
              )}
            </div>

            {scope.includes('skill_management') && (
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!confirmationSkill || !confirmationLevel) return
                  runAction('confirmation', 'Employer skill level confirmed.', () => services.confirmManagedEmployerSkillLevel(context.employerId, employeeMemberId, confirmationSkill, Number(confirmationLevel)))
                }}
                className="mt-6 grid gap-3 border-t border-hairline pt-4 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
              >
                <label className="text-sm text-secondary">Confirm employer skill
                  <select value={confirmationSkill} onChange={(event) => setConfirmationSkill(event.target.value)} className="mt-1 w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink">
                    <option value="">Choose a skill</option>
                    {skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
                  </select>
                </label>
                <label className="text-sm text-secondary">Confirmed level
                  <select value={confirmationLevel} onChange={(event) => setConfirmationLevel(event.target.value)} className="mt-1 w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink">
                    <option value="">Choose</option>
                    {[1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>{level}</option>)}
                  </select>
                </label>
                <button type="submit" disabled={!confirmationSkill || !confirmationLevel || Boolean(submitting)} className="rounded-md border border-moss px-4 py-2 text-sm font-medium text-moss hover:bg-card disabled:opacity-50">
                  {submitting === 'confirmation' ? 'Saving…' : 'Confirm level'}
                </button>
              </form>
            )}
          </section>
        )}

        <div className="divide-y divide-hairline">
          {scope.includes('employment') && <DetailSection title="Employment details" items={snapshot.employmentFields} empty="No employer-owned details have been recorded." renderItem={(item) => <div><p className="text-xs text-secondary">{item.label}</p><p className="mt-1 text-sm text-ink">{item.value || 'Not recorded'}</p></div>} />}
          {scope.includes('role_assignments') && <DetailSection title="Role assignments" items={snapshot.roleAssignments} empty="No employer role assignments." renderItem={(item) => <div><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-ink">{item.roleName}</p><StatusPill>{item.status}</StatusPill></div>{item.roleDescription && <p className="mt-1 text-sm text-secondary">{item.roleDescription}</p>}</div>} />}
          {scope.includes('training_assignments') && <DetailSection title="Training assigned by employer" items={snapshot.trainingAssignments} empty="No employer training assignments." renderItem={(item) => <div><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-ink">{item.name}</p><StatusPill tone={item.status === 'enrolled' ? 'active' : 'neutral'}>{item.status}</StatusPill></div><p className="mt-1 text-sm text-secondary">{[item.provider, item.courseType, formatDate(item.assignedAt)].filter(Boolean).join(' · ')}</p></div>} />}
          {scope.includes('skill_management') && (
            <section className="py-6">
              <h2 className="font-display text-xl text-ink">Employer skill activity</h2>
              <div className="mt-4 grid gap-6 sm:grid-cols-2">
                <CompactList title="Suggestions" items={snapshot.skillSuggestions} empty="No skill suggestions." renderItem={(item) => <div><p className="font-medium text-ink">{item.skillName}</p><p className="mt-1 text-xs text-secondary">{item.suggestedTargetLevel ? `Target level ${item.suggestedTargetLevel}` : 'No target level'}{item.targetDate ? ` · by ${formatDate(item.targetDate)}` : ''} · {item.status}</p></div>} />
                <CompactList title="Latest confirmations" items={snapshot.skillConfirmations} empty="No employer confirmations." renderItem={(item) => <div><p className="font-medium text-ink">{item.skillName}</p><p className="mt-1 text-xs text-secondary">Level {item.confirmedLevel} · {formatDate(item.confirmedAt)}</p></div>} />
              </div>
            </section>
          )}
          {scope.includes('shared_skills') && (
            <DetailSection
              title="Shared by learner"
              intro="Only skills explicitly shared with this employer appear here. Sharing does not transfer ownership."
              items={snapshot.sharedSkills}
              empty="No learner-owned skills are currently shared with this employer."
              renderItem={(item) => <div><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-ink">{item.name}</p>{item.level != null && <StatusPill tone="active">Level {item.level}</StatusPill>}</div><p className="mt-1 text-xs text-secondary">{item.category || 'Uncategorised'}{item.evidenceVisible ? ` · ${item.evidenceCount} shared evidence item${item.evidenceCount === 1 ? '' : 's'}` : ' · Evidence not in your scope'}</p></div>}
            />
          )}
        </div>
      </main>
    </div>
  )
}

function DetailSection({ title, intro, items = [], empty, renderItem }) {
  return (
    <section className="py-6">
      <h2 className="font-display text-xl text-ink">{title}</h2>
      {intro && <p className="mt-1 max-w-[65ch] text-sm text-secondary">{intro}</p>}
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-secondary">{empty}</p>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {items.map((item) => <div key={item.id} className="border-t border-hairline pt-3">{renderItem(item)}</div>)}
        </div>
      )}
    </section>
  )
}

function CompactList({ title, items = [], empty, renderItem }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-ink">{title}</h3>
      {items.length === 0 ? <p className="mt-3 text-sm text-secondary">{empty}</p> : (
        <div className="mt-3 divide-y divide-hairline border-y border-hairline">
          {items.map((item) => <div key={item.id} className="py-3">{renderItem(item)}</div>)}
        </div>
      )}
    </div>
  )
}
