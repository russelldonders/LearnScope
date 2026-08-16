import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import SkillCard from './SkillCard'
import FindSkillModal from './FindSkillModal'
import FilterRow from './FilterRow'

export default function SkillsSection() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [skills, setSkills] = useState([])
  const [tagsBySkill, setTagsBySkill] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [tagFilter, setTagFilter] = useState(null)
  const [showFilters, setShowFilters] = useState(false)

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
    () => skills.filter((s) => !tagFilter || (tagsBySkill.get(s.id) ?? []).includes(tagFilter)),
    [skills, tagFilter, tagsBySkill]
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
  const activeFilterCount = [tagFilter].filter((v) => v !== null).length

  return (
    <section>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-xl text-ink">Your skills</h2>
        <button
          onClick={() => setAddOpen(true)}
          className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90"
        >
          Find a skill to add to your profile
        </button>
      </div>

      {loading && <p className="text-secondary">Loading…</p>}
      {error && <p className="text-red-700 text-sm">{error}</p>}

      {!loading && skills.length === 0 && (
        <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No skills logged yet. Add your first one.</p>
        </div>
      )}

      {!loading && skills.length > 0 && availableTags.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className="text-sm text-moss font-medium mb-4"
          >
            {showFilters
              ? 'Hide More Filters'
              : `Show More Filters${activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}`}
          </button>

          {showFilters && (
            <div className="space-y-3 mb-6 bg-card border border-hairline rounded-lg p-4">
              <FilterRow
                label="Tag"
                value={tagFilter}
                onChange={setTagFilter}
                options={availableTags.map((t) => ({ value: t, label: t }))}
              />
            </div>
          )}
        </>
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
            onEdit={(skill) => navigate(`/skills/${skill.id}`)}
          />
        </div>
      )}

      {otherSkills.length > 0 && (
        <div>
          {hasSplit && <h3 className="font-display text-base text-ink mb-4">Further skills</h3>}
          <SkillGrid
            skills={otherSkills}
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

function SkillGrid({ skills, onEdit }) {
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {skills.map((skill) => (
        <SkillCard key={skill.id} skill={skill} onEdit={onEdit} />
      ))}
    </div>
  )
}
