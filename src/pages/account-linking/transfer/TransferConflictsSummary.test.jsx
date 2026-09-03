import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import TransferConflictsSummary from './TransferConflictsSummary'
import { FIXTURE_CONFLICTS, FIXTURE_NO_CONFLICTS } from './transferFixtures'

afterEach(cleanup)

describe('TransferConflictsSummary', () => {
  it('lists same-name skills with both accounts\' levels', () => {
    render(<TransferConflictsSummary conflicts={FIXTURE_CONFLICTS} />)
    expect(screen.getByText('Same-name skills (2)')).toBeInTheDocument()
    expect(screen.getByText(/Facilitation -- Skilled on one account, Capable on the other/)).toBeInTheDocument()
  })

  it('lists overlapping courses', () => {
    render(<TransferConflictsSummary conflicts={FIXTURE_CONFLICTS} />)
    expect(screen.getByText('Overlapping courses (1)')).toBeInTheDocument()
    expect(screen.getByText('De-escalation fundamentals')).toBeInTheDocument()
  })

  it('lists possible duplicate experience pairs', () => {
    render(<TransferConflictsSummary conflicts={FIXTURE_CONFLICTS} />)
    expect(screen.getByText('Possible duplicate experience (1)')).toBeInTheDocument()
    expect(screen.getByText(/Senior Support Engineer at Acme Corp/)).toBeInTheDocument()
  })

  it('shows an independent empty state per category when there are no conflicts', () => {
    render(<TransferConflictsSummary conflicts={FIXTURE_NO_CONFLICTS} />)
    expect(screen.getByText('No same-name skills between these accounts.')).toBeInTheDocument()
    expect(screen.getByText('No overlapping courses between these accounts.')).toBeInTheDocument()
    expect(screen.getByText('No likely duplicate experience entries found.')).toBeInTheDocument()
  })

  it('states this view is informational only', () => {
    render(<TransferConflictsSummary conflicts={FIXTURE_NO_CONFLICTS} />)
    expect(screen.getByText(/Nothing here is changed, resolved, or merged/)).toBeInTheDocument()
  })
})
