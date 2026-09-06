import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ManagerSkillsPanel from './ManagerSkillsPanel'

afterEach(cleanup)

const members = [
  { id: 'alex', name: 'Alex', sharedSkills: [{ id: 'a1', name: 'Facilitation', level: 3, evidenceCount: 1, managerRating: { level: 2 } }] },
  { id: 'sam', name: 'Sam', sharedSkills: [{ id: 's1', name: 'Facilitation', level: 4, evidenceCount: 0 }] },
]

describe('ManagerSkillsPanel', () => {
  it('groups shared skills and shows learner and manager ratings', () => {
    render(<ManagerSkillsPanel members={members} />)
    expect(screen.getByRole('heading', { name: 'Facilitation' })).toBeInTheDocument()
    expect(screen.getByText('2 learners')).toBeInTheDocument()
    expect(screen.getByText('Self rating: Capable · 1 evidence item')).toBeInTheDocument()
    expect(screen.getByText('Your rating: Developing')).toBeInTheDocument()
    expect(screen.getByText('Your rating: Not rated yet')).toBeInTheDocument()
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
})
