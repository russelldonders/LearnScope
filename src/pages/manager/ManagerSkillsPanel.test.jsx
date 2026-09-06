import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ManagerSkillsPanel from './ManagerSkillsPanel'
import { listLibrarySkills } from '../../lib/skillLibrary'

vi.mock('../../lib/skillLibrary', () => ({ listLibrarySkills: vi.fn() }))

beforeEach(() => { listLibrarySkills.mockResolvedValue([]) })
afterEach(cleanup)

const members = [
  { id: 'alex', name: 'Alex', sharedSkills: [{ id: 'a1', name: 'Facilitation', level: 3, evidenceCount: 1, managerRating: { level: 2 } }] },
  { id: 'sam', name: 'Sam', sharedSkills: [{ id: 's1', name: 'Facilitation', level: 4, evidenceCount: 0 }] },
]

describe('ManagerSkillsPanel', () => {
  it('shows a matrix of who has which skill, at what level, and whether you’ve rated it', () => {
    render(<ManagerSkillsPanel members={members} />)
    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: /Alex/ })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: /Sam/ })).toBeInTheDocument()
    expect(within(table).getByRole('rowheader', { name: 'Facilitation' })).toBeInTheDocument()

    const alexCell = screen.getByRole('button', { name: 'Review Facilitation for Alex' })
    expect(alexCell).toHaveTextContent('Capable')
    expect(alexCell).toHaveTextContent('Rated by you')

    const samCell = screen.getByRole('button', { name: 'Review Facilitation for Sam' })
    expect(samCell).toHaveTextContent('Skilled')
    expect(samCell).not.toHaveTextContent('Rated by you')
  })

  it('opens a learner skill directly in skill detail', async () => {
    const onLoadSkillDetail = vi.fn().mockResolvedValue({ level: 3, targets: [], assessments: [] })
    render(<ManagerSkillsPanel members={members} onLoadSkillDetail={onLoadSkillDetail} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review Facilitation for Alex' }))
    expect(await screen.findByRole('heading', { name: 'Facilitation' })).toBeInTheDocument()
    expect(onLoadSkillDetail).toHaveBeenCalledWith('alex', 'a1')
  })

  it('explains how to populate an empty skills view', () => {
    render(<ManagerSkillsPanel members={[]} />)
    expect(screen.getByText('No shared skills yet')).toBeInTheDocument()
    expect(screen.getByText(/Invite learners from the Members tab/)).toBeInTheDocument()
  })

  it('does not offer to add a skill without permission (an archived team, or no members yet)', () => {
    const { rerender } = render(<ManagerSkillsPanel members={members} />)
    expect(screen.queryByRole('button', { name: '+ Add a skill' })).not.toBeInTheDocument()
    rerender(<ManagerSkillsPanel members={[]} onSuggestSkill={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '+ Add a skill' })).not.toBeInTheDocument()
  })

  it('lets a leader suggest a skill to selected team members, retrying only the ones that failed', async () => {
    listLibrarySkills.mockResolvedValue([{ id: 'lib-1', name: 'Coaching' }])
    const onSuggestSkill = vi.fn()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('Already suggested'))
    render(<ManagerSkillsPanel members={members} onSuggestSkill={onSuggestSkill} />)

    fireEvent.click(screen.getByRole('button', { name: '+ Add a skill' }))
    fireEvent.change(screen.getByLabelText('Skill'), { target: { value: 'Coach' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Coaching' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
    fireEvent.click(screen.getByRole('button', { name: 'Suggest to 2' }))

    await waitFor(() => expect(onSuggestSkill).toHaveBeenCalledTimes(2))
    expect(onSuggestSkill).toHaveBeenCalledWith('alex', 'lib-1', 'Coaching', { targetLevel: null, targetDate: null, comments: null })
    expect(onSuggestSkill).toHaveBeenCalledWith('sam', 'lib-1', 'Coaching', { targetLevel: null, targetDate: null, comments: null })
    // Partial failure: the dialog stays open, only the failed member is still checked.
    expect(await screen.findByRole('alert')).toHaveTextContent(/Suggested to 1.*Sam/)
    expect(screen.getByRole('checkbox', { name: 'Sam' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Alex' })).not.toBeChecked()
  })

  it('closes the add-skill dialog once every selected member succeeds', async () => {
    listLibrarySkills.mockResolvedValue([{ id: 'lib-1', name: 'Coaching' }])
    const onSuggestSkill = vi.fn().mockResolvedValue()
    render(<ManagerSkillsPanel members={members} onSuggestSkill={onSuggestSkill} />)

    fireEvent.click(screen.getByRole('button', { name: '+ Add a skill' }))
    fireEvent.change(screen.getByLabelText('Skill'), { target: { value: 'Coach' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Coaching' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alex' }))
    fireEvent.click(screen.getByRole('button', { name: 'Suggest skill' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onSuggestSkill).toHaveBeenCalledWith('alex', 'lib-1', 'Coaching', { targetLevel: null, targetDate: null, comments: null })
  })
})
