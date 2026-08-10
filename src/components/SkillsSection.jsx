import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import SkillCard from './SkillCard'
import SkillModal from './SkillModal'
import SkillDetailModal from './SkillDetailModal'
import TrackingReasonIcon from './TrackingReasonIcon'
import { TRACKING_REASONS, TRACKING_REASON_LABELS } from '../lib/trackingReasons'

function groupByCategory(skills) {
  const map = new Map()
  for (const skill of skills) {
    if (!map.has(skill.category)) map.set(skill.category, [])
    map.get(skill.category).push(skill)
  }
  return Array.from(map.entries())
}

export default function SkillsSection() {
  const [skills, setSkills] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [detailSkill, setDetailSkill] = useState(null)
  const [reasonFilter, setReasonFilter] = useState(null)

  useEffect(() => {
    loadSkills()
  }, [])

  async function loadSkills() {
    setLoading(true)
    const { data, error } = await supabase
      .from('skills')
      .select('*')
      .order('category', { ascending: true })
      .order('date_added', { ascending: false })
    if (error) {
      setError(error.message)
    } else {
      setSkills(data)
      setDetailSkill((prev) => (prev ? data.find((s) => s.id === prev.id) ?? prev : prev))
    }
    setLoading(false)
  }

  const filteredSkills = useMemo(
    () => (reasonFilter ? skills.filter((s) => s.tracking_reason === reasonFilter) : skills),
    [skills, reasonFilter]
  )
  const currentRoleSkills = useMemo(
    () => filteredSkills.filter((s) => s.is_current_role),
    [filteredSkills]
  )
  const otherSkills = useMemo(
    () => filteredSkills.filter((s) => !s.is_current_role),
    [filteredSkills]
  )
  const currentRoleGrouped = useMemo(() => groupByCategory(currentRoleSkills), [currentRoleSkills])
  const otherGrouped = useMemo(() => groupByCategory(otherSkills), [otherSkills])
  const hasSplit = currentRoleSkills.length > 0

  const categories = useMemo(() => [...new Set(skills.map((s) => s.category))], [skills])
  const availableReasons = useMemo(
    () => TRACKING_REASONS.filter((r) => skills.some((s) => s.tracking_reason === r.value)),
    [skills]
  )

  return (
    <section>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-xl text-ink">Your skills</h2>
        <button
          onClick={() => setAddOpen(true)}
          className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90"
        >
          + Add skill
        </button>
      </div>

      {loading && <p className="text-secondary">Loading…</p>}
      {error && <p className="text-red-700 text-sm">{error}</p>}

      {!loading && skills.length === 0 && (
        <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No skills logged yet. Add your first one.</p>
        </div>
      )}

      {!loading && skills.length > 0 && availableReasons.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-6">
          <button
            type="button"
            onClick={() => setReasonFilter(null)}
            className={`font-mono text-xs uppercase tracking-wide rounded-full px-3 py-1 border transition-colors ${
              reasonFilter === null
                ? 'bg-moss text-paper border-moss'
                : 'border-hairline text-secondary hover:text-ink'
            }`}
          >
            All
          </button>
          {availableReasons.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setReasonFilter(reasonFilter === r.value ? null : r.value)}
              className={`flex items-center gap-1.5 font-mono text-xs uppercase tracking-wide rounded-full px-3 py-1 border transition-colors ${
                reasonFilter === r.value
                  ? 'bg-moss text-paper border-moss'
                  : 'border-hairline text-secondary hover:text-ink'
              }`}
            >
              <TrackingReasonIcon reason={r.value} size={12} />
              {TRACKING_REASON_LABELS[r.value]}
            </button>
          ))}
        </div>
      )}

      {!loading && skills.length > 0 && filteredSkills.length === 0 && (
        <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No skills match this filter.</p>
        </div>
      )}

      {hasSplit && (
        <div className="mb-10">
          <h3 className="font-display text-base text-ink mb-4">Current role</h3>
          <SkillGroups grouped={currentRoleGrouped} onEdit={setDetailSkill} />
        </div>
      )}

      {otherSkills.length > 0 && (
        <div>
          {hasSplit && <h3 className="font-display text-base text-ink mb-4">Further skills</h3>}
          <SkillGroups grouped={otherGrouped} onEdit={setDetailSkill} />
        </div>
      )}

      {addOpen && (
        <SkillModal
          categories={categories}
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            setAddOpen(false)
            loadSkills()
          }}
        />
      )}

      {detailSkill && (
        <SkillDetailModal
          skill={detailSkill}
          categories={categories}
          onClose={() => setDetailSkill(null)}
          onUpdated={loadSkills}
          onDeleted={() => {
            setDetailSkill(null)
            loadSkills()
          }}
        />
      )}
    </section>
  )
}

function SkillGroups({ grouped, onEdit }) {
  return (
    <div className="space-y-8">
      {grouped.map(([category, categorySkills]) => (
        <div key={category}>
          <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">
            {category}
          </h4>
          <div className="grid sm:grid-cols-2 gap-3">
            {categorySkills.map((skill) => (
              <SkillCard key={skill.id} skill={skill} onEdit={onEdit} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
