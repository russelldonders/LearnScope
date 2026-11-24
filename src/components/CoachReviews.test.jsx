import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
    return typeof value === 'string' && params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en-GB', setLanguage: vi.fn(), t }) }
})
vi.mock('../lib/coaching', async (importOriginal) => ({
  ...(await importOriginal()),
  saveCoachReview: vi.fn().mockResolvedValue(),
  deleteCoachReview: vi.fn().mockResolvedValue(),
  listCoachReviews: vi.fn(),
  reportCoachReview: vi.fn().mockResolvedValue(),
}))

const coaching = await import('../lib/coaching')
const { CoachReviewList, MyCoachReview, RatingSummary } = await import('./CoachReviews')

const relationship = { id: 'r1', other_name: 'Coral' }

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('MyCoachReview', () => {
  it('offers nothing before a session has been marked done', () => {
    const { container } = render(<MyCoachReview relationship={relationship} review={null} canReview={false} onChange={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('writes a named review, saying so before it is saved', async () => {
    const onChange = vi.fn().mockResolvedValue()
    render(<MyCoachReview relationship={relationship} review={null} canReview onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review Coral as a coach' }))
    expect(screen.getByText(/shown with your name and picture/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save review' })).toBeDisabled()

    fireEvent.click(screen.getByLabelText('4 stars'))
    fireEvent.change(screen.getByLabelText('What was it like? (optional)'), { target: { value: 'Clear and kind' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save review' }))
    await waitFor(() => expect(coaching.saveCoachReview).toHaveBeenCalledWith('r1', 4, 'Clear and kind'))
    expect(onChange).toHaveBeenCalled()
  })

  it('shows the learner their review, to change or delete after confirming', async () => {
    render(<MyCoachReview relationship={relationship} review={{ rating: 5, comment: 'Brilliant' }} canReview onChange={vi.fn().mockResolvedValue()} />)
    expect(screen.getByText('Brilliant')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '5 out of 5 stars' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(screen.getByLabelText('5 stars')).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(coaching.deleteCoachReview).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(coaching.deleteCoachReview).toHaveBeenCalledWith('r1'))
  })
})

describe('CoachReviewList', () => {
  it('lists reviews under the reviewer\'s name', async () => {
    coaching.listCoachReviews.mockResolvedValue([
      { id: 'v1', rating: 4, comment: 'Clear and kind', reviewer_name: 'Rae Learner', reviewer_avatar_url: null, updated_at: '2026-11-20T10:00:00Z' },
    ])
    render(<CoachReviewList coachId="coach" librarySkillId="lib" />)
    expect(await screen.findByText('Rae Learner')).toBeInTheDocument()
    expect(screen.getByText('Clear and kind')).toBeInTheDocument()
    expect(coaching.listCoachReviews).toHaveBeenCalledWith('coach', 'lib')
  })

  it('says when there are none, if asked to', async () => {
    coaching.listCoachReviews.mockResolvedValue([])
    render(<CoachReviewList coachId="coach" librarySkillId="lib" emptyText="No reviews yet." />)
    expect(await screen.findByText('No reviews yet.')).toBeInTheDocument()
  })
})

describe('RatingSummary', () => {
  it('shows the average and how many reviews', () => {
    render(<RatingSummary average="4.5" count={2} />)
    expect(screen.getByText('4.5 · 2 reviews')).toBeInTheDocument()
  })
})

describe('reporting and removed reviews', () => {
  const review = (fields) => ({ id: 'v1', rating: 1, comment: 'Avoid', reviewer_name: 'Rae', reviewer_avatar_url: null, updated_at: '2026-11-20T10:00:00Z', is_mine: false, reported_by_me: false, ...fields })

  it('reports a review by someone else with a reason, then says it was reported', async () => {
    coaching.listCoachReviews.mockResolvedValue([review()])
    render(<CoachReviewList coachId="coach" librarySkillId="lib" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Report' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a reason.')
    fireEvent.click(screen.getByLabelText('Offensive or inappropriate'))
    fireEvent.change(screen.getByLabelText('Anything else moderators should know? (optional)'), { target: { value: 'Personal attack' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }))
    await waitFor(() => expect(coaching.reportCoachReview).toHaveBeenCalledWith('v1', 'inappropriate', 'Personal attack'))
    expect(await screen.findByText(/^Reported./)).toBeInTheDocument()
  })

  it('offers no report on your own review, and shows one already reported', async () => {
    coaching.listCoachReviews.mockResolvedValue([review({ is_mine: true }), review({ id: 'v2', reported_by_me: true })])
    render(<CoachReviewList coachId="coach" librarySkillId="lib" />)
    expect(await screen.findByText(/^Reported./)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Report' })).not.toBeInTheDocument()
  })

  it('tells the writer moderators removed their review, which they can delete but not change', () => {
    render(<MyCoachReview relationship={relationship} review={{ rating: 1, comment: 'Avoid', moderation_removed_at: '2026-11-22T10:00:00Z' }} canReview onChange={vi.fn()} />)
    expect(screen.getByText(/Removed by LearnScope moderators/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('says coaching whose review moderators removed cannot be reviewed again', () => {
    render(<MyCoachReview relationship={{ ...relationship, review_removed: true }} review={null} canReview onChange={vi.fn()} />)
    expect(screen.getByText(/can.t be reviewed again/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review Coral as a coach' })).not.toBeInTheDocument()
  })
})
