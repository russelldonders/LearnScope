import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import SkillCard from './SkillCard'
import SkillModal from './SkillModal'

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

  const grouped = useMemo(() => {
    const map = new Map()
    for (const skill of skills) {
      if (!map.has(skill.category)) map.set(skill.category, [])
      map.get(skill.category).push(skill)
    }
    return Array.from(map.entries())
  }, [skills])

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
        })
        .eq('id', values.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('skills').insert({
        name: values.name,
        category: values.category,
        level: values.level,
        notes: values.notes,
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

      <div className="space-y-8">
        {grouped.map(([category, categorySkills]) => (
          <div key={category}>
            <h3 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">
              {category}
            </h3>
            <div className="grid sm:grid-cols-2 gap-3">
              {categorySkills.map((skill) => (
                <SkillCard key={skill.id} skill={skill} onEdit={openEditModal} />
              ))}
            </div>
          </div>
        ))}
      </div>

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
