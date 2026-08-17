import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import RecordActivityModal from './RecordActivityModal'
import { activityName, verbLabel, relatedSkillFromStatement, formatDuration } from '../lib/xapiStatement'

const RECENT_LIMIT = 6

export default function RecordActivitySection() {
  const { user } = useAuth()
  const [statements, setStatements] = useState([])
  const [skills, setSkills] = useState([])
  const [actorName, setActorName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    loadStatements()
    loadSkills()
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

  async function handleSave(statement) {
    const { error } = await supabase.from('xapi_statements').insert({
      user_id: user.id,
      statement,
      recorded_at: statement.timestamp,
    })
    if (error) throw error
    setModalOpen(false)
    await loadStatements()
  }

  async function handleDelete(id) {
    if (!confirm("Delete this recorded activity? This can't be undone.")) return
    const { error } = await supabase.from('xapi_statements').delete().eq('id', id)
    if (error) setError(error.message)
    else await loadStatements()
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-display text-xl text-ink">Record activity</h2>
        <button
          onClick={() => setModalOpen(true)}
          className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90"
        >
          + Record activity
        </button>
      </div>
      <p className="text-sm text-secondary mb-6">
        A day-to-day activity log, saved as xAPI statements — separate from your work &amp; education
        timeline below.
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
          const duration = formatDuration(row.statement)
          return (
            <div
              key={row.id}
              className="flex items-start justify-between gap-2 bg-card border border-hairline rounded-lg px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm text-ink">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">
                    {verbLabel(row.statement)}
                  </span>{' '}
                  {activityName(row.statement)}
                </p>
                <p className="font-mono text-xs text-secondary mt-0.5">
                  {new Date(row.recorded_at).toLocaleDateString()}
                  {duration ? ` · ${duration}` : ''}
                  {relatedSkill ? ` · ${relatedSkill.name}` : ''}
                </p>
                {row.statement.object?.definition?.description?.['en-US'] && (
                  <p className="text-sm text-ink mt-1">
                    {row.statement.object.definition.description['en-US']}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleDelete(row.id)}
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
          onSave={handleSave}
          onClose={() => setModalOpen(false)}
        />
      )}
    </section>
  )
}
