import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import SkillCard from './SkillCard'
import SkillModal from './SkillModal'
import SkillDetailModal from './SkillDetailModal'

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

  const currentRoleSkills = useMemo(() => skills.filter((s) => s.is_current_role), [skills])
  const otherSkills = useMemo(() => skills.filter((s) => !s.is_current_role), [skills])
  const currentRoleGrouped = useMemo(() => groupByCategory(currentRoleSkills), [currentRoleSkills])
  const otherGrouped = useMemo(() => groupByCategory(otherSkills), [otherSkills])
  const hasSplit = currentRoleSkills.length > 0

  const categories = useMemo(() => [...new Set(skills.map((s) => s.category))], [skills])

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
