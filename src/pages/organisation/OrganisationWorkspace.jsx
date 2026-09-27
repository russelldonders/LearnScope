import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import EmployerConsole from '../employer/EmployerConsole'
import ProviderConsole from '../provider/ProviderConsole'

// One workspace entry point, with the existing workforce and learning-content
// consoles retained as capability views. The URL identifies the organisation
// context; it no longer identifies a different product.
export default function OrganisationWorkspace() {
  const { employerMemberships } = useAuth()
  const [searchParams] = useSearchParams()
  const requestedEmployer = searchParams.get('employer')
  const requestedOrganisation = searchParams.get('org')
  const employerAdminIds = (employerMemberships ?? [])
    .filter((membership) => membership.role === 'admin')
    .map((membership) => membership.employer_id)

  if (
    (requestedEmployer && employerAdminIds.includes(requestedEmployer))
    || (!requestedOrganisation && employerAdminIds.length > 0)
  ) {
    return <EmployerConsole />
  }

  return <ProviderConsole />
}
