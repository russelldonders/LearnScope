import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lib = vi.hoisted(() => ({
  adminListCoachApprovals: vi.fn(),
  adminApproveCoach: vi.fn(),
  adminRevokeCoachApproval: vi.fn(),
}))

vi.mock('../../lib/coaching', () => lib)
vi.mock('../../context/LanguageContext', async () => {
  const { english } = await import('../../lib/i18n/translations')
  const t = (key) => key.split('.').reduce((v, part) => v?.[part], english) ?? key
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})

const { default: AdminCoachApprovals } = await import('./AdminCoachApprovals')

const skills = [
  { id: 's1', name: 'Leadership', library_skill_id: 'lib-1' },
  { id: 's2', name: 'Negotiation', library_skill_id: 'lib-2' },
  { id: 's3', name: 'My own thing', library_skill_id: null },
]

beforeEach(() => {
  vi.clearAllMocks()
  lib.adminApproveCoach.mockResolvedValue()
  lib.adminRevokeCoachApproval.mockResolvedValue()
})
afterEach(cleanup)

describe('AdminCoachApprovals', () => {
  it('approves someone as a coach for a library skill they have, with a note', async () => {
    lib.adminListCoachApprovals.mockResolvedValue([])
    render(<AdminCoachApprovals userId="u1" skills={skills} />)
    expect(await screen.findAllByRole('button', { name: 'Approve as coach' })).toHaveLength(2)
    expect(screen.queryByText('My own thing')).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Approve as coach' })[0])
    fireEvent.change(screen.getByLabelText(/Why are they approved/), { target: { value: 'ICF certified' } })
    fireEvent.click(screen.getByRole('button', { name: 'Approve as coach in Leadership' }))
    await waitFor(() => expect(lib.adminApproveCoach).toHaveBeenCalledWith('u1', 'lib-1', 'ICF certified'))
    expect(await screen.findByText('Approved as a coach in Leadership.')).toBeInTheDocument()
  })

  it('shows an approval in force and withdraws it only after confirming, keeping withdrawn ones listed', async () => {
    lib.adminListCoachApprovals.mockResolvedValue([
      { id: 'a2', library_skill_id: 'lib-1', skill_name: 'Leadership', note: 'ICF certified', approved_at: '2026-11-20T10:00:00Z', approved_by_label: 'Ada Admin', revoked_at: null },
      { id: 'a1', library_skill_id: 'lib-2', skill_name: 'Negotiation', note: null, approved_at: '2026-10-01T10:00:00Z', approved_by_label: 'Ada Admin', revoked_at: '2026-10-20T10:00:00Z', revoked_by_label: 'Ben Admin' },
    ])
    render(<AdminCoachApprovals userId="u1" skills={skills} />)
    expect(await screen.findByText(/Approved coach since .* by Ada Admin/)).toBeInTheDocument()
    expect(screen.getByText('“ICF certified”')).toBeInTheDocument()
    expect(screen.getByText(/Negotiation: .* withdrawn by Ben Admin/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
    expect(lib.adminRevokeCoachApproval).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Withdraw approval' }))
    await waitFor(() => expect(lib.adminRevokeCoachApproval).toHaveBeenCalledWith('a2'))
  })
})
