import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import SkillCard from './SkillCard'
import FindSkillModal from './FindSkillModal'
import FilterRow from './FilterRow'
import TrackingReasonIcon from './TrackingReasonIcon'
import OrganizationLogo from './OrganizationLogo'
import { TRACKING_REASONS } from '../lib/trackingReasons'

export default function SkillsSection() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [skills, setSkills] = useState([])
  const [currentRoles, setCurrentRoles] = useState([])
  const [tagsBySkill, setTagsBySkill] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [tagFilter, setTagFilter] = useState(null)
  const [trackingReasonFilter, setTrackingReasonFilter] = useState(null)
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    loadSkills()
    loadCurrentRoles()
  }, [])

  async function loadCurrentRoles() {
    const { data } = await supabase
      .from('experience')
      .select('id, title, organization, organization_url')
      .eq('user_id', user.id)
      .eq('type', 'employment')
      .is('end_date', null)
      .order('start_date', { ascending: false })
    setCurrentRoles(data ?? [])
  }

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
          (!tagFilter || (tagsBySkill.get(s.id) ?? []).includes(tagFilter)) &&
          (!trackingReasonFilter || s.tracking_reason === trackingReasonFilter)
      ),
    [skills, tagFilter, tagsBySkill, trackingReasonFilter]
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
  const activeMoreFilterCount = [tagFilter].filter((v) => v !== null).length

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

      {!loading && skills.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <button
              type="button"
              onClick={() => setTrackingReasonFilter(null)}
              className={`font-mono text-xs uppercase tracking-wide rounded-full px-3 py-1 border transition-colors ${
                trackingReasonFilter === null
                  ? 'bg-moss text-paper border-moss'
                  : 'border-hairline text-secondary hover:text-ink'
              }`}
            >
              Any
            </button>
            {TRACKING_REASONS.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setTrackingReasonFilter(trackingReasonFilter === r.value ? null : r.value)}
                className={`flex items-center gap-1.5 font-mono text-xs uppercase tracking-wide rounded-full px-3 py-1 border transition-colors ${
                  trackingReasonFilter === r.value
                    ? 'bg-moss text-paper border-moss'
                    : 'border-hairline text-secondary hover:text-ink'
                }`}
              >
                <TrackingReasonIcon reason={r.value} size={14} />
                {r.label}
              </button>
            ))}
          </div>

          {availableTags.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                className="text-sm text-moss font-medium mb-4"
              >
                {showFilters
                  ? 'Hide More Filters'
                  : `Show More Filters${activeMoreFilterCount > 0 ? ` (${activeMoreFilterCount})` : ''}`}
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
        </>
      )}

      {!loading && skills.length > 0 && filteredSkills.length === 0 && (
        <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No skills match this filter.</p>
        </div>
      )}

      {hasSplit && (
        <div className="mb-10">
          <div className="mb-4">
            <h3 className="font-display text-base text-ink">Current role</h3>
            {currentRoles.map((role) => (
              <p key={role.id} className="flex items-center gap-1.5 text-sm text-secondary mt-1">
                {role.organization_url && <OrganizationLogo organizationUrl={role.organization_url} size={18} />}
                <span>
                  {role.title}
                  {role.organization ? ` · ${role.organization}` : ''}
                </span>
              </p>
            ))}
          </div>
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
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {skills.map((skill) => (
        <SkillCard key={skill.id} skill={skill} onEdit={onEdit} />
      ))}
    </div>
  )
}
