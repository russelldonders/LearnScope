import EmployerConsole from '../employer/EmployerConsole'

// One workspace entry point, with the existing workforce and learning-content
// consoles retained as capability views. The URL identifies the organisation
// context; it no longer identifies a different product.
export default function OrganisationWorkspace() {
  return <EmployerConsole />
}
