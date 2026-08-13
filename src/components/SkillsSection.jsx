import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import SkillCard from './SkillCard'
import FindSkillModal from './FindSkillModal'
import TrackingReasonIcon from './TrackingReasonIcon'
import { TRACKING_REASONS, TRACKING_REASON_LABELS } from '../lib/trackingReasons'

export default function SkillsSection() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [skills, setSkills] = useState([])
  const [tagsBySkill, setTagsBySkill] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [reasonFilter, setReasonFilter] = useState(null)
  const [tagFilter, setTagFilter] = useState(null)

  useEffect(() => {
    loadSkills()
  }, [])

  async function loadSkills() {
    setLoading(true)
    const [{ data, error }, { data: tagLinks }] = await Promise.all([
      supabase
        .from('skills')
        .select('*')
        .eq('user_id', user.id)
        .order('date_added', { ascending: false }),
      supabase.from('skill_tags').select('skill_id, tags(name)').eq('user_id', user.id),
    ])
    if (error) {
      setError(error.message)
    } else {
      setSkills(data)
      const map = new Map()
      for (const link of tagLinks ?? []) {
        if (!link.tags?.name) continue
        if (!map.has(link.skill_id)) map.set(link.skill_id, [])
        map.get(link.skill_id).push(link.tags.name)
      }
      setTagsBySkill(map)
    }
    setLoading(false)
  }

  const filteredSkills = useMemo(
    () =>
      skills.filter(
        (s) =>
          (!reasonFilter || s.tracking_reason === reasonFilter) &&
          (!tagFilter || (tagsBySkill.get(s.id) ?? []).includes(tagFilter))
      ),
    [skills, reasonFilter, tagFilter, tagsBySkill]
  )
  const currentRoleSkills = useMemo(
    () => filteredSkills.filter((s) => s.is_current_role),
    [filteredSkills]
  )
  const otherSkills = useMemo(
    () => filteredSkills.filter((s) => !s.is_current_role),
    [filteredSkills]
  )
  const hasSplit = currentRoleSkills.length > 0

  const availableTags = useMemo(
    () => [...new Set([...tagsBySkill.values()].flat())].sort(),
    [tagsBySkill]
  )
  const availableReasons = useMemo(
    () => TRACKING_REASONS.filter((r) => skills.some((s) => s.tracking_reason === r.value)),
    [skills]
  )

  return (
    <section>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-xl text-ink">Your skills</h2>
        <button
          onClick={() => setAddOpen(true)}
          className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90"
        >
          + Find skill
        </button>
      </div>

      {loading && <p className="text-secondary">Loading…</p>}
      {error && <p className="text-red-700 text-sm">{error}</p>}

      {!loading && skills.length === 0 && (
        <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No skills logged yet. Add your first one.</p>
        </div>
      )}

      {!loading && skills.length > 0 && (availableReasons.length > 0 || availableTags.length > 0) && (
        <div className="flex flex-wrap items-center gap-3 mb-6">
          {availableReasons.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setReasonFilter(null)}
                className={`font-mono text-xs uppercase tracking-wide rounded-full px-3 py-1 border transition-colors ${
                  reasonFilter === null
                    ? 'bg-moss text-paper border-moss'
                    : 'border-hairline text-secondary hover:text-ink'
                }`}
              >
                All
              </button>
              {availableReasons.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setReasonFilter(reasonFilter === r.value ? null : r.value)}
                  className={`flex items-center gap-1.5 font-mono text-xs uppercase tracking-wide rounded-full px-3 py-1 border transition-colors ${
                    reasonFilter === r.value
                      ? 'bg-moss text-paper border-moss'
                      : 'border-hairline text-secondary hover:text-ink'
                  }`}
                >
                  <TrackingReasonIcon reason={r.value} size={12} />
                  {TRACKING_REASON_LABELS[r.value]}
                </button>
              ))}
            </div>
          )}

          {availableTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {availableTags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTagFilter(tagFilter === t ? null : t)}
                  className={`font-mono text-xs uppercase tracking-wide rounded-full px-3 py-1 border transition-colors ${
                    tagFilter === t
                      ? 'bg-moss text-paper border-moss'
                      : 'border-hairline text-secondary hover:text-ink'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!loading && skills.length > 0 && filteredSkills.length === 0 && (
        <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No skills match this filter.</p>
        </div>
      )}

      {hasSplit && (
        <div className="mb-10">
          <h3 className="font-display text-base text-ink mb-4">Current role</h3>
          <SkillGrid
            skills={currentRoleSkills}
            tagsBySkill={tagsBySkill}
            onEdit={(skill) => navigate(`/skills/${skill.id}`)}
          />
        </div>
      )}

      {otherSkills.length > 0 && (
        <div>
          {hasSplit && <h3 className="font-display text-base text-ink mb-4">Further skills</h3>}
          <SkillGrid
            skills={otherSkills}
            tagsBySkill={tagsBySkill}
            onEdit={(skill) => navigate(`/skills/${skill.id}`)}
          />
        </div>
      )}

      {addOpen && (
        <FindSkillModal
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            setAddOpen(false)
            loadSkills()
          }}
        />
      )}
    </section>
  )
}

function SkillGrid({ skills, tagsBySkill, onEdit }) {
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {skills.map((skill) => (
        <SkillCard key={skill.id} skill={skill} tags={tagsBySkill.get(skill.id)} onEdit={onEdit} />
      ))}
    </div>
  )
}
