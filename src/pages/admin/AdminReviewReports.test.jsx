import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lib = vi.hoisted(() => ({
  adminListCoachReviewReports: vi.fn(),
  adminResolveCoachReviewReports: vi.fn(),
}))

vi.mock('../../lib/coaching', () => lib)
vi.mock('./AdminLayout', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../context/LanguageContext', async () => {
  const { english } = await import('../../lib/i18n/translations')
  const t = (key) => key.split('.').reduce((v, part) => v?.[part], english) ?? key
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})

const { default: AdminReviewReports } = await import('./AdminReviewReports')

const report = {
  review_id: 'v1',
  rating: 1,
  comment: 'Rude and unhelpful, avoid',
  skill_name: 'Teaching',
  reviewer_label: 'Rae Learner',
  coach_label: 'Coral Coach',
  review_updated_at: '2026-11-20T10:00:00Z',
  report_count: 2,
  reasons: ['inappropriate', 'misleading'],
  details: ['We never met for most of this'],
  reporter_is_coach: true,
  first_reported_at: '2026-11-21T10:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  lib.adminListCoachReviewReports.mockResolvedValueOnce([report]).mockResolvedValue([])
  lib.adminResolveCoachReviewReports.mockResolvedValue()
})
afterEach(cleanup)

describe('AdminReviewReports', () => {
  it('shows a reported review with who wrote it, who it is about and why it was reported', async () => {
    render(<AdminReviewReports />)
    expect(await screen.findByText('Rude and unhelpful, avoid')).toBeInTheDocument()
    expect(screen.getByText('Rae Learner')).toBeInTheDocument()
    expect(screen.getByText('Coral Coach')).toBeInTheDocument()
    expect(screen.getByText('2 reports')).toBeInTheDocument()
    expect(screen.getByText('Offensive or inappropriate · Wrong or misleading')).toBeInTheDocument()
    expect(screen.getByText('“We never met for most of this”')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '1 out of 5 stars' })).toBeInTheDocument()
  })

  it('removes a review only after confirming', async () => {
    render(<AdminReviewReports />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove review' }))
    expect(lib.adminResolveCoachReviewReports).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove review' }))
    await waitFor(() => expect(lib.adminResolveCoachReviewReports).toHaveBeenCalledWith('v1', 'remove'))
    expect(await screen.findByText('The review of Coral Coach by Rae Learner was removed.')).toBeInTheDocument()
    expect(screen.getByText('No open reports.')).toBeInTheDocument()
  })

  it('dismisses reports', async () => {
    render(<AdminReviewReports />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss reports' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Dismiss reports' }))
    await waitFor(() => expect(lib.adminResolveCoachReviewReports).toHaveBeenCalledWith('v1', 'dismiss'))
  })

  it('shows what the review said when reported, if it has changed since', async () => {
    lib.adminListCoachReviewReports.mockReset()
    lib.adminListCoachReviewReports.mockResolvedValue([{ ...report, comment: 'Toned down', rating: 3, changed_since_reported: true, reported_comment: 'Rude and unhelpful, avoid', reported_rating: 1 }])
    render(<AdminReviewReports />)
    expect(await screen.findByText('Toned down')).toBeInTheDocument()
    expect(screen.getByText(/Changed since it was reported/)).toBeInTheDocument()
    expect(screen.getByText('Rude and unhelpful, avoid')).toBeInTheDocument()
  })
})
