import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { EXPERIENCE_TYPES } from '../lib/experienceTypes'
import TimelineItem from './TimelineItem'
import ExperienceModal from './ExperienceModal'
import AddExperienceButton from './AddExperienceButton'
import AccessibleDialog from './AccessibleDialog'

const ADD_EXPERIENCE_TYPES = EXPERIENCE_TYPES
  .filter((type) => type.value !== 'education' && type.value !== 'subject')
  .map((type) => type.value)

export default function ExperienceSection() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [items, setItems] = useState([])
  const [learningSummaries, setLearningSummaries] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Lets a caller (e.g. the dashboard's "record your current role" prompt)
  // land here with the right "Add" modal already open, instead of making
  // the learner pick the type themselves right after choosing to act on it.
  const [modalType, setModalType] = useState(
    ADD_EXPERIENCE_TYPES.includes(location.state?.autoOpenType) ? location.state.autoOpenType : null
  )
  const [pendingJob, setPendingJob] = useState(null)
  const [existingCurrentJob, setExistingCurrentJob] = useState(null)

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

    // A skill/course linked to a nested subject or project rolls up into
    // the parent's own summary too, mirroring the "Skills developed" rollup
    // on the experience detail page -- otherwise education entries (whose
    // links usually sit on their subjects) would never show anything here.
    for (const item of experienceItems) {
      if (!item.parent_experience_id) continue
      const parentSummary = map[item.parent_experience_id]
      const childSummary = map[item.id]
      if (!parentSummary || !childSummary) continue
      for (const name of childSummary.courseNames) parentSummary.courseNames.add(name)
      for (const name of childSummary.skillNames) parentSummary.skillNames.add(name)
    }

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
    if (values.type === 'employment' && !values.end_date) {
      const existing = items.find((i) => i.type === 'employment' && !i.end_date)
      if (existing) {
        setModalType(null)
        setExistingCurrentJob(existing)
        setPendingJob(values)
        return
      }
    }
    await insertExperience(values)
  }

  async function insertExperience(values) {
    const { error } = await supabase.from('experience').insert({
      type: values.type,
      title: values.title,
      other_type: values.other_type,
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

  async function resolvePendingJob(endOldJob, oldJobEndDate) {
    if (endOldJob) {
      const { error } = await supabase
        .from('experience')
        .update({ end_date: oldJobEndDate })
        .eq('id', existingCurrentJob.id)
      if (error) throw error
    }
    await insertExperience(pendingJob)
    setPendingJob(null)
    setExistingCurrentJob(null)
  }

  // Sub-experiences (including subjects nested under education) render
  // inside their parent's card rather than as their own entry
  // on the main timeline -- items is already ordered by start_date, so each
  // parent's children stay in that same order.
  const rootItems = items.filter((i) => !i.parent_experience_id)
  const childrenByParent = {}
  for (const i of items) {
    if (!i.parent_experience_id) continue
    if (!childrenByParent[i.parent_experience_id]) childrenByParent[i.parent_experience_id] = []
    childrenByParent[i.parent_experience_id].push(i)
  }

  return (
    <section>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div className="max-w-2xl">
          <h1 className="font-display text-3xl sm:text-4xl text-ink text-balance">Experience timeline</h1>
          <p className="text-secondary mt-2 text-pretty">
            Your employment, education, and other milestones, in order.
          </p>
        </div>
        <div className="shrink-0 self-start">
          <AddExperienceButton types={ADD_EXPERIENCE_TYPES} onSelect={setModalType} />
        </div>
      </div>

      {loading && <p className="text-secondary">Loading…</p>}
      {error && <p className="text-red-700 text-sm">{error}</p>}

      {!loading && rootItems.length === 0 && (
        <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No education or employment history yet. Add your first one.</p>
        </div>
      )}

      <div>
        {rootItems.map((item, i) => (
          <TimelineItem
            key={item.id}
            item={item}
            summary={learningSummaries[item.id]}
            childExperiences={childrenByParent[item.id]}
            onEdit={(item) => navigate(`/experience/${item.id}`)}
            isLast={i === rootItems.length - 1}
          />
        ))}
      </div>

      {modalType && (
        <ExperienceModal type={modalType} onSave={handleSave} onClose={() => setModalType(null)} />
      )}

      {pendingJob && existingCurrentJob && (
        <CurrentJobPrompt
          existingJob={existingCurrentJob}
          onEndAndContinue={(oldJobEndDate) => resolvePendingJob(true, oldJobEndDate)}
          onKeepBoth={() => resolvePendingJob(false, null)}
          onCancel={() => {
            setPendingJob(null)
            setExistingCurrentJob(null)
          }}
        />
      )}
    </section>
  )
}

function CurrentJobPrompt({ existingJob, onEndAndContinue, onKeepBoth, onCancel }) {
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleEnd() {
    setError(null)
    setSaving(true)
    try {
      await onEndAndContinue(endDate)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  async function handleKeepBoth() {
    setError(null)
    setSaving(true)
    try {
      await onKeepBoth()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="current-job-dialog-title"
      onClose={onCancel}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6"
    >
        <h2 id="current-job-dialog-title" className="font-display text-xl text-ink mb-2">You already have a current job</h2>
        <p className="text-sm text-secondary mb-4">
          {existingJob.title}
          {existingJob.organization ? ` at ${existingJob.organization}` : ''} is marked as your current job. Would
          you like to mark it as ended?
        </p>

        <div className="mb-4">
          <label className="block text-sm text-secondary mb-1" htmlFor="oldJobEndDate">
            End date for {existingJob.title}
          </label>
          <input
            id="oldJobEndDate"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
          />
        </div>

        {error && <p className="text-sm text-red-700 mb-3">{error}</p>}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={handleEnd}
            className="rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
          >
            Yes, mark it ended and continue
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleKeepBoth}
            className="rounded-md border border-hairline text-ink py-2 hover:bg-paper disabled:opacity-60"
          >
            Keep both as current
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onCancel}
            className="text-sm text-secondary hover:text-ink py-1"
          >
            Cancel
          </button>
        </div>
    </AccessibleDialog>
  )
}
