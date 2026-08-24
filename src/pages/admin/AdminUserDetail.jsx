import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import { getUserProfile } from '../../lib/admin/users'
import { formatMonthYear } from '../../lib/dates'

const EXPERIENCE_TYPE_LABELS = { employment: 'Employment', education: 'Education' }

// Read-only "everything connected to this account" view for a platform
// admin -- name, org roles (including pending invites), skills, courses,
// experience and connections, in one place. Deliberately service-role/RLS-
// bypassing via getUserProfile rather than the client-side query
// SkillsProfile.jsx uses, since that page only shows what the *viewed* user
// has opted into sharing with others -- an admin needs the whole record.
export default function AdminUserDetail() {
  const { userId } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    getUserProfile(userId)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [userId])

  const name = data ? [data.profile.firstName, data.profile.lastName].filter(Boolean).join(' ') : ''

  return (
    <AdminLayout>
      <div className="space-y-6">
        <Link to="/admin" className="text-sm text-moss font-medium">
          ← Back to users
        </Link>

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : error ? (
          <p className="text-sm text-red-700">{error}</p>
        ) : (
          <>
            <div className="bg-card border border-hairline rounded-lg p-6">
              <h2 className="font-display text-xl text-ink mb-1">{name || '(no name set)'}</h2>
              <p className="text-sm text-secondary mb-3">{data.profile.email}</p>
              <div className="flex flex-wrap gap-2 text-xs">
                <span
                  className={`font-mono uppercase tracking-wide rounded-full px-2 py-0.5 border ${
                    data.profile.accountStatus === 'blocked'
                      ? 'border-red-300 text-red-700'
                      : 'border-hairline text-secondary'
                  }`}
                >
                  {data.profile.accountStatus}
                </span>
                {data.isPlatformAdmin && (
                  <span className="font-mono uppercase tracking-wide rounded-full px-2 py-0.5 border border-hairline text-secondary">
                    Platform admin
                  </span>
                )}
                {data.organisationMemberships.map((m, i) => (
                  <span
                    key={i}
                    className="font-mono uppercase tracking-wide rounded-full px-2 py-0.5 border border-hairline text-secondary"
                  >
                    {m.organisationName} · {m.role}
                    {m.status === 'pending' ? ' · pending' : ''}
                  </span>
                ))}
              </div>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs text-secondary">
                {data.profile.location && (
                  <div>
                    <dt className="uppercase tracking-wide">Location</dt>
                    <dd className="text-ink">{data.profile.location}</dd>
                  </div>
                )}
                {data.profile.country && (
                  <div>
                    <dt className="uppercase tracking-wide">Country</dt>
                    <dd className="text-ink">{data.profile.country}</dd>
                  </div>
                )}
                <div>
                  <dt className="uppercase tracking-wide">Joined</dt>
                  <dd className="text-ink">{new Date(data.profile.createdAt).toLocaleDateString()}</dd>
                </div>
                <div>
                  <dt className="uppercase tracking-wide">Last sign-in</dt>
                  <dd className="text-ink">
                    {data.profile.lastSignInAt ? new Date(data.profile.lastSignInAt).toLocaleDateString() : '—'}
                  </dd>
                </div>
              </dl>
            </div>

            <Section title={`Skills (${data.skills.length})`}>
              {data.skills.length === 0 ? (
                <EmptyRow />
              ) : (
                <ul className="divide-y divide-hairline">
                  {data.skills.map((s) => (
                    <li key={s.id} className="px-4 py-2 text-sm flex items-center justify-between gap-2">
                      <span className="text-ink">{s.name}</span>
                      <span className="text-secondary text-xs">
                        {[s.category, `Level ${s.level}`].filter(Boolean).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={`Courses (${data.courses.length})`}>
              {data.courses.length === 0 ? (
                <EmptyRow />
              ) : (
                <ul className="divide-y divide-hairline">
                  {data.courses.map((c) => (
                    <li key={c.id} className="px-4 py-2 text-sm flex items-center justify-between gap-2">
                      <span className="text-ink">
                        {c.name}
                        {c.provider ? ` — ${c.provider}` : ''}
                      </span>
                      <span className="text-secondary text-xs">
                        {c.completed_date ? formatMonthYear(c.completed_date) : 'In progress'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={`Experience (${data.experience.length})`}>
              {data.experience.length === 0 ? (
                <EmptyRow />
              ) : (
                <ul className="divide-y divide-hairline">
                  {data.experience.map((e) => (
                    <li key={e.id} className="px-4 py-2 text-sm flex items-center justify-between gap-2">
                      <span className="text-ink">
                        {e.title} — {e.organization}
                      </span>
                      <span className="text-secondary text-xs">
                        {EXPERIENCE_TYPE_LABELS[e.type] ?? e.type} · {formatMonthYear(e.start_date)} –{' '}
                        {e.end_date ? formatMonthYear(e.end_date) : 'Present'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={`Connections (${data.connections.length})`}>
              {data.connections.length === 0 ? (
                <EmptyRow />
              ) : (
                <ul className="divide-y divide-hairline">
                  {data.connections.map((c) => (
                    <li key={c.id} className="px-4 py-2 text-sm text-ink">
                      {c.name || '(no name set)'}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </>
        )}
      </div>
    </AdminLayout>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <h3 className="font-display text-lg text-ink mb-2">{title}</h3>
      <div className="bg-card border border-hairline rounded-lg overflow-hidden">{children}</div>
    </div>
  )
}

function EmptyRow() {
  return <p className="px-4 py-6 text-center text-sm text-secondary">Nothing here.</p>
}
