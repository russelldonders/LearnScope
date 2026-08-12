import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import GrowthRing from '../components/GrowthRing'

function groupByCategory(skills) {
  const map = new Map()
  for (const skill of skills) {
    if (!map.has(skill.category)) map.set(skill.category, [])
    map.get(skill.category).push(skill)
  }
  return Array.from(map.entries())
}

export default function SkillsProfile() {
  const { userId } = useParams()
  const [name, setName] = useState('')
  const [visible, setVisible] = useState(false)
  const [skills, setSkills] = useState([])
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
      const { data, error: skillsError } = await supabase
        .from('skills')
        .select('id, name, category, level')
        .eq('user_id', userId)
        .order('category', { ascending: true })
        .order('name', { ascending: true })
      if (skillsError) setError(skillsError.message)
      else setSkills(data ?? [])
    }
    setLoading(false)
  }

  const grouped = groupByCategory(skills)

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
              <div className="space-y-8">
                {grouped.map(([category, categorySkills]) => (
                  <div key={category}>
                    <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">
                      {category}
                    </h4>
                    <div className="grid sm:grid-cols-2 gap-3">
                      {categorySkills.map((skill) => (
                        <div
                          key={skill.id}
                          className="bg-card border border-hairline rounded-lg p-4 flex gap-4 items-center"
                        >
                          <GrowthRing level={skill.level} size={48} />
                          <h3 className="font-display text-lg text-ink truncate">{skill.name}</h3>
                        </div>
                      ))}
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
