import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import TimelineItem from './TimelineItem'
import ExperienceModal from './ExperienceModal'

export default function ExperienceSection() {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [learningSummaries, setLearningSummaries] = useState({})
  const [skills, setSkills] = useState([])
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modalItem, setModalItem] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    loadExperience()
  }, [])

  async function loadExperience() {
    setLoading(true)
    const { data, error } = await supabase
      .from('experience')
      .select('*')
      .order('start_date', { ascending: false })
    if (error) {
      setError(error.message)
    } else {
      setItems(data)
      loadLearningSummaries(data)
    }
    setLoading(false)
  }

  // Compact "courses completed / skills touched" summary per experience,
  // shown directly on each timeline card so the learning history is visible
  // without opening the modal.
  async function loadLearningSummaries(experienceItems) {
    const ids = experienceItems.map((i) => i.id)
    if (ids.length === 0) {
      setLearningSummaries({})
      return
    }
    const [{ data: cl }, { data: sl }, { data: ach }] = await Promise.all([
      supabase.from('course_experience_links').select('experience_id, courses(name)').in('experience_id', ids),
      supabase.from('skill_experience_links').select('experience_id, skills(name)').in('experience_id', ids),
      supabase.from('skill_assessments').select('experience_id, skills(name)').in('experience_id', ids),
    ])
    const map = {}
    for (const id of ids) map[id] = { courseNames: new Set(), skillNames: new Set() }
    for (const row of cl ?? []) map[row.experience_id]?.courseNames.add(row.courses?.name)
    for (const row of sl ?? []) map[row.experience_id]?.skillNames.add(row.skills?.name)
    for (const row of ach ?? []) map[row.experience_id]?.skillNames.add(row.skills?.name)
    const result = {}
    for (const id of ids) {
      result[id] = {
        courseNames: [...map[id].courseNames].filter(Boolean),
        skillNames: [...map[id].skillNames].filter(Boolean),
      }
    }
    setLearningSummaries(result)
  }

  async function loadPickerData() {
    const [{ data: skillsData }, { data: coursesData }] = await Promise.all([
      supabase.from('skills').select('id, name, category').order('name'),
      supabase.from('courses').select('id, name, provider, completed_date').order('name'),
    ])
    setSkills(skillsData ?? [])
    setCourses(coursesData ?? [])
  }

  function openAddModal() {
    setModalItem(null)
    setModalOpen(true)
  }

  function openEditModal(item) {
    setModalItem(item)
    loadPickerData()
    setModalOpen(true)
  }

  async function handleSave(values) {
    if (values.id) {
      const { error } = await supabase
        .from('experience')
        .update({
          type: values.type,
          title: values.title,
          organization: values.organization,
          start_date: values.start_date,
          end_date: values.end_date,
          description: values.description,
        })
        .eq('id', values.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('experience').insert({
        type: values.type,
        title: values.title,
        organization: values.organization,
        start_date: values.start_date,
        end_date: values.end_date,
        description: values.description,
        user_id: user.id,
      })
      if (error) throw error
    }
    setModalOpen(false)
    await loadExperience()
  }

  async function handleDelete(id) {
    const { error } = await supabase.from('experience').delete().eq('id', id)
    if (error) throw error
    setModalOpen(false)
    await loadExperience()
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-xl text-ink">Experience timeline</h2>
        <button
          onClick={openAddModal}
          className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90"
        >
          + Add experience
        </button>
      </div>

      {loading && <p className="text-secondary">Loading…</p>}
      {error && <p className="text-red-700 text-sm">{error}</p>}

      {!loading && items.length === 0 && (
        <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No education or employment history yet. Add your first one.</p>
        </div>
      )}

      <div>
        {items.map((item, i) => (
          <TimelineItem
            key={item.id}
            item={item}
            summary={learningSummaries[item.id]}
            onEdit={openEditModal}
            isLast={i === items.length - 1}
          />
        ))}
      </div>

      {modalOpen && (
        <ExperienceModal
          item={modalItem}
          skills={skills}
          courses={courses}
          onRefreshPickerData={loadPickerData}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => {
            setModalOpen(false)
            loadExperience()
          }}
        />
      )}
    </section>
  )
}
