import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import PlanCategoryBreakdown from './PlanCategoryBreakdown'
import { FIXTURE_CATEGORIES } from './transferPlanFixtures'

afterEach(cleanup)

describe('PlanCategoryBreakdown', () => {
  it('lists each category with both accounts\' counts', () => {
    render(<PlanCategoryBreakdown categories={FIXTURE_CATEGORIES} />)
    const skillsRow = screen.getByText('Skills').closest('tr')
    const cells = within(skillsRow).getAllByRole('cell')
    expect(cells[0]).toHaveTextContent('11')
    expect(cells[1]).toHaveTextContent('18')
  })

  it('renders an unavailable (null) count as "--" rather than "0"', () => {
    render(<PlanCategoryBreakdown categories={FIXTURE_CATEGORIES} />)
    const connectionsRow = screen.getByText('Connections').closest('tr')
    expect(within(connectionsRow).getAllByRole('cell')[0]).toHaveTextContent('0')

    const integrationsRow = screen.getByText('External integrations').closest('tr')
    expect(within(integrationsRow).getAllByRole('cell')[0]).toHaveTextContent('—')
  })
})
