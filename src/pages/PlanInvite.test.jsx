import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lib = vi.hoisted(() => ({ getPlanInvitePreview: vi.fn(), acceptPlanInvite: vi.fn() }))
const auth = vi.hoisted(() => ({ user: null }))
vi.mock('../lib/learnerPlans', () => lib)
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: auth.user, loading: false }) }))
vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
    return params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})

const { default: PlanInvite } = await import('./PlanInvite')
const { getPendingInviteCode, pendingInvitePath } = await import('../lib/connections')

const openPreview = {
  kind: 'link', status: 'open', plan_title: 'Learn to present', plan_description: 'Six weeks',
  item_count: 2, inviter_name: 'Ada Owner', joined_plan_id: null,
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/plan-invite/abc123']}>
      <Routes>
        <Route path="/plan-invite/:code" element={<PlanInvite />} />
        <Route path="/plans/:planId" element={<p>The plan</p>} />
        <Route path="/signup" element={<p>Sign up page</p>} />
        <Route path="/login" element={<p>Log in page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  auth.user = null
  localStorage.clear()
  lib.getPlanInvitePreview.mockResolvedValue(openPreview)
  lib.acceptPlanInvite.mockResolvedValue('p-1')
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PlanInvite', () => {
  it('shows a signed-out visitor the plan and sends them to sign up, then back here', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Learn to present' })).toBeInTheDocument()
    expect(screen.getByText('Ada Owner has shared a plan with you')).toBeInTheDocument()
    expect(screen.getByText(/Its owners will see how many of its items you’ve done/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign up to join' }))
    expect(await screen.findByText('Sign up page')).toBeInTheDocument()
    expect(pendingInvitePath(getPendingInviteCode())).toBe('/plan-invite/abc123')
  })

  it('lets a signed-in visitor join and opens the plan', async () => {
    auth.user = { id: 'me' }
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Join the plan' }))
    await waitFor(() => expect(lib.acceptPlanInvite).toHaveBeenCalledWith('abc123'))
    expect(await screen.findByText('The plan')).toBeInTheDocument()
  })

  it('shows why joining failed', async () => {
    auth.user = { id: 'me' }
    lib.acceptPlanInvite.mockRejectedValue(new Error('This link has been replaced and no longer works'))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Join the plan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This link has been replaced')
  })

  it('points someone who already follows it to the plan', async () => {
    auth.user = { id: 'me' }
    lib.getPlanInvitePreview.mockResolvedValue({ ...openPreview, status: 'joined', joined_plan_id: 'p-9' })
    renderPage()
    expect(await screen.findByRole('link', { name: 'Open the plan' })).toHaveAttribute('href', '/plans/p-9')
    expect(screen.queryByRole('button', { name: 'Join the plan' })).not.toBeInTheDocument()
  })

  it('says when an emailed invitation has been used or a link replaced', async () => {
    lib.getPlanInvitePreview.mockResolvedValue({ ...openPreview, kind: 'email', status: 'used' })
    renderPage()
    expect(await screen.findByText(/This invitation has already been used/)).toBeInTheDocument()
    cleanup()
    lib.getPlanInvitePreview.mockResolvedValue({ ...openPreview, status: 'revoked' })
    renderPage()
    expect(await screen.findByText(/This link has been replaced/)).toBeInTheDocument()
  })

  it('says when the link is not valid', async () => {
    lib.getPlanInvitePreview.mockResolvedValue(null)
    renderPage()
    expect(await screen.findByText('This invitation link isn’t valid.')).toBeInTheDocument()
  })
})

describe('pendingInvitePath', () => {
  it('sends plan invitation codes to the plan invitation page and others to the skill invite page', () => {
    expect(pendingInvitePath('plan:abc')).toBe('/plan-invite/abc')
    expect(pendingInvitePath('abc')).toBe('/rate/abc')
  })
})
