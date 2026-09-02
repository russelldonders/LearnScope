import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getSharedProfile } from '../lib/profileShareLinks'
import { formatMonthYear } from '../lib/dates'
import { LEVEL_LABELS } from '../lib/levels'
import { experienceTypeLabel } from '../lib/experienceTypes'
import GrowthRing from '../components/GrowthRing'
import OrganizationLogo from '../components/OrganizationLogo'

// Public, read-only view of a learner's proactively-generated share link
// (/shared/:token -> get_shared_profile RPC, 20260902300000_profile_share_
// links.sql). No auth guard -- reachable by a logged-out visitor, same as
// Rate.jsx/Recommend.jsx's token routes -- and deliberately no AppHeader/nav
// chrome, since the visitor may not be a LearnScope user at all.
export default function SharedProfile() {
  const { token } = useParams()
  const [profile, setProfile] = useState(undefined)

  useEffect(() => {
    getSharedProfile(token)
      .then(setProfile)
      .catch(() => setProfile(null))
  }, [token])

  return (
    <div className="min-h-screen bg-paper px-4 py-10">
      <div className="w-full max-w-2xl mx-auto">
        <Link to="/" className="font-display text-2xl text-ink mb-8 block">
          LearnScope
        </Link>

        {profile === undefined ? (
          <p className="text-sm text-secondary">Loading…</p>
        ) : profile === null ? (
          <div className="bg-card border border-hairline rounded-lg p-8 text-center">
            <p className="text-ink">This link is invalid or has expired.</p>
          </div>
        ) : (
          <>
            <div className="bg-card border border-hairline rounded-lg p-6 mb-6">
              <h1 className="font-display text-2xl text-ink">{profile.owner_name || 'A LearnScope learner'}</h1>
              {profile.label && <p className="text-sm text-secondary mt-1">{profile.label}</p>}
            </div>

            {profile.skills?.length > 0 && (
              <div className="mb-8">
                <h2 className="font-display text-xl text-ink mb-4">Skills</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {profile.skills.map((skill) => (
                    <div
                      key={skill.id}
                      className="bg-card border border-hairline rounded-lg p-4 flex gap-4 items-center"
                    >
                      <GrowthRing level={skill.level} size={48} />
                      <div className="min-w-0">
                        <h3 className="font-display text-lg text-ink truncate">{skill.name}</h3>
                        <p className="text-xs text-secondary">
                          {skill.category}
                          {skill.category && skill.level ? ' · ' : ''}
                          {skill.level ? LEVEL_LABELS[skill.level] : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {profile.experience?.length > 0 && (
              <div>
                <h2 className="font-display text-xl text-ink mb-4">Experience</h2>
                <div className="space-y-3">
                  {profile.experience.map((item) => (
                    <div key={item.id} className="bg-card border border-hairline rounded-lg p-4">
                      <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">
                        {experienceTypeLabel(item)}
                      </span>
                      <h3 className="font-display text-lg text-ink">{item.title}</h3>
                      {item.organization && (
                        <div className="flex items-center gap-2 mt-0.5">
                          {item.organization_url && (
                            <OrganizationLogo organizationUrl={item.organization_url} size={20} />
                          )}
                          <p className="text-sm text-secondary">{item.organization}</p>
                        </div>
                      )}
                      <p className="font-mono text-xs text-secondary mt-2">
                        {formatMonthYear(item.start_date)} – {item.end_date ? formatMonthYear(item.end_date) : 'Present'}
                      </p>
                      {item.description && (
                        <p className="text-sm text-ink mt-2 whitespace-pre-line">{item.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!profile.skills?.length && !profile.experience?.length && (
              <div className="bg-card border border-hairline rounded-lg p-8 text-center">
                <p className="text-secondary">Nothing has been shared on this link yet.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
