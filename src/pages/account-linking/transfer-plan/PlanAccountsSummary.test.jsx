import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PlanAccountsSummary from './PlanAccountsSummary'
import { FIXTURE_DURABLE_ACCOUNT, FIXTURE_SOURCE_ACCOUNT } from './transferPlanFixtures'

vi.mock('../../../context/LanguageContext', () => import('../../../test/languageMock'))

afterEach(cleanup)

describe('PlanAccountsSummary', () => {
  it('shows both accounts labelled by role', () => {
    render(<PlanAccountsSummary sourceAccount={FIXTURE_SOURCE_ACCOUNT} durableAccount={FIXTURE_DURABLE_ACCOUNT} />)
    expect(screen.getByText('Durable account')).toBeInTheDocument()
    expect(screen.getByText(FIXTURE_DURABLE_ACCOUNT.email)).toBeInTheDocument()
    expect(screen.getByText(FIXTURE_DURABLE_ACCOUNT.accountType)).toBeInTheDocument()

    expect(screen.getByText('Source account')).toBeInTheDocument()
    expect(screen.getByText(FIXTURE_SOURCE_ACCOUNT.email)).toBeInTheDocument()
    expect(screen.getByText(FIXTURE_SOURCE_ACCOUNT.accountType)).toBeInTheDocument()
  })

  it('states nothing moves until the plan is approved and executed', () => {
    render(<PlanAccountsSummary sourceAccount={FIXTURE_SOURCE_ACCOUNT} durableAccount={FIXTURE_DURABLE_ACCOUNT} />)
    expect(screen.getByText(/Nothing moves until this plan is approved/)).toBeInTheDocument()
  })
})
