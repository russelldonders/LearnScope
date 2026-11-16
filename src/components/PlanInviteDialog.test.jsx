import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lib = vi.hoisted(() => ({
  getPlanShareLink: vi.fn(),
  replacePlanShareLink: vi.fn(),
  inviteEmailsToPlan: vi.fn(),
}))
vi.mock('../lib/learnerPlans', () => lib)

const { english } = await import('../lib/i18n/translations')
const t = (key, params) => {
  const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
  return params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
}
const { default: PlanInviteDialog } = await import('./PlanInviteDialog')

const LINK = 'http://localhost/plan-invite/abc123'

function renderDialog(props = {}) {
  const handlers = { onClose: vi.fn(), onInvite: vi.fn(), onInvited: vi.fn() }
  render(
    <PlanInviteDialog
      planId="p1"
      planTitle="Learn to present"
      connections={[]}
      invitations={[]}
      busy={false}
      error={null}
      t={t}
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

beforeEach(() => {
  lib.getPlanShareLink.mockResolvedValue(LINK)
  lib.replacePlanShareLink.mockResolvedValue('http://localhost/plan-invite/new456')
  lib.inviteEmailsToPlan.mockResolvedValue([])
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PlanInviteDialog', () => {
  it('shows the plan’s share link with copy and WhatsApp options', async () => {
    const writeText = vi.fn().mockResolvedValue()
    Object.assign(navigator, { clipboard: { writeText } })
    renderDialog()

    const linkField = await screen.findByDisplayValue(LINK)
    expect(linkField).toHaveAttribute('readonly')
    expect(lib.getPlanShareLink).toHaveBeenCalledWith('p1')
    const whatsapp = screen.getByRole('link', { name: /Share via WhatsApp/ })
    expect(whatsapp.getAttribute('href')).toBe(`https://wa.me/?text=${encodeURIComponent(`Follow my plan “Learn to present” on LearnScope: ${LINK}`)}`)

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK))
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('makes a new link only after confirming', async () => {
    renderDialog()
    await screen.findByDisplayValue(LINK)
    fireEvent.click(screen.getByRole('button', { name: 'Make a new link' }))
    expect(screen.getByText(/The current link will stop working/)).toBeInTheDocument()
    expect(lib.replacePlanShareLink).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Make a new link' }).at(-1))
    expect(await screen.findByDisplayValue('http://localhost/plan-invite/new456')).toBeInTheDocument()
    expect(lib.replacePlanShareLink).toHaveBeenCalledWith('p1')
  })

  it('invites people by email, whether or not they are connections', async () => {
    lib.inviteEmailsToPlan.mockResolvedValue([
      { email: 'ana@example.com', ok: true },
      { email: 'bo@example.com', ok: false, error: 'Mailbox full' },
    ])
    const { onInvited } = renderDialog()
    fireEvent.change(screen.getByLabelText('Invite by email'), { target: { value: 'ana@example.com, bo@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send email invitations' }))

    await waitFor(() => expect(lib.inviteEmailsToPlan).toHaveBeenCalledWith('p1', 'Learn to present', ['ana@example.com', 'bo@example.com']))
    expect(await screen.findByText('Invitation sent to ana@example.com')).toBeInTheDocument()
    expect(screen.getByText('Couldn’t send to bo@example.com: Mailbox full')).toBeInTheDocument()
    // The failed address stays in the box to try again.
    expect(screen.getByLabelText('Invite by email')).toHaveValue('bo@example.com')
    expect(onInvited).toHaveBeenCalled()
  })

  it('checks addresses before sending', async () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText('Invite by email'), { target: { value: 'ana@example.com, not-an-email' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send email invitations' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Check these addresses: not-an-email')
    expect(lib.inviteEmailsToPlan).not.toHaveBeenCalled()
  })
})
