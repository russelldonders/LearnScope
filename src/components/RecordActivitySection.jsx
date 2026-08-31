import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import RecordActivityModal from './RecordActivityModal'
import EvidenceAttachmentLink from './EvidenceAttachmentLink'
import { activityName, verbLabel, relatedSkillFromStatement, relatedExperienceFromStatement, formatDuration } from '../lib/xapiStatement'
import { formatRelativeDate, formatAbsoluteDate } from '../lib/dates'
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
    const { data, error } = await supabase
      .from('xapi_statements')
      .select('*')
      .eq('user_id', user.id)
      .order('recorded_at', { ascending: false })
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
      .select('id, title, type, start_date')
      .eq('user_id', user.id)
      .order('start_date', { ascending: false })
    setExperiences(data ?? [])
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
          const duration = formatDuration(row.statement)
          const evidencePaths = row.evidence_paths ?? []
          const canNavigate = Boolean(relatedExperience || relatedSkill)
          return (
            <div
              key={row.id}
              role={canNavigate ? 'button' : undefined}
              tabIndex={canNavigate ? 0 : undefined}
              onClick={canNavigate ? () => goToActivity(row, relatedSkill, relatedExperience) : undefined}
              onKeyDown={(e) => {
                if (canNavigate && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault()
                  goToActivity(row, relatedSkill, relatedExperience)
                }
              }}
              className={`bg-card border border-hairline rounded-lg px-4 py-3 ${canNavigate ? 'cursor-pointer hover:border-moss/60 transition-colors' : ''}`}
            >
              <p className="text-sm text-ink">
                <span className="font-mono text-[11px] uppercase tracking-wide text-secondary">
                  {verbLabel(row.statement)}
                </span>{' '}
                {activityName(row.statement)}
              </p>
              <p className="font-mono text-xs text-secondary mt-0.5" title={formatAbsoluteDate(row.recorded_at)}>
                {formatRelativeDate(row.recorded_at)}
                {duration ? ` · ${duration}` : ''}
                {relatedSkill ? ` · ${relatedSkill.name}` : ''}
                {relatedExperience ? ` · ${relatedExperience.title}` : ''}
              </p>
              {row.statement.object?.definition?.description?.['en-US'] && (
                <p className="text-sm text-ink mt-1">
                  {row.statement.object.definition.description['en-US']}
                </p>
              )}
              {(row.evidence_url || evidencePaths.length > 0) && (
                <div className="flex flex-wrap items-center gap-3 mt-1" onClick={(e) => e.stopPropagation()}>
                  {row.evidence_url && (
                    <a
                      href={row.evidence_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-moss font-medium"
                    >
                      Evidence link
                    </a>
                  )}
                  {evidencePaths.map((path, i) => (
                    <EvidenceAttachmentLink key={path} path={path} index={i} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {statements.length > RECENT_LIMIT && (
        <p className="text-xs text-secondary mt-2">
          Showing your {RECENT_LIMIT} most recent of {statements.length}.
        </p>
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
