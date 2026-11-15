import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getAiUsageDashboard: vi.fn() }))

vi.mock('./AdminLayout', () => ({ default: ({ children }) => <main>{children}</main> }))
vi.mock('../../lib/admin/aiUsage', () => ({ getAiUsageDashboard: mocks.getAiUsageDashboard }))

import AdminAiUsage from './AdminAiUsage'

const dashboard = {
  totals: {
    requests: 2,
    errors: 1,
    estimatedCostMicroUsd: 12_500,
    totalTokens: 2400,
    averageDurationMs: 1250,
  },
  byFeature: [{
    feature: 'course_draft_generation', requests: 2, errors: 1, tokens: 2400,
    estimatedCostMicroUsd: 12_500, averageDurationMs: 1250,
  }],
  byModel: [{ model: 'claude-haiku-4-5-20251001', requests: 2, tokens: 2400, estimatedCostMicroUsd: 12_500 }],
  byOrganisation: [{ organisationId: 'org-1', organisationName: 'Acme Learning', requests: 2, tokens: 2400, estimatedCostMicroUsd: 12_500 }],
  recentErrors: [{ occurredAt: '2026-11-15T09:00:00Z', feature: 'course_draft_generation', errorCode: '429', requestId: 'req_1' }],
}

describe('AdminAiUsage', () => {
  beforeEach(() => {
    mocks.getAiUsageDashboard.mockReset().mockResolvedValue(dashboard)
  })

  afterEach(cleanup)

  it('shows feature, model, organisation, cost and error attribution', async () => {
    render(<AdminAiUsage />)

    expect(await screen.findByText('Course builder')).toBeInTheDocument()
    expect(screen.getByText('claude-haiku-4-5-20251001')).toBeInTheDocument()
    expect(screen.getByText('Acme Learning')).toBeInTheDocument()
    expect(screen.getAllByText('$0.01').length).toBeGreaterThan(0)
    expect(screen.getByText(/429/)).toBeInTheDocument()
    expect(screen.getByText(/Prompts and generated content are not stored/)).toBeInTheDocument()
  })

  it('reloads the aggregate for a selected range', async () => {
    render(<AdminAiUsage />)
    await screen.findByText('Course builder')

    fireEvent.click(screen.getByRole('button', { name: '7 days' }))
    await waitFor(() => expect(mocks.getAiUsageDashboard).toHaveBeenLastCalledWith(7))
  })
})
