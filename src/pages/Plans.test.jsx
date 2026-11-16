import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lib = vi.hoisted(() => ({ listPlans: vi.fn(), loadPlanContext: vi.fn(), createPlan: vi.fn() }))

vi.mock('../lib/learnerPlans', () => lib)
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }))
vi.mock('../components/AppHeader', () => ({ default: () => <header>Header</header> }))
vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
    return params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})

const { default: Plans } = await import('./Plans')

const emptyContext = { latestTargetBySkill: new Map(), goalsById: new Map(), replacedBy: new Map(), goalProgressById: new Map(), today: '2026-11-16' }

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/plans']}>
      <Routes>
        <Route path="/plans" element={<Plans />} />
        <Route path="/plans/:planId" element={<p>Plan page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  lib.listPlans.mockResolvedValue([])
  lib.loadPlanContext.mockResolvedValue(emptyContext)
  lib.createPlan.mockResolvedValue('plan-1')
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Plans', () => {
  it('invites the learner to create a first plan', async () => {
    renderPage()
    expect(await screen.findByText(/No plans yet/)).toBeInTheDocument()
  })

  it('lists plans with their progress worked out from their items', async () => {
    lib.listPlans.mockResolvedValue([
      {
        id: 'p1', title: 'Become a team lead', status: 'active', starts_on: '2026-11-01', target_on: '2026-12-01',
        items: [
          { id: 'i1', item_type: 'step', completed_on: '2026-11-10' },
          { id: 'i2', item_type: 'step', completed_on: null },
        ],
      },
      { id: 'p2', title: 'Old plan', status: 'archived', items: [] },
      { id: 'p3', title: 'Next year', status: 'planning', items: [] },
    ])
    renderPage()
    // Grouped by where each plan is; one still being prepared shows no progress yet.
    expect(await screen.findByRole('heading', { name: 'In use' })).toBeInTheDocument()
    const preparing = screen.getByRole('region', { name: 'Being prepared' })
    expect(preparing).toHaveTextContent('Next year')
    expect(preparing.querySelector('[role="progressbar"]')).toBeNull()
    expect(await screen.findByRole('link', { name: /Become a team lead/ })).toHaveAttribute('href', '/plans/p1')
    expect(await screen.findByText('1 of 2 done')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Progress on Become a team lead' })).toHaveAttribute('aria-valuenow', '50')
    // Archived plans stay out of the way until asked for.
    expect(screen.queryByText('Old plan')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show archived plans (1)' }))
    expect(screen.getByText('Old plan')).toBeInTheDocument()
  })

  it('creates a plan and opens it', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'New plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create plan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Give your plan a title.')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Learn Spanish' } })
    fireEvent.change(screen.getByLabelText('Start date (optional)'), { target: { value: '2026-12-01' } })
    fireEvent.change(screen.getByLabelText('Target date (optional)'), { target: { value: '2026-11-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create plan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('can’t be before the start date')
    fireEvent.change(screen.getByLabelText('Target date (optional)'), { target: { value: '2027-06-30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create plan' }))
    await waitFor(() => expect(lib.createPlan).toHaveBeenCalledWith('me', expect.objectContaining({ title: 'Learn Spanish', startsOn: '2026-12-01', targetOn: '2027-06-30' })))
    expect(await screen.findByText('Plan page')).toBeInTheDocument()
  })
})
