import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import GrowthRing from '../components/GrowthRing'

export default function SkillsProfile() {
  const { userId } = useParams()
  const [name, setName] = useState('')
  const [visible, setVisible] = useState(false)
  const [skills, setSkills] = useState([])
  const [tagsBySkill, setTagsBySkill] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    load()
  }, [userId])

  async function load() {
    setLoading(true)
    setError(null)
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('full_name, skills_profile_visible')
      .eq('id', userId)
      .single()
    if (profileError) {
      setError("This person's profile couldn't be found.")
      setLoading(false)
      return
    }
    setName(profile.full_name || 'This person')
    setVisible(Boolean(profile.skills_profile_visible))

    if (profile.skills_profile_visible) {
      const [{ data, error: skillsError }, { data: tagLinks }] = await Promise.all([
        supabase
          .from('skills')
          .select('id, name, level')
          .eq('user_id', userId)
          .order('name', { ascending: true }),
        supabase.from('skill_tags').select('skill_id, tags(name)').eq('user_id', userId),
      ])
      if (skillsError) {
        setError(skillsError.message)
      } else {
        setSkills(data ?? [])
        const map = new Map()
        for (const link of tagLinks ?? []) {
          if (!link.tags?.name) continue
          if (!map.has(link.skill_id)) map.set(link.skill_id, [])
          map.get(link.skill_id).push(link.tags.name)
        }
        setTagsBySkill(map)
      }
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-hairline bg-card">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/dashboard" className="font-display text-2xl text-ink">
            LearnScope
          </Link>
          <Link
            to="/connections"
            className="text-sm text-secondary hover:text-ink border border-hairline rounded-md px-3 py-1.5"
          >
            Back to connections
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : error ? (
          <p className="text-red-700 text-sm">{error}</p>
        ) : !visible ? (
          <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary">{name} hasn't made their skills profile visible.</p>
          </div>
        ) : (
          <>
            <h2 className="font-display text-xl text-ink mb-6">{name}'s skills</h2>

            {skills.length === 0 ? (
              <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
                <p className="text-secondary">No skills tracked yet.</p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {skills.map((skill) => (
                  <div
                    key={skill.id}
                    className="bg-card border border-hairline rounded-lg p-4 flex gap-4 items-center"
                  >
                    <GrowthRing level={skill.level} size={48} />
                    <div className="min-w-0">
                      <h3 className="font-display text-lg text-ink truncate">{skill.name}</h3>
                      {tagsBySkill.get(skill.id)?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {tagsBySkill.get(skill.id).map((t) => (
                            <span
                              key={t}
                              className="font-mono text-[10px] uppercase tracking-wide text-secondary border border-hairline rounded-full px-2 py-0.5"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
