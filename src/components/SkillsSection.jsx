import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import SkillCard from './SkillCard'
import FindSkillModal from './FindSkillModal'
import FilterRow from './FilterRow'
import TrackingReasonIcon from './TrackingReasonIcon'
import OrganizationLogo from './OrganizationLogo'
import { TRACKING_REASONS } from '../lib/trackingReasons'
import { isSelfAssessmentDue, todayDateString } from '../lib/checkin'
import { listActiveGoalsForAttention } from '../lib/skillGoals'
import {
  dueReasonsBySkill,
  lastActivityLabel,
  latestActivityBySkill,
  splitSkillsForList,
} from '../lib/skillListSections'

const ACTIVITY_PAGE_SIZE = 1000
import {
  addSkillSetByOthers,
  listLatestManagerRatings,
  listTargetsSetByOthers,
  listUntrackedTargetsSetByOthers,
  pickTargetSetByOthers,
} from '../lib/managerSkillActions'
import GrowthRing from './GrowthRing'
import { LEVEL_LABELS } from '../lib/levels'
import { computeVisibleTarget } from '../lib/skillTargetPrecedence'

const SKILL_VIEWS = [
  { value: 'all', labelKey: 'skills.views.all' },
  { value: 'current', labelKey: 'skills.views.current' },
  { value: 'developing', labelKey: 'skills.views.developing' },
  { value: 'review', labelKey: 'skills.views.review' },
]

// intro: shown between the page heading and the skills themselves (the Skills
// page puts its next steps and reminders there).
export default function SkillsSection({ intro = null }) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [skills, setSkills] = useState([])
  // Skills someone else set a target on that the learner doesn't track yet.
  const [setForYou, setSetForYou] = useState([])
  const [addingLibraryId, setAddingLibraryId] = useState(null)
  const [addError, setAddError] = useState(null)
  const [currentRoles, setCurrentRoles] = useState([])
  // What is due on each skill, and when each last had activity, for the
  // sections at the top of the list (see skillListSections.js).
  const [dueBySkillId, setDueBySkillId] = useState(() => new Map())
  const [activityBySkillId, setActivityBySkillId] = useState(() => new Map())
  const [tagsBySkill, setTagsBySkill] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [tagFilter, setTagFilter] = useState(null)
  const [trackingReasonFilter, setTrackingReasonFilter] = useState(null)
  const [showFilters, setShowFilters] = useState(false)
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('attention')
  const [view, setView] = useState('all')

  const [currentRoleSkillIdsByExperienceId, setCurrentRoleSkillIdsByExperienceId] = useState({})

  useEffect(() => {
    loadSkills()
    loadCurrentRoles()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the listed values change; the loaders are recreated every render
  }, [])

  // Which specific current role(s) each current-role skill actually belongs
  // to -- used both to split the "Current role(s)" grid per role and to
  // drop a current role from the list entirely once it turns out to have no
  // skills linked to it.
  useEffect(() => {
    if (currentRoles.length === 0) {
      setCurrentRoleSkillIdsByExperienceId({})
      return
    }
    let active = true
    supabase
      .from('skill_experience_links')
      .select('skill_id, experience_id')
      .in('experience_id', currentRoles.map((r) => r.id))
      .then(({ data }) => {
        if (!active) return
        const map = {}
        for (const row of data ?? []) {
          if (!map[row.experience_id]) map[row.experience_id] = new Set()
          map[row.experience_id].add(row.skill_id)
        }
        setCurrentRoleSkillIdsByExperienceId(map)
      })
    return () => { active = false }
  }, [currentRoles])

  async function loadCurrentRoles() {
    const { data } = await supabase
      .from('experience')
      .select('id, title, organization, organization_url')
      .eq('user_id', user.id)
      .eq('type', 'employment')
      .is('end_date', null)
      .order('start_date', { ascending: false })
    setCurrentRoles(data ?? [])
  }

  // When each of the learner's activities happened (not when it was logged),
  // by skill: an activity's own skill, and the further skills it's linked to.
  // Read a page at a time, since a request returns at most 1,000 rows.
  async function loadActivityDates() {
    async function allPages(makeQuery) {
      const rows = []
      for (let from = 0; ; from += ACTIVITY_PAGE_SIZE) {
        const { data, error } = await makeQuery().range(from, from + ACTIVITY_PAGE_SIZE - 1)
        if (error) throw error
        rows.push(...(data ?? []))
        if ((data ?? []).length < ACTIVITY_PAGE_SIZE) return rows
      }
    }
    const [statements, links] = await Promise.all([
      allPages(() => supabase.from('xapi_statements').select('skill_id, recorded_at').eq('user_id', user.id).order('id')),
      allPages(() => supabase.from('xapi_statement_skills').select('skill_id, xapi_statements(recorded_at)').eq('user_id', user.id).order('id')),
    ])
    return [...statements, ...links.map((link) => ({ skill_id: link.skill_id, recorded_at: link.xapi_statements?.recorded_at }))]
  }

  async function loadSkills() {
    setLoading(true)
    const [
      { data, error },
      { data: tagLinks },
      { data: practicalAssessments },
      { data: skillTargets },
      targetsSetByOthers,
      latestManagerRatings,
      { data: confirmedValidations },
      goalItems,
      activityDates,
    ] = await Promise.all([
      supabase
        .from('skills')
        .select('*')
        .eq('user_id', user.id)
        .order('date_added', { ascending: false }),
      supabase.from('skill_tags').select('skill_id, tags(name)').eq('user_id', user.id),
      supabase
        .from('skill_assessments')
        .select('skill_id, level, source, assessed_at')
        .eq('user_id', user.id)
        .eq('axis', 'practical')
        .order('assessed_at', { ascending: false }),
      supabase
        .from('skill_targets')
        .select('skill_id, target_level, target_date, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
      listTargetsSetByOthers(user.id),
      listLatestManagerRatings(user.id),
      supabase.from('skill_validation_requests').select('skill_id').eq('requester_id', user.id).eq('status', 'confirmed'),
      // The sections are extras: the list still loads if either of these fails.
      listActiveGoalsForAttention(user.id).catch(() => []),
      loadActivityDates().catch(() => []),
    ])
    if (error) {
      setError(error.message)
    } else {
      // skill.level only moves on an explicit baseline evaluation (or an
      // import that sets it directly) -- without this fallback a skill
      // that's only ever been self-assessed shows "Not yet self-assessed"
      // here even though the skill's own detail page already shows the
      // self-assessed level, via the same fallback (see
      // displayedPracticalLevel in SkillDetail.jsx).
      const latestPracticalBySkillId = new Map()
      // Whether *any* self-sourced row exists at all, not just the latest --
      // matches the trust logic on the skill's own detail page (selfAssessedCount
      // in SkillDetail.jsx): an AI baseline/evaluation run later doesn't erase
      // the trust earned by an underlying self-assessment, since the AI result
      // is a synthesis of that same evidence, not an independent source.
      const selfAssessedSkillIds = new Set()
      for (const a of practicalAssessments ?? []) {
        if (!latestPracticalBySkillId.has(a.skill_id)) latestPracticalBySkillId.set(a.skill_id, a.level)
        if (a.source === 'self' || !a.source) selfAssessedSkillIds.add(a.skill_id)
      }
      // Most recent target per skill (a skill can be re-targeted over time,
      // same history-preserving pattern as skill_assessments) -- matches
      // currentTarget = targets[0] on the skill's own detail page.
      const personValidatedSkillIds = new Set((confirmedValidations ?? []).map((v) => v.skill_id))
      const latestTargetLevelBySkillId = new Map()
      const latestTargets = []
      for (const t of skillTargets ?? []) {
        if (latestTargetLevelBySkillId.has(t.skill_id)) continue
        latestTargetLevelBySkillId.set(t.skill_id, t.target_level)
        latestTargets.push(t)
      }
      const loadedSkills = data.map((s) => {
          // A target set by a team or organisation shows until a rating
          // from that same context reaches it (pickTargetSetByOthers); then
          // the learner's own higher target takes over.
          const setByOthers = pickTargetSetByOthers(
            { libraryId: s.library_skill_id, skillId: s.id },
            targetsSetByOthers,
            latestManagerRatings
          )
          const visibleTarget = computeVisibleTarget({
            employerTargetLevel: setByOthers?.level ?? null,
            employerConfirmedLevel: setByOthers?.met ? setByOthers.level : null,
            personalTargetLevel: latestTargetLevelBySkillId.get(s.id) ?? null,
          })
          return {
            ...s,
            displayedLevel: s.level ?? latestPracticalBySkillId.get(s.id) ?? null,
            displayedLevelIsSelfAssessed: selfAssessedSkillIds.has(s.id),
            hasConfirmedValidation: personValidatedSkillIds.has(s.id),
            targetLevel: visibleTarget?.level ?? null,
            targetSource: visibleTarget?.source ?? null,
            employerTargetLevel: visibleTarget?.employerTargetLevel ?? null,
            employerTargetMet: visibleTarget?.employerTargetMet ?? false,
            targetContextName: setByOthers?.contextName ?? null,
          }
        })
      setSkills(loadedSkills)
      setDueBySkillId(dueReasonsBySkill({ skills: loadedSkills, latestTargets, goalItems, today: todayDateString() }))
      setActivityBySkillId(latestActivityBySkill(activityDates))
      listUntrackedTargetsSetByOthers(data, targetsSetByOthers, latestManagerRatings)
        .then(setSetForYou)
        .catch(() => setSetForYou([]))
      const map = new Map()
      for (const link of tagLinks ?? []) {
        if (!link.tags?.name) continue
        if (!map.has(link.skill_id)) map.set(link.skill_id, [])
        map.get(link.skill_id).push(link.tags.name)
      }
      setTagsBySkill(map)
    }
    setLoading(false)
  }

  const [showArchived, setShowArchived] = useState(false)

  // Dropped (library-linked) skills are archived rather than deleted -- see
  // handleDrop in SkillDetail.jsx -- so they need to disappear from the
  // active list here without losing their history.
  const activeSkills = useMemo(() => skills.filter((s) => s.lifecycle_stage !== 'archived'), [skills])
  const archivedSkills = useMemo(() => skills.filter((s) => s.lifecycle_stage === 'archived'), [skills])

  const filteredSkills = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    const attentionScore = (skill) => {
      if (isSelfAssessmentDue(skill.next_checkin_date)) return 4
      if (skill.displayedLevel == null) return 3
      if (skill.targetLevel != null && skill.displayedLevel < skill.targetLevel) return 2
      return skill.is_current_role ? 1 : 0
    }
    return activeSkills
      .filter((skill) => {
        const matchesView =
          view === 'all' ||
          (view === 'current' && skill.is_current_role) ||
          (view === 'developing' && skill.targetLevel != null && (skill.displayedLevel ?? 0) < skill.targetLevel) ||
          (view === 'review' && (isSelfAssessmentDue(skill.next_checkin_date) || skill.displayedLevel == null))
        return matchesView &&
          (!normalizedQuery || skill.name.toLocaleLowerCase().includes(normalizedQuery)) &&
          (!tagFilter || (tagsBySkill.get(skill.id) ?? []).includes(tagFilter)) &&
          (!trackingReasonFilter || skill.tracking_reason === trackingReasonFilter)
      })
      .sort((a, b) => {
        if (sortBy === 'name') return a.name.localeCompare(b.name)
        if (sortBy === 'level') return (b.displayedLevel ?? 0) - (a.displayedLevel ?? 0)
        if (sortBy === 'recent') return new Date(b.date_added ?? 0) - new Date(a.date_added ?? 0)
        return attentionScore(b) - attentionScore(a)
      })
  }, [activeSkills, query, sortBy, tagFilter, tagsBySkill, trackingReasonFilter, view])
  // Only under All and Skill gaps (they're all below their target), and only
  // when they match the search.
  const visibleSetForYou = useMemo(() => {
    if (view !== 'all' && view !== 'developing') return []
    if (tagFilter || trackingReasonFilter) return []
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return setForYou.filter((item) => !normalizedQuery || item.name.toLocaleLowerCase().includes(normalizedQuery))
  }, [setForYou, view, query, tagFilter, trackingReasonFilter])

  async function handleAddSetForYou(item) {
    setAddError(null)
    setAddingLibraryId(item.libraryId)
    try {
      await addSkillSetByOthers(user.id, item)
      await loadSkills()
    } catch (err) {
      setAddError(err.message)
    } finally {
      setAddingLibraryId(null)
    }
  }

  // Under the usual "Needs attention" order, skills with something due come
  // first, then those with recent activity, then neglected ones, each in a
  // small section of its own; everything else follows as before. Another
  // sort shows one list.
  const sections = useMemo(
    () => (sortBy === 'attention'
      ? splitSkillsForList(filteredSkills, dueBySkillId, activityBySkillId)
      : { due: [], recent: [], neglected: [], rest: filteredSkills }),
    [sortBy, filteredSkills, dueBySkillId, activityBySkillId]
  )
  const hasTopSections = sections.due.length > 0 || sections.recent.length > 0 || sections.neglected.length > 0

  const currentRoleSkills = useMemo(
    () => sections.rest.filter((s) => s.is_current_role),
    [sections]
  )
  const otherSkills = useMemo(
    () => sections.rest.filter((s) => !s.is_current_role),
    [sections]
  )

  function dueNote(skill) {
    const reason = dueBySkillId.get(skill.id)
    if (!reason) return null
    const goal = reason.goalTitle
    switch (reason.kind) {
      case 'checkin': return t(reason.overdue ? 'skills.sections.reasons.checkinOverdue' : 'skills.sections.reasons.checkinDue')
      case 'target': return t(reason.overdue ? 'skills.sections.reasons.targetOverdue' : 'skills.sections.reasons.targetDue')
      case 'goalLog': return t('skills.sections.reasons.goalLog', { goal })
      default: return t(reason.overdue ? 'skills.sections.reasons.goalDateOverdue' : 'skills.sections.reasons.goalDateDue', { goal })
    }
  }

  // "Last activity …" on a card; "No activity yet" only where it matters (a
  // neglected skill), so it isn't repeated on every new skill.
  function activityNote(skill, { showNone = false } = {}) {
    const label = lastActivityLabel(activityBySkillId.get(skill.id))
    if (!label) return showNone ? t('skills.sections.lastActivity.none') : null
    return t(label.key, label.count == null ? undefined : { count: label.count })
  }

  // The lines inside each card on this page: what's due, then last activity.
  function notesFor(skill, options) {
    const reason = dueBySkillId.get(skill.id)
    return [
      reason && { text: dueNote(skill), urgent: reason.overdue },
      { text: activityNote(skill, options) },
    ].filter(Boolean)
  }
  const hasSplit = currentRoleSkills.length > 0

  // Roles the skill-to-experience map has actually confirmed have at least
  // one linked skill -- a current role with none isn't worth listing here.
  // Before the map has loaded (or if a skill's is_current_role is somehow
  // stale relative to it), falls back to every current role rather than
  // silently showing none.
  const currentRoleGroups = useMemo(() => {
    if (Object.keys(currentRoleSkillIdsByExperienceId).length === 0) {
      return currentRoles.map((role) => ({ role, skills: currentRoleSkills }))
    }
    return currentRoles
      .map((role) => ({
        role,
        skills: currentRoleSkills.filter((s) => currentRoleSkillIdsByExperienceId[role.id]?.has(s.id)),
      }))
      .filter((group) => group.skills.length > 0)
  }, [currentRoles, currentRoleSkills, currentRoleSkillIdsByExperienceId])

  const availableTags = useMemo(
    () => [...new Set([...tagsBySkill.values()].flat())].sort(),
    [tagsBySkill]
  )
  const activeMoreFilterCount = [tagFilter, trackingReasonFilter].filter((v) => v !== null).length
  const clearFilters = () => {
    setQuery('')
    setTagFilter(null)
    setTrackingReasonFilter(null)
    setView('all')
  }

  return (
    <section>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div className="max-w-2xl">
          <h1 className="font-display text-3xl sm:text-4xl text-ink text-balance">{t('skills.heading')}</h1>
          <p className="text-secondary mt-2 text-pretty">
            {t('skills.subheading')}
          </p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="rounded-md bg-moss text-paper py-2.5 px-4 font-medium hover:opacity-90 shrink-0 self-start"
        >
          {t('skills.addSkill')}
        </button>
      </div>

      {intro}

      {loading && <SkillsSkeleton />}
      {error && (
        <div role="alert" className="rounded-lg border border-red-700 p-4 text-sm text-red-700">
          We could not load your skills. Refresh the page to try again.
        </div>
      )}

      {!loading && !error && activeSkills.length === 0 && archivedSkills.length === 0 && (
        <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
          <h2 className="font-display text-xl text-ink">{t('skills.emptyState.title')}</h2>
          <p className="text-secondary mt-2 mb-5">{t('skills.emptyState.description')}</p>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="rounded-md bg-moss text-paper py-2.5 px-4 font-medium hover:opacity-90"
          >
            {t('skills.emptyState.button')}
          </button>
        </div>
      )}

      {!loading && !error && activeSkills.length > 0 && (
        <div className="border-y border-hairline py-4 mb-8 space-y-4">
          <div className="flex gap-1 overflow-x-auto scrollbar-hide" aria-label="Skill views">
            {SKILL_VIEWS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setView(option.value)}
                aria-pressed={view === option.value}
                className={`shrink-0 rounded-full px-3 py-1.5 text-sm transition-colors ${
                  view === option.value ? 'bg-moss text-paper' : 'text-secondary hover:bg-card hover:text-ink'
                }`}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className="min-w-0">
              <span className="sr-only">{t('skills.searchPlaceholder')}</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('skills.searchPlaceholder')}
                className="w-full rounded-md border border-hairline bg-card px-3 py-2.5 text-ink placeholder:text-secondary"
              />
            </label>
            <button
              type="button"
              onClick={() => setShowFilters((value) => !value)}
              aria-expanded={showFilters}
              className="rounded-md border border-hairline bg-card px-3 py-2.5 text-sm font-medium text-ink hover:border-moss"
            >
              {t('skills.filters')}{activeMoreFilterCount > 0 ? ` (${activeMoreFilterCount})` : ''}
            </button>
          </div>

          {showFilters && (
            <div className="space-y-4 rounded-lg bg-card p-4">
              <FilterRow
                label="Reason"
                value={trackingReasonFilter}
                onChange={setTrackingReasonFilter}
                options={TRACKING_REASONS.map((reason) => ({
                  value: reason.value,
                  label: reason.label,
                  icon: <TrackingReasonIcon reason={reason.value} size={14} />,
                }))}
              />
              {availableTags.length > 0 && (
                  <FilterRow
                    label="Tag"
                    value={tagFilter}
                    onChange={setTagFilter}
                    options={availableTags.map((t) => ({ value: t, label: t }))}
                  />
              )}
              <label className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-wide text-secondary w-28 shrink-0">
                  Sort by
                </span>
                <select
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value)}
                  className="rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink"
                >
                  <option value="attention">Needs attention</option>
                  <option value="recent">Recently added</option>
                  <option value="name">Name</option>
                  <option value="level">Highest level</option>
                </select>
              </label>
            </div>
          )}
        </div>
      )}

      {!loading && !error && activeSkills.length > 0 && filteredSkills.length === 0 && visibleSetForYou.length === 0 && (
        <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
          <h2 className="font-display text-xl text-ink">{t('skills.noMatch.title')}</h2>
          <p className="text-secondary mt-2 mb-5">{t('skills.noMatch.description')}</p>
          <button type="button" onClick={clearFilters} className="text-sm font-medium text-moss hover:underline">
            {t('skills.noMatch.clearFilters')}
          </button>
        </div>
      )}

      {sections.due.length > 0 && (
        <SkillListSection
          id="skills-due-heading"
          heading={t('skills.sections.due.heading')}
          description={t('skills.sections.due.description')}
          skills={sections.due}
          notesFor={(skill) => notesFor(skill)}
          onEdit={(skill) => navigate(`/skills/${skill.id}`)}
        />
      )}

      {sections.recent.length > 0 && (
        <SkillListSection
          id="skills-recent-heading"
          heading={t('skills.sections.recent.heading')}
          description={t('skills.sections.recent.description')}
          skills={sections.recent}
          notesFor={(skill) => notesFor(skill)}
          onEdit={(skill) => navigate(`/skills/${skill.id}`)}
        />
      )}

      {sections.neglected.length > 0 && (
        <SkillListSection
          id="skills-neglected-heading"
          heading={t('skills.sections.neglected.heading')}
          description={t('skills.sections.neglected.description')}
          skills={sections.neglected}
          notesFor={(skill) => notesFor(skill, { showNone: true })}
          onEdit={(skill) => navigate(`/skills/${skill.id}`)}
        />
      )}

      {hasSplit && (
        <div className="mb-10">
          {currentRoleGroups.length > 1 ? (
            <>
              <h3 className="font-display text-base text-ink mb-4">Current roles</h3>
              {currentRoleGroups.map(({ role, skills }) => (
                <div key={role.id} className="mb-6 last:mb-0">
                  <p className="flex items-center gap-1.5 text-sm text-secondary mb-3">
                    {role.organization_url && <OrganizationLogo organizationUrl={role.organization_url} size={18} />}
                    <span>
                      {role.title}
                      {role.organization ? ` · ${role.organization}` : ''}
                    </span>
                  </p>
                  <SkillGrid skills={skills} notesFor={notesFor} onEdit={(skill) => navigate(`/skills/${skill.id}`)} />
                </div>
              ))}
            </>
          ) : (
            <>
              <div className="mb-4">
                <h3 className="font-display text-base text-ink">Current role</h3>
                {currentRoleGroups.map(({ role }) => (
                  <p key={role.id} className="flex items-center gap-1.5 text-sm text-secondary mt-1">
                    {role.organization_url && <OrganizationLogo organizationUrl={role.organization_url} size={18} />}
                    <span>
                      {role.title}
                      {role.organization ? ` · ${role.organization}` : ''}
                    </span>
                  </p>
                ))}
              </div>
              <SkillGrid
                skills={currentRoleSkills}
                notesFor={notesFor}
                onEdit={(skill) => navigate(`/skills/${skill.id}`)}
              />
            </>
          )}
        </div>
      )}

      {otherSkills.length > 0 && (
        <div>
          {hasSplit
            ? <h3 className="font-display text-base text-ink mb-4">Further skills</h3>
            : hasTopSections && <h3 className="font-display text-base text-ink mb-4">{t('skills.sections.others')}</h3>}
          <SkillGrid
            skills={otherSkills}
            notesFor={notesFor}
            onEdit={(skill) => navigate(`/skills/${skill.id}`)}
          />
        </div>
      )}

      {!loading && !error && visibleSetForYou.length > 0 && (
        <section aria-labelledby="set-for-you-heading" className="mt-10">
          <h3 id="set-for-you-heading" className="font-display text-base text-ink">{t('skills.setForYou.heading')}</h3>
          <p className="text-sm text-secondary mt-1 mb-4">{t('skills.setForYou.description')}</p>
          {addError && <p role="alert" className="text-sm text-red-700 mb-3">{addError}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {visibleSetForYou.map((item) => (
              <SetForYouCard
                key={item.libraryId}
                item={item}
                adding={addingLibraryId === item.libraryId}
                onAdd={() => handleAddSetForYou(item)}
                t={t}
              />
            ))}
          </div>
        </section>
      )}

      {archivedSkills.length > 0 && (
        <div className="mt-10 pt-6 border-t border-hairline">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="text-sm text-moss font-medium mb-4"
          >
            {showArchived ? 'Hide' : 'Show'} dropped skills ({archivedSkills.length})
          </button>
          {showArchived && (
            <SkillGrid
              skills={archivedSkills}
              onEdit={(skill) => navigate(`/skills/${skill.id}`)}
            />
          )}
        </div>
      )}

      {addOpen && (
        <FindSkillModal
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            setAddOpen(false)
            loadSkills()
          }}
        />
      )}

    </section>
  )
}

// A skill someone else set a target on that isn't in the learner's own list
// yet, drawn like their own skill cards: the ring shows no level yet with the
// target marked. Adding it is the learner's choice.
function SetForYouCard({ item, adding, onAdd, t }) {
  return (
    <div className="bg-card border border-dashed border-hairline rounded-lg p-4 flex gap-4 items-center w-full">
      <GrowthRing level={null} size={56} targetLevel={item.level} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-lg text-ink truncate min-w-0">{item.name}</h3>
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-moss border border-moss/40 rounded-full px-2 py-0.5">
            {t('skills.setForYou.badge')}
          </span>
        </div>
        <p className="text-sm text-secondary mt-1">
          {t('skills.setForYou.line', { level: LEVEL_LABELS[item.level], name: item.contextName })}
        </p>
        <button
          type="button"
          onClick={onAdd}
          disabled={adding}
          className="mt-2 rounded-md bg-moss text-paper text-xs font-medium px-3 py-1.5 hover:opacity-90 disabled:opacity-60"
        >
          {adding ? t('skills.setForYou.adding') : t('skills.setForYou.add')}
        </button>
      </div>
    </div>
  )
}

// How many skills a top section shows before "Show all".
const SECTION_PREVIEW_COUNT = 4

// A small section above the rest of the list, each card with short lines
// inside it (what's due, last activity). Shows the first few, with the rest a
// click away.
function SkillListSection({ id, heading, description, skills, notesFor, onEdit }) {
  const { t } = useLanguage()
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? skills : skills.slice(0, SECTION_PREVIEW_COUNT)
  return (
    <section aria-labelledby={id} className="mb-10">
      <h3 id={id} className="font-display text-base text-ink">{heading}</h3>
      <p className="text-sm text-secondary mt-1 mb-4">{description}</p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {shown.map((skill) => (
          <li key={skill.id} className="flex">
            <SkillCard skill={skill} onEdit={onEdit} compact notes={notesFor(skill)} />
          </li>
        ))}
      </ul>
      {skills.length > SECTION_PREVIEW_COUNT && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="mt-3 text-sm font-medium text-moss hover:underline"
        >
          {expanded ? t('skills.sections.showFewer') : t('skills.sections.showAll', { count: skills.length })}
        </button>
      )}
    </section>
  )
}

function SkillGrid({ skills, onEdit, notesFor = null }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {skills.map((skill) => (
        <SkillCard key={skill.id} skill={skill} onEdit={onEdit} compact notes={notesFor ? notesFor(skill) : []} />
      ))}
    </div>
  )
}

function SkillsSkeleton() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading your skills…</span>
      <div aria-hidden="true" className="grid grid-cols-1 gap-3 sm:grid-cols-2 animate-pulse motion-reduce:animate-none">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-28 rounded-lg border border-hairline bg-card" />
        ))}
      </div>
    </div>
  )
}
