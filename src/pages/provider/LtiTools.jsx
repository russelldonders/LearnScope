import { Link, useParams } from 'react-router-dom'
import AppHeader from '../../components/AppHeader'
import { useAuth } from '../../context/AuthContext'
import ProviderLtiToolsSection from '../../components/ProviderLtiToolsSection'

// Moved out from a top-level Provider console tab into a cog-menu
// destination (OrganisationSettingsModal's "LTI tools" link) -- same
// admin-only, per-organisation shape as LmsConnectionsPage (LtiConfiguration.jsx)
// right next to it in that same settings dialog.
export default function LtiToolsPage() {
  const { organisationId } = useParams()
  const { user, organisationMemberships } = useAuth()
  const allowed = organisationMemberships?.some((m) => m.organisation_id === organisationId && m.role === 'admin')
  return (
    <div className="min-h-screen bg-paper">
      <AppHeader hideNavLinks />
      <main id="main-content" tabIndex={-1} className="max-w-5xl mx-auto px-4 py-8">
        <Link to={`/provider?org=${organisationId}`} className="inline-block text-sm text-moss hover:underline mb-5">
          Back to provider
        </Link>
        {allowed ? (
          <ProviderLtiToolsSection key={organisationId} organisationId={organisationId} userId={user.id} />
        ) : (
          <p role="alert" className="text-sm text-secondary">
            Only an administrator of this provider can manage LTI tools.
          </p>
        )}
      </main>
    </div>
  )
}
