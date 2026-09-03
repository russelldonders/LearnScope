import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PlanConflictResolutionList from './PlanConflictResolutionList'
import { FIXTURE_CONFLICTS_RESOLVED, FIXTURE_CONFLICTS_UNRESOLVED } from './transferPlanFixtures'

afterEach(cleanup)

describe('PlanConflictResolutionList', () => {
  it('lists each conflict with its options and flags unresolved ones', () => {
    render(<PlanConflictResolutionList conflicts={FIXTURE_CONFLICTS_UNRESOLVED} />)
    expect(screen.getByText('Conflicts to resolve (3)')).toBeInTheDocument()
    expect(screen.getAllByText('Not yet resolved.')).toHaveLength(3)
    expect(screen.getByRole('radio', { name: "Keep the durable account's level (Skilled)" })).not.toBeChecked()
  })

  it('reflects the current resolution purely from props', () => {
    render(<PlanConflictResolutionList conflicts={FIXTURE_CONFLICTS_RESOLVED} />)
    expect(screen.queryByText('Not yet resolved.')).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: "Keep the durable account's level (Skilled)" })).toBeChecked()
  })

  it('shows an empty state when there are no conflicts', () => {
    render(<PlanConflictResolutionList conflicts={[]} />)
    expect(screen.getByText('No conflicts were detected between these accounts.')).toBeInTheDocument()
  })

  it('calls onSelectResolution with the conflict id and chosen value', () => {
    const onSelectResolution = vi.fn()
    render(<PlanConflictResolutionList conflicts={FIXTURE_CONFLICTS_UNRESOLVED} onSelectResolution={onSelectResolution} />)
    fireEvent.click(screen.getByRole('radio', { name: "Keep the source account's level (Capable)" }))
    expect(onSelectResolution).toHaveBeenCalledWith('conflict-1', 'keep_source')
  })

  it('locks every radio and explains why when readOnly', () => {
    render(<PlanConflictResolutionList conflicts={FIXTURE_CONFLICTS_RESOLVED} readOnly />)
    expect(screen.getByText(/Resolutions are locked while your approval is on file/)).toBeInTheDocument()
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled()
    }
  })

  it('renders an inline error', () => {
    render(<PlanConflictResolutionList conflicts={[]} error="Couldn't save that resolution." />)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't save that resolution.")
  })
})
