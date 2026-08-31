import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import RecordActivityModal from './RecordActivityModal'
import ActivityRow from './ActivityRow'
import { relatedSkillFromStatement, relatedExperienceFromStatement } from '../lib/xapiStatement'
import { uploadEvidenceFiles } from '../lib/skillEvidence'
import { linkSkillToExperiences } from '../lib/currentRole'

const RECENT_LIMIT = 6

export default function RecordActivitySection() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [statements, setStatements] = useState([])
  const [skills, setSkills] = useState([])
  const [experiences, setExperiences] = useState([])
  const [actorName, setActorName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    loadStatements()
    loadSkills()
    loadExperiences()
    loadActorName()
  }, [])

  async function loadStatements() {
    setLoading(true)
    // Ordered by when it was logged, not the (possibly backdated) date it
    // happened -- this widget is "things you've recently recorded," so a
    // historical activity you just added should still show up here even
    // though its own date sorts older. The subject/skill pages show the
    // true chronological history separately, sorted by recorded_at.
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
    const relatedSkill = relatedSkillFromStatement(statement)
    const relatedExperience = relatedExperienceFromStatement(statement)
    const { data, error } = await supabase
      .from('xapi_statements')
      .insert({
        user_id: user.id,
        statement,
        recorded_at: statement.timestamp,
        skill_id: relatedSkill?.id ?? null,
        experience_id: relatedExperience?.id ?? null,
        evidence_url: evidence?.evidenceUrl || null,
      })
      .select()
      .single()
    if (error) throw error
    if (evidence?.files.length > 0) {
      const paths = await uploadEvidenceFiles(user.id, relatedSkill.id, data.id, evidence.files)
      const { error: updateError } = await supabase
        .from('xapi_statements')
        .update({ evidence_paths: paths })
        .eq('id', data.id)
      if (updateError) throw updateError
    }
    if (relatedSkill && relatedExperience) {
      await linkSkillToExperiences(user.id, relatedSkill.id, [relatedExperience.id])
    }
    setModalOpen(false)
    await loadStatements()
  }

  function goToActivity(row, relatedSkill, relatedExperience) {
    if (relatedExperience) {
      navigate(`/experience/${relatedExperience.id}`, { state: { highlightActivityId: row.id } })
    } else if (relatedSkill) {
      navigate(`/skills/${relatedSkill.id}`, { state: { highlightActivityId: row.id } })
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-display text-xl text-ink">Skill activity</h2>
        <button
          onClick={() => setModalOpen(true)}
          className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90"
        >
          + Log skill activity
        </button>
      </div>
      <p className="text-sm text-secondary mb-6">
        Quick notes about things you did that contributed to developing a skill.
      </p>

      {loading && <p className="text-secondary">Loading…</p>}
      {error && <p className="text-red-700 text-sm">{error}</p>}

      {!loading && statements.length === 0 && (
        <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">Nothing recorded yet. Log your first activity.</p>
        </div>
      )}

      <div className="space-y-2">
        {statements.slice(0, RECENT_LIMIT).map((row) => {
          const relatedSkill = relatedSkillFromStatement(row.statement)
          const relatedExperience = relatedExperienceFromStatement(row.statement)
          const canNavigate = Boolean(relatedExperience || relatedSkill)
          return (
            <ActivityRow
              key={row.id}
              row={row}
              onClick={canNavigate ? () => goToActivity(row, relatedSkill, relatedExperience) : undefined}
            />
          )
        })}
      </div>

      {statements.length > RECENT_LIMIT && (
        <Link to="/activity" className="block text-xs text-moss font-medium mt-2 hover:underline">
          Showing your {RECENT_LIMIT} most recent of {statements.length} — see all activity →
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
