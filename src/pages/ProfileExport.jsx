import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import AppHeader from '../components/AppHeader'

function fmtDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString()
}

export default function ProfileExport() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [
        profileRes,
        experienceRes,
        coursesRes,
        skillsRes,
        assessmentsRes,
        targetsRes,
        skillTagsRes,
        ratingsGivenRes,
        ratingsReceivedRes,
        validationsRequestedRes,
        validationsGivenRes,
        connectionsRes,
      ] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('experience').select('*').eq('user_id', user.id).order('start_date', { ascending: false }),
        supabase.from('courses').select('*').eq('user_id', user.id).order('completed_date', { ascending: false }),
        supabase.from('skills').select('*').eq('user_id', user.id).order('name', { ascending: true }),
        supabase
          .from('skill_assessments')
          .select('*')
          .eq('user_id', user.id)
          .order('assessed_at', { ascending: false }),
        supabase.from('skill_targets').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
        supabase.from('skill_tags').select('skill_id, tags(name)').eq('user_id', user.id),
        supabase
          .from('skill_peer_ratings')
          .select('*')
          .eq('rater_id', user.id)
          .order('rated_at', { ascending: false }),
        supabase
          .from('skill_peer_ratings')
          .select('*')
          .eq('skill_owner_id', user.id)
          .order('rated_at', { ascending: false }),
        supabase
          .from('skill_validation_requests')
          .select('*')
          .eq('requester_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('skill_validation_requests')
          .select('*')
          .eq('validator_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('connections')
          .select('*')
          .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`),
      ])

      const firstError = [
        profileRes,
        experienceRes,
        coursesRes,
        skillsRes,
        assessmentsRes,
        targetsRes,
        skillTagsRes,
        ratingsGivenRes,
        ratingsReceivedRes,
        validationsRequestedRes,
        validationsGivenRes,
        connectionsRes,
      ].find((r) => r.error)
      if (firstError) throw firstError.error

      const tagsBySkillId = new Map()
      for (const row of skillTagsRes.data ?? []) {
        const list = tagsBySkillId.get(row.skill_id) ?? []
        if (row.tags?.name) list.push(row.tags.name)
        tagsBySkillId.set(row.skill_id, list)
      }

      setData({
        profile: profileRes.data,
        experience: experienceRes.data ?? [],
        courses: coursesRes.data ?? [],
        skills: skillsRes.data ?? [],
        assessmentsBySkillId: groupBy(assessmentsRes.data ?? [], 'skill_id'),
        targetsBySkillId: groupBy(targetsRes.data ?? [], 'skill_id'),
        tagsBySkillId,
        ratingsGiven: ratingsGivenRes.data ?? [],
        ratingsReceived: ratingsReceivedRes.data ?? [],
        validationsRequested: validationsRequestedRes.data ?? [],
        validationsGiven: validationsGivenRes.data ?? [],
        connections: connectionsRes.data ?? [],
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function groupBy(rows, key) {
    const map = new Map()
    for (const row of rows) {
      const list = map.get(row[key]) ?? []
      list.push(row)
      map.set(row[key], list)
    }
    return map
  }

  return (
    <div className="min-h-screen bg-paper">
      <div className="print:hidden">
        <AppHeader />
      </div>

      <main id="main-content" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between print:hidden">
          <h1 className="font-display text-xl text-ink">Your data</h1>
          {!loading && !error && (
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper"
            >
              Print / Save as PDF
            </button>
          )}
        </div>

        {loading && <p className="text-secondary">Loading…</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

        {!loading && !error && data && (
          <>
            <Section title="Profile">
              <Field label="Name">
                {[data.profile?.first_name, data.profile?.last_name].filter(Boolean).join(' ') || '—'}
              </Field>
              <Field label="Email">{user.email}</Field>
              <Field label="Country">{data.profile?.country || '—'}</Field>
              <Field label="Location">{data.profile?.location || '—'}</Field>
              <Field label="Language">{data.profile?.language || '—'}</Field>
            </Section>

            <Section title={`Employment & education (${data.experience.length})`}>
              {data.experience.map((e) => (
                <div key={e.id} className="mb-3 pb-3 border-b border-hairline last:border-0">
                  <p className="text-sm font-medium text-ink">
                    {e.title} — {e.organization}
                  </p>
                  <p className="text-xs text-secondary">
                    {e.type} · {fmtDate(e.start_date)} – {e.end_date ? fmtDate(e.end_date) : 'Present'}
                  </p>
                  {e.description && <p className="text-sm text-ink mt-1">{e.description}</p>}
                </div>
              ))}
              {data.experience.length === 0 && <Empty />}
            </Section>

            <Section title={`Courses (${data.courses.length})`}>
              {data.courses.map((c) => (
                <div key={c.id} className="mb-3 pb-3 border-b border-hairline last:border-0">
                  <p className="text-sm font-medium text-ink">{c.name}</p>
                  <p className="text-xs text-secondary">
                    {c.provider || 'Unknown provider'} · Completed {fmtDate(c.completed_date)}
                  </p>
                  {c.notes && <p className="text-sm text-ink mt-1">{c.notes}</p>}
                </div>
              ))}
              {data.courses.length === 0 && <Empty />}
            </Section>

            <Section title={`Skills (${data.skills.length})`}>
              {data.skills.map((s) => (
                <div key={s.id} className="mb-4 pb-4 border-b border-hairline last:border-0">
                  <p className="text-sm font-medium text-ink">
                    {s.name}
                    {s.category ? ` — ${s.category}` : ''}
                  </p>
                  <p className="text-xs text-secondary">
                    Current level {s.level ?? '—'} · {s.lifecycle_stage || 'tracking'}
                    {(data.tagsBySkillId.get(s.id) ?? []).length > 0
                      ? ` · Tags: ${data.tagsBySkillId.get(s.id).join(', ')}`
                      : ''}
                  </p>
                  {s.notes && <p className="text-sm text-ink mt-1">{s.notes}</p>}

                  {(data.assessmentsBySkillId.get(s.id) ?? []).length > 0 && (
                    <div className="mt-2 pl-3 border-l-2 border-hairline">
                      <p className="text-xs font-medium text-secondary mb-1">Proficiency history</p>
                      {data.assessmentsBySkillId.get(s.id).map((a) => (
                        <p key={a.id} className="text-xs text-ink">
                          {fmtDate(a.assessed_at)} — level {a.level}
                          {a.comments ? `: ${a.comments}` : ''}
                        </p>
                      ))}
                    </div>
                  )}

                  {(data.targetsBySkillId.get(s.id) ?? []).length > 0 && (
                    <div className="mt-2 pl-3 border-l-2 border-hairline">
                      <p className="text-xs font-medium text-secondary mb-1">Targets set</p>
                      {data.targetsBySkillId.get(s.id).map((t) => (
                        <p key={t.id} className="text-xs text-ink">
                          {fmtDate(t.created_at)} — target level {t.target_level} by {fmtDate(t.target_date)}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {data.skills.length === 0 && <Empty />}
            </Section>

            <Section title={`Peer ratings you gave (${data.ratingsGiven.length})`}>
              {data.ratingsGiven.map((r) => (
                <p key={r.id} className="text-sm text-ink mb-1">
                  {fmtDate(r.rated_at)} — rated "{r.skill_name}" level {r.level}
                  {r.comments ? `: ${r.comments}` : ''}
                </p>
              ))}
              {data.ratingsGiven.length === 0 && <Empty />}
            </Section>

            <Section title={`Peer ratings you received (${data.ratingsReceived.length})`}>
              {data.ratingsReceived.map((r) => (
                <p key={r.id} className="text-sm text-ink mb-1">
                  {fmtDate(r.rated_at)} — "{r.skill_name}" rated level {r.level} by {r.rater_name || 'a connection'}
                  {r.comments ? `: ${r.comments}` : ''}
                </p>
              ))}
              {data.ratingsReceived.length === 0 && <Empty />}
            </Section>

            <Section title={`Skill validations (${data.validationsRequested.length + data.validationsGiven.length})`}>
              {data.validationsRequested.map((v) => (
                <p key={v.id} className="text-sm text-ink mb-1">
                  {fmtDate(v.created_at)} — you asked for validation at target level {v.target_level}: {v.status}
                </p>
              ))}
              {data.validationsGiven.map((v) => (
                <p key={v.id} className="text-sm text-ink mb-1">
                  {fmtDate(v.created_at)} — you validated a request for target level {v.target_level}: {v.status}
                </p>
              ))}
              {data.validationsRequested.length + data.validationsGiven.length === 0 && <Empty />}
            </Section>

            <Section title={`Connections (${data.connections.length})`}>
              {data.connections.map((c) => (
                <p key={c.id} className="text-sm text-ink mb-1">
                  Connected since {fmtDate(c.created_at)} ({c.source === 'peer_rating' ? 'via peer rating' : 'via request'})
                </p>
              ))}
              {data.connections.length === 0 && <Empty />}
            </Section>
          </>
        )}
      </main>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="bg-card border border-hairline rounded-lg p-6 print:border-0 print:p-0 print:mb-6">
      <h3 className="font-display text-lg text-ink mb-3">{title}</h3>
      {children}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <p className="text-sm text-ink mb-1">
      <span className="text-secondary">{label}: </span>
      {children}
    </p>
  )
}

function Empty() {
  return <p className="text-sm text-secondary">Nothing here.</p>
}
