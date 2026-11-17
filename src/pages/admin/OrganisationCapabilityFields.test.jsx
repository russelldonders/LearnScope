import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OrganisationCapabilityFields from './OrganisationCapabilityFields'
import { toggleCapability } from '../../lib/organisationCapabilities'

afterEach(cleanup)

describe('toggleCapability', () => {
  it('turns on the prerequisite along with a dependent capability', () => {
    expect(toggleCapability([], 'manages_workforce_development', true))
      .toEqual(['employs_people', 'manages_workforce_development'])
    expect(toggleCapability([], 'supplies_learning_externally', true))
      .toEqual(['authors_learning', 'supplies_learning_externally'])
  })

  it('turns off dependents along with their prerequisite', () => {
    expect(toggleCapability(['employs_people', 'manages_workforce_development', 'authors_learning'], 'employs_people', false))
      .toEqual(['authors_learning'])
  })

  it('leaves the prerequisite on when only the dependent is turned off', () => {
    expect(toggleCapability(['employs_people', 'manages_workforce_development'], 'manages_workforce_development', false))
      .toEqual(['employs_people'])
  })
})

describe('OrganisationCapabilityFields', () => {
  it('explains what each capability switches on', () => {
    render(<OrganisationCapabilityFields idPrefix="t" value={[]} onChange={() => {}} />)
    const employs = screen.getByRole('checkbox', { name: 'Employs people' })
    expect(employs).toHaveAccessibleDescription(/Role profiles section in the organisation workspace/)
    expect(screen.getByRole('checkbox', { name: 'Authors learning' }))
      .toHaveAccessibleDescription(/Doesn’t switch anything on or off yet/)
  })

  it('reports the combined selection when a dependent capability is ticked', () => {
    const onChange = vi.fn()
    render(<OrganisationCapabilityFields idPrefix="t" value={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Develops its workforce' }))
    expect(onChange).toHaveBeenCalledWith(['employs_people', 'manages_workforce_development'])
  })

  it('warns when turning off "Employs people" on an organisation that had it', () => {
    render(
      <OrganisationCapabilityFields idPrefix="t" value={[]} initialValue={['employs_people']} onChange={() => {}} />
    )
    expect(screen.getByRole('status')).toHaveTextContent('Existing role profiles and assignments are kept')
  })

  it("doesn't warn for a new organisation", () => {
    render(<OrganisationCapabilityFields idPrefix="t" value={[]} onChange={() => {}} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
