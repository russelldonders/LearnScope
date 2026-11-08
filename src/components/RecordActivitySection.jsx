import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import RecordActivityModal from './RecordActivityModal'
import ActivityTimeline from './ActivityTimeline'
import { timelineRows } from '../lib/activityTimeline'
import { relatedSkillsFromStatement, relatedExperienceFromStatement } from '../lib/xapiStatement'
import { linkSkillToExperiences } from '../lib/currentRole'
import { saveActivity } from '../lib/activitySkillLinks'
import { useLanguage } from '../context/LanguageContext'

const RECENT_LIMIT = 8

// The form can be opened from outside (the dashboard's quick log offers it),
// and refreshKey reloads the list after activities were saved elsewhere.
// onLogAgain(row) hands an activity to the quick log to repeat.
export default function RecordActivitySection({ formOpen, onFormOpenChange, refreshKey = 0, onSaved, onLogAgain }) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [statements, setStatements] = useState([])
  const [skills, setSkills] = useState([])
  const [experiences, setExperiences] = useState([])
  const [actorName, setActorName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [ownModalOpen, setOwnModalOpen] = useState(false)
  const modalOpen = formOpen ?? ownModalOpen
  const setModalOpen = onFormOpenChange ?? setOwnModalOpen

  useEffect(() => {
    loadStatements()
    loadSkills()
    loadExperiences()
    loadActorName()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the listed values change; the loaders are recreated every render
  }, [])

  useEffect(() => {
    if (refreshKey > 0) {
      loadStatements()
      loadSkills()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reloads only when another part of the page saved something
  }, [refreshKey])

  // Shown by when each activity happened (see timelineRows): the most recent
  // ones, plus anything just logged for an earlier date, marked as such so a
  // backdated entry is still easy to spot straight after adding it.
  const timeline = useMemo(() => timelineRows(statements, { limit: RECENT_LIMIT }), [statements])

  async function loadStatements() {
    setLoading(true)
    const { data, error } = await supabase
      .from('xapi_statements')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    else setStatements(data)
    setLoading(false)
  }

  async function loadSkills() {
    const { data } = await supabase
      .from('skills')
      .select('id, name, category')
      .eq('user_id', user.id)
      .order('name')
    setSkills(data ?? [])
  }

  async function loadActorName() {
    const { data } = await supabase.from('profiles').select('full_name').eq('id', user.id).single()
    setActorName(data?.full_name ?? '')
  }

  async function loadExperiences() {
    const { data } = await supabase
      .from('experience')
      .select('id, title, type, start_date, parent_experience_id')
      .eq('user_id', user.id)
      .order('start_date', { ascending: false })
    const items = data ?? []
    // A subject or project's parent education/job is already in this same
    // flat list -- look it up locally instead of a second round trip, so
    // the picker (and the statement it builds) can carry the full trail.
    const byId = new Map(items.map((e) => [e.id, e]))
    setExperiences(
      items.map((e) => ({
        ...e,
        parent: e.parent_experience_id ? byId.get(e.parent_experience_id) ?? null : null,
      }))
    )
  }

  async function handleSave(statement, evidence) {
    const relatedSkills = relatedSkillsFromStatement(statement)
    const relatedExperience = relatedExperienceFromStatement(statement)
    await saveActivity({
      userId: user.id,
      statement,
      evidence,
      skillIds: relatedSkills.map((s) => s.id),
      experienceId: relatedExperience?.id ?? null,
    })
    if (relatedExperience) {
      for (const skill of relatedSkills) {
        await linkSkillToExperiences(user.id, skill.id, [relatedExperience.id])
      }
    }
    setModalOpen(false)
    await loadStatements()
    await onSaved?.()
  }

  function goToActivity(row, relatedSkills, relatedExperience) {
    if (relatedExperience) {
      navigate(`/experience/${relatedExperience.id}`, { state: { highlightActivityId: row.id } })
    } else if (relatedSkills[0]) {
      navigate(`/skills/${relatedSkills[0].id}`, { state: { highlightActivityId: row.id } })
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-display text-xl text-ink">{t('activity.heading')}</h2>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="shrink-0 rounded-md border border-hairline text-ink text-sm py-1.5 px-3 font-medium hover:border-moss hover:text-moss"
        >
          {t('skillActivity.logActivity')}
        </button>
      </div>
      <p className="text-sm text-secondary mb-6">
        {t('skillActivity.description')}
      </p>

      {loading && <p className="text-secondary">{t('common.loading')}</p>}
      {error && <p className="text-red-700 text-sm">{error}</p>}

      {!loading && statements.length === 0 && (
        <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">{t('skillActivity.emptyState')}</p>
        </div>
      )}

      {timeline.length > 0 && (
        <ActivityTimeline
          rows={timeline}
          onOpen={(row) => {
            const relatedSkills = relatedSkillsFromStatement(row.statement)
            const relatedExperience = relatedExperienceFromStatement(row.statement)
            if (relatedExperience || relatedSkills[0]) goToActivity(row, relatedSkills, relatedExperience)
          }}
          onLogAgain={onLogAgain}
          onReflected={loadStatements}
        />
      )}

      {statements.length > timeline.length && (
        <Link to="/activity" className="inline-block text-sm text-moss font-medium mt-4 hover:underline">
          {t('activity.timeline.seeAll', { total: statements.length })}
        </Link>
      )}

      {modalOpen && (
        <RecordActivityModal
          actor={{ name: actorName, email: user.email }}
          skills={skills}
          experiences={experiences}
          onSave={handleSave}
          onClose={() => setModalOpen(false)}
        />
      )}
    </section>
  )
}
