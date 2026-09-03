import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AccountProfileSummaryCard from './AccountProfileSummaryCard'
import { FIXTURE_ACCOUNT_A, FIXTURE_ACCOUNT_B } from './transferFixtures'

afterEach(cleanup)

describe('AccountProfileSummaryCard', () => {
  it('shows the email, account type, and every count', () => {
    render(<AccountProfileSummaryCard account={FIXTURE_ACCOUNT_A} />)
    expect(screen.getByText(FIXTURE_ACCOUNT_A.email)).toBeInTheDocument()
    expect(screen.getByText('Personal account')).toBeInTheDocument()
    expect(screen.getByText('Skills').nextElementSibling).toHaveTextContent('18')
    expect(screen.getByText('Connections').nextElementSibling).toHaveTextContent('9')
  })

  it('renders an unavailable (null) count as "--" rather than "0"', () => {
    render(<AccountProfileSummaryCard account={FIXTURE_ACCOUNT_B} />)
    // Confirmed zero connections renders as 0, not a dash.
    expect(screen.getByText('Connections').nextElementSibling).toHaveTextContent('0')
    // Unavailable integrations count renders as a dash instead.
    expect(screen.getByText('External integrations').nextElementSibling).toHaveTextContent('—')
  })

  it('shows a partial-data error when the account has one', () => {
    render(<AccountProfileSummaryCard account={FIXTURE_ACCOUNT_B} />)
    expect(screen.getByText(FIXTURE_ACCOUNT_B.countsError)).toBeInTheDocument()
  })

  it('renders no error text when the account has none', () => {
    render(<AccountProfileSummaryCard account={FIXTURE_ACCOUNT_A} />)
    expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument()
  })

  it('calls onSelect with no arguments', () => {
    const onSelect = vi.fn()
    render(<AccountProfileSummaryCard account={FIXTURE_ACCOUNT_A} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select as durable profile' }))
    expect(onSelect).toHaveBeenCalledWith()
  })

  it('reflects the selected state via aria-pressed and label, purely from the selected prop', () => {
    const { rerender } = render(<AccountProfileSummaryCard account={FIXTURE_ACCOUNT_A} selected={false} />)
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false')

    rerender(<AccountProfileSummaryCard account={FIXTURE_ACCOUNT_A} selected />)
    expect(screen.getByRole('button', { name: 'Selected as durable profile' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })
})
