import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import RecordActivityModal from './RecordActivityModal'
import ConfirmDialog from './ConfirmDialog'
import { activityName, verbLabel, relatedSkillFromStatement, relatedExperienceFromStatement, formatDuration } from '../lib/xapiStatement'
import { formatRelativeDate, formatAbsoluteDate } from '../lib/dates'

const RECENT_LIMIT = 6

export default function RecordActivitySection() {
  const { user } = useAuth()
  const [statements, setStatements] = useState([])
  const [skills, setSkills] = useState([])
  const [experiences, setExperiences] = useState([])
  const [actorName, setActorName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState(null)
  const [deleting, setDeleting] = useState(false)

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

  async function handleSave(statement) {
    const relatedSkill = relatedSkillFromStatement(statement)
    const relatedExperience = relatedExperienceFromStatement(statement)
    const { error } = await supabase.from('xapi_statements').insert({
      user_id: user.id,
      statement,
      recorded_at: statement.timestamp,
      skill_id: relatedSkill?.id ?? null,
      experience_id: relatedExperience?.id ?? null,
    })
    if (error) throw error
    setModalOpen(false)
    await loadStatements()
  }

  async function confirmDelete() {
    setDeleting(true)
    const { error } = await supabase.from('xapi_statements').delete().eq('id', pendingDeleteId)
    if (error) setError(error.message)
    else await loadStatements()
    setDeleting(false)
    setPendingDeleteId(null)
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
          return (
            <div
              key={row.id}
              className="flex items-start justify-between gap-2 bg-card border border-hairline rounded-lg px-4 py-3"
            >
              <div className="min-w-0">
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
              </div>
              <button
                type="button"
                onClick={() => setPendingDeleteId(row.id)}
                className="shrink-0 text-xs text-red-700 font-medium"
              >
                Remove
              </button>
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

      {pendingDeleteId && (
        <ConfirmDialog
          message="Delete this recorded activity? This can't be undone."
          onConfirm={confirmDelete}
          onCancel={() => setPendingDeleteId(null)}
          confirming={deleting}
        />
      )}
    </section>
  )
}
