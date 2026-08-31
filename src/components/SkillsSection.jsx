import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import SkillCard from './SkillCard'
import FindSkillModal from './FindSkillModal'
import FilterRow from './FilterRow'
import TrackingReasonIcon from './TrackingReasonIcon'
import OrganizationLogo from './OrganizationLogo'
import GrowthRing from './GrowthRing'
import { TRACKING_REASONS } from '../lib/trackingReasons'
import { LEVEL_LABELS } from '../lib/levels'
import { isSelfAssessmentDue } from '../lib/checkin'

const SKILL_VIEWS = [
  { value: 'all', label: 'All' },
  { value: 'current', label: 'Current role' },
  { value: 'developing', label: 'Developing' },
  { value: 'review', label: 'Needs review' },
]

export default function SkillsSection() {
  const { user } = useAuth()
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

  useEffect(() => {
    loadSkills()
    loadCurrentRoles()
  }, [])

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
    const [{ data, error }, { data: tagLinks }, { data: practicalAssessments }, { data: skillTargets }] =
      await Promise.all([
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
        data.map((s) => ({
          ...s,
          displayedLevel: s.level ?? latestPracticalBySkillId.get(s.id) ?? null,
          displayedLevelIsSelfAssessed: selfAssessedSkillIds.has(s.id),
          targetLevel: latestTargetLevelBySkillId.get(s.id) ?? null,
        }))
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
          <h1 className="font-display text-3xl sm:text-4xl text-ink text-balance">Your skills</h1>
          <p className="text-secondary mt-2 text-pretty">
            Track what you know, where you are growing, and what needs attention next.
          </p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="rounded-md bg-moss text-paper py-2.5 px-4 font-medium hover:opacity-90 shrink-0 self-start"
        >
          Add skill
        </button>
      </div>

      {loading && <SkillsSkeleton />}
      {error && (
        <div role="alert" className="rounded-lg border border-red-700 p-4 text-sm text-red-700">
          We could not load your skills. Refresh the page to try again.
        </div>
      )}

      {!loading && !error && activeSkills.length === 0 && archivedSkills.length === 0 && (
        <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
          <h2 className="font-display text-xl text-ink">Start with a skill that matters now</h2>
          <p className="text-secondary mt-2 mb-5">Add your first skill to assess it, set a target, and track progress.</p>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="rounded-md bg-moss text-paper py-2.5 px-4 font-medium hover:opacity-90"
          >
            Add your first skill
          </button>
        </div>
      )}

      {!loading && !error && activeSkills.length > 0 && (
        <div className="border-y border-hairline py-4 mb-8 space-y-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className="min-w-0">
              <span className="sr-only">Search skills</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search your skills"
                className="w-full rounded-md border border-hairline bg-card px-3 py-2.5 text-ink placeholder:text-secondary"
              />
            </label>
            <button
              type="button"
              onClick={() => setShowFilters((value) => !value)}
              aria-expanded={showFilters}
              className="rounded-md border border-hairline bg-card px-3 py-2.5 text-sm font-medium text-ink hover:border-moss"
            >
              Filters{activeMoreFilterCount > 0 ? ` (${activeMoreFilterCount})` : ''}
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
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
                  {option.label}
                </button>
              ))}
            </div>
            <label className="shrink-0">
              <span className="sr-only">Sort skills</span>
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value)}
                className="rounded-md border border-hairline bg-card px-3 py-1.5 text-sm text-ink"
              >
                <option value="attention">Needs attention</option>
                <option value="recent">Recently added</option>
                <option value="name">Name</option>
                <option value="level">Highest level</option>
              </select>
            </label>
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
            </div>
          )}
        </div>
      )}

      {!loading && !error && view === 'all' && !query && !tagFilter && !trackingReasonFilter && skillGaps.length > 0 && (
        <div className="mb-10">
          <h2 className="font-display text-xl text-ink">Skills to develop</h2>
          <p className="text-sm text-secondary mt-1 mb-4">The clearest opportunities to move toward your targets.</p>
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
          <h2 className="font-display text-xl text-ink">No skills match this view</h2>
          <p className="text-secondary mt-2 mb-5">Try another search or remove the active filters.</p>
          <button type="button" onClick={clearFilters} className="text-sm font-medium text-moss hover:underline">
            Clear filters
          </button>
        </div>
      )}

      {hasSplit && (
        <div className="mb-10">
          <div className="mb-4">
            <h3 className="font-display text-base text-ink">Current role</h3>
            {currentRoles.map((role) => (
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
    </section>
  )
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
