import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ManagerTeamPanel from './ManagerTeamPanel'
import { FIXTURE_TEAM } from './managerFixtures'

afterEach(cleanup)

describe('ManagerTeamPanel', () => {
  it('shows nothing shared yet for a member with no shared skills', () => {
    render(<ManagerTeamPanel members={[{ id: 'm1', name: 'Alex', teamSince: '2026-01-01', sharedSkills: [] }]} />)
    expect(screen.getByText('Nothing shared yet')).toBeInTheDocument()
  })

  it('does not offer to rate a skill when onRateSkill is not provided', () => {
    render(<ManagerTeamPanel members={FIXTURE_TEAM} />)
    expect(screen.queryByRole('button', { name: 'Rate' })).not.toBeInTheDocument()
  })

  it('shows a rate action per shared skill, and the manager rating badge once one exists', () => {
    const members = [{
      id: 'm1', name: 'Priya Nair', teamSince: '2026-04-12',
      sharedSkills: [
        { id: 'skill-1', name: 'Facilitation', level: 4, sharedAt: '2026-06-01', evidenceCount: 0 },
        {
          id: 'skill-2', name: 'Data storytelling', level: 2, sharedAt: '2026-07-01', evidenceCount: 0,
          managerRating: { level: 3, assessedAt: '2026-08-01' },
        },
      ],
    }]
    render(<ManagerTeamPanel members={members} onRateSkill={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Rate' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rate again' })).toBeInTheDocument()
    expect(screen.getByText(/Your rating: Capable/)).toBeInTheDocument()
  })

  it('lets a manager submit a rating for a shared skill', async () => {
    const onRateSkill = vi.fn().mockResolvedValue()
    const onLoadSkillAssessments = vi.fn().mockResolvedValue([])
    const members = [{
      id: 'm1', name: 'Priya Nair', teamSince: '2026-04-12',
      sharedSkills: [{ id: 'skill-1', name: 'Facilitation', level: 4, sharedAt: '2026-06-01', evidenceCount: 0 }],
    }]
    render(<ManagerTeamPanel members={members} onRateSkill={onRateSkill} onLoadSkillAssessments={onLoadSkillAssessments} />)

    fireEvent.click(screen.getByRole('button', { name: 'Rate' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(onLoadSkillAssessments).toHaveBeenCalledWith('m1', 'skill-1')

    fireEvent.click(screen.getByRole('button', { name: 'Beginner' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save rating' }))

    await screen.findByRole('button', { name: 'Rate' })
    expect(onRateSkill).toHaveBeenCalledWith('m1', 'skill-1', {
      level: 1, comments: null, evidenceUrl: null, files: [],
    })
  })

  it("never rewrites the member's own self-assessed level shown on the chip", () => {
    const members = [{
      id: 'm1', name: 'Priya Nair', teamSince: '2026-04-12',
      sharedSkills: [{ id: 'skill-1', name: 'Facilitation', level: 4, sharedAt: '2026-06-01', evidenceCount: 0 }],
    }]
    render(<ManagerTeamPanel members={members} onRateSkill={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rate' }))
    expect(screen.getByText(/rates themselves at Skilled/)).toBeInTheDocument()
  })
})
