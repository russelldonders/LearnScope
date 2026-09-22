import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import SkillCard from './SkillCard'
import FindSkillModal from './FindSkillModal'
import FilterRow from './FilterRow'
import TrackingReasonIcon from './TrackingReasonIcon'
import OrganizationLogo from './OrganizationLogo'
import GrowthRing from './GrowthRing'
import SetSkillTargetFlow from './SetSkillTargetFlow'
import { TRACKING_REASONS } from '../lib/trackingReasons'
import { LEVEL_LABELS } from '../lib/levels'
import { isSelfAssessmentDue } from '../lib/checkin'
import { getEmployerTargetsForUser, getLatestEmployerSkillConfirmations } from '../lib/employerSkillTargets'
import { computeVisibleTarget } from '../lib/skillTargetPrecedence'
import { listMySkillDevelopmentTargets } from '../lib/skillDevelopmentTargets'

const SKILL_VIEWS = [
  { value: 'all', labelKey: 'skills.views.all' },
  { value: 'current', labelKey: 'skills.views.current' },
  { value: 'developing', labelKey: 'skills.views.developing' },
  { value: 'review', labelKey: 'skills.views.review' },
]

export default function SkillsSection() {
  const { user } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [skills, setSkills] = useState([])
  const [currentRoles, setCurrentRoles] = useState([])
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

  const [developmentTargets, setDevelopmentTargets] = useState({ personal: [], employer: [] })
  const [targetsError, setTargetsError] = useState(null)
  const [targetsLoading, setTargetsLoading] = useState(true)
  const [showSetTargetFlow, setShowSetTargetFlow] = useState(false)

  useEffect(() => {
    loadSkills()
    loadCurrentRoles()
    loadDevelopmentTargets()
  }, [])

  async function loadDevelopmentTargets() {
    setTargetsLoading(true)
    setTargetsError(null)
    try {
      setDevelopmentTargets(await listMySkillDevelopmentTargets(user.id))
    } catch (err) {
      setTargetsError(err.message || 'Your skill targets could not be loaded.')
    } finally {
      setTargetsLoading(false)
    }
  }

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

  async function loadSkills() {
    setLoading(true)
    const [
      { data, error },
      { data: tagLinks },
      { data: practicalAssessments },
      { data: skillTargets },
      employerTargetsByLibraryId,
      employerConfirmationsByKey,
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
        .select('skill_id, target_level, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
      getEmployerTargetsForUser(),
      getLatestEmployerSkillConfirmations(),
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
      const latestTargetLevelBySkillId = new Map()
      for (const t of skillTargets ?? []) {
        if (!latestTargetLevelBySkillId.has(t.skill_id)) latestTargetLevelBySkillId.set(t.skill_id, t.target_level)
      }
      setSkills(
        data.map((s) => {
          const employerTarget = s.library_skill_id ? employerTargetsByLibraryId.get(s.library_skill_id) : null
          const employerConfirmedLevel = employerTarget
            ? employerConfirmationsByKey.get(`${employerTarget.employerId}:${s.library_skill_id}`) ?? null
            : null
          const visibleTarget = computeVisibleTarget({
            employerTargetLevel: employerTarget?.level ?? null,
            employerConfirmedLevel,
            personalTargetLevel: latestTargetLevelBySkillId.get(s.id) ?? null,
          })
          return {
            ...s,
            displayedLevel: s.level ?? latestPracticalBySkillId.get(s.id) ?? null,
            displayedLevelIsSelfAssessed: selfAssessedSkillIds.has(s.id),
            targetLevel: visibleTarget?.level ?? null,
            targetSource: visibleTarget?.source ?? null,
            employerTargetLevel: visibleTarget?.employerTargetLevel ?? null,
            employerTargetMet: visibleTarget?.employerTargetMet ?? false,
          }
        })
      )
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

  // A skill only counts as a gap once the learner has actually set a target
  // for it -- comparing everyone against an unset target would just flag
  // every newly added skill as "behind", which isn't a gap, it's normal.
  const skillGaps = useMemo(
    () =>
      activeSkills.filter(
        (s) => s.targetLevel != null && (s.displayedLevel == null || s.displayedLevel < s.targetLevel)
      ),
    [activeSkills]
  )

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
  const currentRoleSkills = useMemo(
    () => filteredSkills.filter((s) => s.is_current_role),
    [filteredSkills]
  )
  const otherSkills = useMemo(
    () => filteredSkills.filter((s) => !s.is_current_role),
    [filteredSkills]
  )
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

      {!targetsLoading && (
        <SkillDevelopmentTargets
          targets={developmentTargets}
          error={targetsError}
          t={t}
          onSetNewTarget={() => setShowSetTargetFlow(true)}
        />
      )}

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

      {!loading && !error && view === 'all' && !query && !tagFilter && !trackingReasonFilter && skillGaps.length > 0 && (
        <div className="mb-10">
          <h2 className="font-display text-xl text-ink">{t('skills.toDevelop.title')}</h2>
          <p className="text-sm text-secondary mt-1 mb-4">{t('skills.toDevelop.description')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {skillGaps.slice(0, 3).map((skill) => (
              <button
                key={skill.id}
                type="button"
                onClick={() => navigate(`/skills/${skill.id}`)}
                className="text-left bg-card border border-hairline rounded-lg p-4 flex items-center gap-4 hover:border-moss transition-colors w-full"
              >
                <GrowthRing level={skill.displayedLevel} size={48} targetLevel={skill.targetLevel} />
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-base text-ink truncate">{skill.name}</h3>
                  <p className="text-sm text-secondary">
                    {skill.displayedLevel ? LEVEL_LABELS[skill.displayedLevel] : 'Not yet assessed'}
                    {' → target '}
                    {LEVEL_LABELS[skill.targetLevel]}
                  </p>
                  <p className="text-sm font-medium text-moss mt-2">
                    {skill.displayedLevel == null
                      ? 'Assess your current level'
                      : `Work toward ${LEVEL_LABELS[skill.targetLevel]}`}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {!loading && !error && activeSkills.length > 0 && filteredSkills.length === 0 && (
        <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
          <h2 className="font-display text-xl text-ink">{t('skills.noMatch.title')}</h2>
          <p className="text-secondary mt-2 mb-5">{t('skills.noMatch.description')}</p>
          <button type="button" onClick={clearFilters} className="text-sm font-medium text-moss hover:underline">
            {t('skills.noMatch.clearFilters')}
          </button>
        </div>
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
                  <SkillGrid skills={skills} onEdit={(skill) => navigate(`/skills/${skill.id}`)} />
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
                onEdit={(skill) => navigate(`/skills/${skill.id}`)}
              />
            </>
          )}
        </div>
      )}

      {otherSkills.length > 0 && (
        <div>
          {hasSplit && <h3 className="font-display text-base text-ink mb-4">Further skills</h3>}
          <SkillGrid
            skills={otherSkills}
            onEdit={(skill) => navigate(`/skills/${skill.id}`)}
          />
        </div>
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

      {showSetTargetFlow && (
        <SetSkillTargetFlow
          skills={activeSkills}
          user={user}
          onClose={() => setShowSetTargetFlow(false)}
          onSet={() => {
            setShowSetTargetFlow(false)
            loadSkills()
            loadDevelopmentTargets()
          }}
        />
      )}
    </section>
  )
}

function SkillDevelopmentTargets({ targets, error, t, onSetNewTarget }) {
  const activeEmployerTargets = targets.employer.filter((target) => target.status === 'active')
  const hasTargets = targets.personal.length > 0 || activeEmployerTargets.length > 0

  return (
    <section aria-labelledby="skill-targets-heading" className="mb-10 border-y border-hairline py-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <h2 id="skill-targets-heading" className="font-display text-xl text-ink">{t('skills.skillTargets')}</h2>
          <p className="mt-1 text-sm text-secondary">{t('skills.skillTargetsIntro')}</p>
        </div>
        <button
          type="button"
          onClick={onSetNewTarget}
          className="shrink-0 rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper"
        >
          {t('skills.setNewTarget')}
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-5 text-sm text-red-700">{t('skills.skillTargetsLoadError')}</p>
      ) : !hasTargets ? (
        <p className="mt-5 text-sm text-secondary">{t('skills.skillTargetsEmpty')}</p>
      ) : (
        <div className="mt-5 divide-y divide-hairline border-t border-hairline">
          {targets.personal.map((target) => (
            <TargetRow key={`personal-${target.id}`} target={target} t={t} />
          ))}
          {activeEmployerTargets.map((target) => (
            <TargetRow key={`employer-${target.id}`} target={target} t={t} />
          ))}
        </div>
      )}
    </section>
  )
}

function TargetRow({ target, t }) {
  const content = (
    <>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium text-ink">{target.skillName}</h3>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${target.ownership === 'personal' ? 'border-moss text-moss' : 'border-slate text-slate'}`}>
            {target.ownership === 'personal' ? t('skills.personalTarget') : target.employerName}
          </span>
        </div>
        {target.notes && <p className="mt-1 line-clamp-2 text-sm text-secondary">{target.notes}</p>}
      </div>
      <p className="shrink-0 text-sm text-secondary">{t('skills.targetLevelPrefix')} {target.targetLevel} · {t('skills.targetDatePrefix')} {new Date(`${target.targetDate}T00:00:00`).toLocaleDateString()}</p>
    </>
  )

  if (target.ownership === 'personal') {
    return (
      <Link to={`/skills/${target.skillId}`} className="flex flex-col gap-2 py-4 hover:text-moss sm:flex-row sm:items-start sm:justify-between">
        {content}
      </Link>
    )
  }

  return <div className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between">{content}</div>
}

function SkillGrid({ skills, onEdit }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {skills.map((skill) => (
        <SkillCard key={skill.id} skill={skill} onEdit={onEdit} compact />
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
