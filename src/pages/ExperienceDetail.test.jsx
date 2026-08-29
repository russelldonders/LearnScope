import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { recommendExperienceSkills, addRecommendedSkills } = vi.hoisted(() => ({
  recommendExperienceSkills: vi.fn(),
  addRecommendedSkills: vi.fn(),
}))

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          in: vi.fn().mockResolvedValue({ data: [] }),
        })),
      })),
    })),
  },
}))
vi.mock('../lib/experienceSkillRecommendations', () => ({
  recommendExperienceSkills,
  addRecommendedSkills,
}))

import { SkillsSubsection } from './ExperienceDetail'

const item = {
  id: 'experience-1',
  type: 'employment',
  title: 'Product Manager',
  organization: 'Acme',
  description: 'Lead a cross-functional product team.',
}

describe('experience skill recommendations', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    recommendExperienceSkills.mockResolvedValue([
      { name: 'Product Strategy', reason: 'It helps set a clear direction for the product.' },
      { name: 'Stakeholder Management', reason: 'It aligns people around priorities and trade-offs.' },
      { name: 'Data Analysis', reason: 'It supports evidence-based product decisions.' },
    ])
    addRecommendedSkills.mockResolvedValue([
      { id: 'skill-1', name: 'Product Strategy', created: true },
      { id: 'skill-3', name: 'Data Analysis', created: false },
    ])
  })

  it('shows no more than three ranked recommendations and lets the learner choose', async () => {
    const onChange = vi.fn()
    render(
      <MemoryRouter>
        <SkillsSubsection item={item} skillLinks={[]} onChange={onChange} user={{ id: 'user-1' }} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Recommend skills' }))

    expect(await screen.findByText('Product Strategy')).toBeInTheDocument()
    expect(screen.getByText('Priority 1')).toBeInTheDocument()
    expect(screen.getByText('Priority 3')).toBeInTheDocument()
    expect(screen.getByText('3 selected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: /Stakeholder Management/ }))
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 selected skills' }))

    await waitFor(() =>
      expect(addRecommendedSkills).toHaveBeenCalledWith({
        userId: 'user-1',
        experienceId: 'experience-1',
        names: ['Product Strategy', 'Data Analysis'],
      }),
    )
    expect(await screen.findByText('2 skills added to this experience and your profile.')).toBeInTheDocument()
    expect(onChange).toHaveBeenCalled()
  })

  it('passes already-linked skills to the recommendation service', async () => {
    render(
      <MemoryRouter>
        <SkillsSubsection
          item={item}
          skillLinks={[{ skill_id: 'existing-1', skills: { name: 'Roadmapping' } }]}
          onChange={vi.fn()}
          user={{ id: 'user-1' }}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Recommend skills' }))
    await waitFor(() => expect(recommendExperienceSkills).toHaveBeenCalledWith(item, ['Roadmapping']))
  })
})
