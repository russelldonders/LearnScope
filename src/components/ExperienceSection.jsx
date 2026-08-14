import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import TimelineItem from './TimelineItem'
import ExperienceModal from './ExperienceModal'

export default function ExperienceSection() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [learningSummaries, setLearningSummaries] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modalType, setModalType] = useState(null)

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

  async function handleSave(values) {
    const { error } = await supabase.from('experience').insert({
      type: values.type,
      title: values.title,
      organization: values.organization,
      organization_url: values.organization_url,
      start_date: values.start_date,
      end_date: values.end_date,
      description: values.description,
      user_id: user.id,
    })
    if (error) throw error
    setModalType(null)
    await loadExperience()
  }

  return (
    <section>
      <div className="mb-6">
        <h2 className="font-display text-xl text-ink mb-3">Experience timeline</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setModalType('employment')}
            className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90"
          >
            + Add Job
          </button>
          <button
            onClick={() => setModalType('project')}
            className="rounded-md border border-hairline text-ink py-2 px-4 font-medium hover:bg-paper"
          >
            + Add Project
          </button>
          <button
            onClick={() => setModalType('volunteer')}
            className="rounded-md border border-hairline text-ink py-2 px-4 font-medium hover:bg-paper"
          >
            + Add Volunteer Position
          </button>
          <button
            onClick={() => setModalType('other')}
            className="rounded-md border border-hairline text-ink py-2 px-4 font-medium hover:bg-paper"
          >
            + Add Other Experience
          </button>
        </div>
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
            onEdit={(item) => navigate(`/experience/${item.id}`)}
            isLast={i === items.length - 1}
          />
        ))}
      </div>

      {modalType && (
        <ExperienceModal type={modalType} onSave={handleSave} onClose={() => setModalType(null)} />
      )}
    </section>
  )
}
