import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import SkillCard from './SkillCard'
import SkillModal from './SkillModal'

function groupByCategory(skills) {
  const map = new Map()
  for (const skill of skills) {
    if (!map.has(skill.category)) map.set(skill.category, [])
    map.get(skill.category).push(skill)
  }
  return Array.from(map.entries())
}

export default function SkillsSection() {
  const { user } = useAuth()
  const [skills, setSkills] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modalSkill, setModalSkill] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)

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
    }
    setLoading(false)
  }

  const currentRoleSkills = useMemo(() => skills.filter((s) => s.is_current_role), [skills])
  const otherSkills = useMemo(() => skills.filter((s) => !s.is_current_role), [skills])
  const currentRoleGrouped = useMemo(() => groupByCategory(currentRoleSkills), [currentRoleSkills])
  const otherGrouped = useMemo(() => groupByCategory(otherSkills), [otherSkills])
  const hasSplit = currentRoleSkills.length > 0

  const categories = useMemo(() => [...new Set(skills.map((s) => s.category))], [skills])

  function openAddModal() {
    setModalSkill(null)
    setModalOpen(true)
  }

  function openEditModal(skill) {
    setModalSkill(skill)
    setModalOpen(true)
  }

  async function handleSave(values) {
    if (values.id) {
      const { error } = await supabase
        .from('skills')
        .update({
          name: values.name,
          category: values.category,
          level: values.level,
          notes: values.notes,
          is_current_role: values.is_current_role,
        })
        .eq('id', values.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('skills').insert({
        name: values.name,
        category: values.category,
        level: values.level,
        notes: values.notes,
        is_current_role: values.is_current_role,
        user_id: user.id,
      })
      if (error) throw error
    }
    setModalOpen(false)
    await loadSkills()
  }

  async function handleDelete(id) {
    const { error } = await supabase.from('skills').delete().eq('id', id)
    if (error) throw error
    setModalOpen(false)
    await loadSkills()
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-xl text-ink">Your skills</h2>
        <button
          onClick={openAddModal}
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
          <SkillGroups grouped={currentRoleGrouped} onEdit={openEditModal} />
        </div>
      )}

      {otherSkills.length > 0 && (
        <div>
          {hasSplit && <h3 className="font-display text-base text-ink mb-4">Further skills</h3>}
          <SkillGroups grouped={otherGrouped} onEdit={openEditModal} />
        </div>
      )}

      {modalOpen && (
        <SkillModal
          skill={modalSkill}
          categories={categories}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setModalOpen(false)}
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
