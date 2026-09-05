import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ManagerTeamPanel from './ManagerTeamPanel'

afterEach(cleanup)
const members = [{ id: 'member-1', name: 'Alex', sharedSkills: [{ id: 'skill-1', name: 'Coaching', level: 2 }] }]
const detail = { level: 2, knowledge_level: 3, targets: [], assessments: [] }

async function openDetail(props = {}) {
  render(<ManagerTeamPanel members={members} onLoadSkillDetail={vi.fn().mockResolvedValue(detail)} {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'View skills profile for Alex' }))
  expect(screen.getByRole('heading', { name: 'Alex’s skills profile' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'View skill detail for Coaching' }))
  await screen.findByRole('heading', { name: 'Can do' })
}

describe('manager skills profile', () => {
  it('opens a learner-style detail and saves a target for the selected member and skill', async () => {
    const onSetTarget = vi.fn().mockResolvedValue({ id: 'target-1', target_level: 4, target_date: '2027-01-01', set_by_manager: 'manager-1' })
    await openDetail({ onSetTarget })
    expect(screen.getByText('Familiar')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Set target' }))
    fireEvent.change(screen.getByLabelText('Target level'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('Achieve by'), { target: { value: '2027-01-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save target' }))
    await screen.findByText('Target saved. It is now visible in the learner’s skill detail.')
    expect(onSetTarget).toHaveBeenCalledWith('member-1', 'skill-1', { level: 4, date: '2027-01-01', comments: '' })
    expect(screen.getByText('Set by manager')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Alex’s skills' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to team' }))
    expect(screen.getByRole('button', { name: 'View skills profile for Alex' })).toBeInTheDocument()
  })

  it('retains the target form and shows save failures', async () => {
    await openDetail({ onSetTarget: vi.fn().mockRejectedValue(new Error('Sharing was revoked')) })
    fireEvent.click(screen.getByRole('button', { name: 'Set target' }))
    fireEvent.change(screen.getByLabelText('Achieve by'), { target: { value: '2027-01-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save target' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sharing was revoked')
    expect(screen.getByLabelText('Achieve by')).toHaveValue('2027-01-01')
  })

  it('opens the existing rating flow from inside skill detail', async () => {
    const onRateSkill = vi.fn().mockResolvedValue()
    await openDetail({ onRateSkill, onLoadSkillAssessments: vi.fn().mockResolvedValue([]) })
    fireEvent.click(screen.getByRole('button', { name: 'Rate skill' }))
    fireEvent.click(screen.getByRole('button', { name: 'Capable' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save rating' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onRateSkill).toHaveBeenCalledWith('member-1', 'skill-1', expect.objectContaining({ level: 3 }))
  })

  it('does not show mutation controls when skill access fails', async () => {
    render(<ManagerTeamPanel members={members} onLoadSkillDetail={vi.fn().mockRejectedValue(new Error('Skill no longer shared'))} onSetTarget={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'View skills profile for Alex' }))
    fireEvent.click(screen.getByRole('button', { name: 'View skill detail for Coaching' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Skill no longer shared')
    expect(screen.queryByRole('button', { name: 'Set target' })).not.toBeInTheDocument()
  })
})
