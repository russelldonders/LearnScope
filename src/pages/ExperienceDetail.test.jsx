import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
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

import { ExperienceActionButtons, SkillsSubsection } from './ExperienceDetail'

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

  it('shows no more than three ranked recommendations and lets the learner choose', () => {
    const recommendations = [
      { name: 'Product Strategy', reason: 'It helps set a clear direction for the product.' },
      { name: 'Stakeholder Management', reason: 'It aligns people around priorities and trade-offs.' },
      { name: 'Data Analysis', reason: 'It supports evidence-based product decisions.' },
    ]
    const onAddRecommendations = vi.fn()

    function RecommendationHarness() {
      const [selected, setSelected] = useState(new Set(recommendations.map((item) => item.name)))
      function toggle(name) {
        setSelected((current) => {
          const next = new Set(current)
          if (next.has(name)) next.delete(name)
          else next.add(name)
          return next
        })
      }
      return (
        <SkillsSubsection
          item={item}
          skillLinks={[]}
          onChange={vi.fn()}
          user={{ id: 'user-1' }}
          recommendations={recommendations}
          selectedRecommendations={selected}
          onToggleRecommendation={toggle}
          onAddRecommendations={onAddRecommendations}
        />
      )
    }

    render(
      <MemoryRouter>
        <RecommendationHarness />
      </MemoryRouter>,
    )

    expect(screen.getByText('Product Strategy')).toBeInTheDocument()
    expect(screen.getByText('Priority 1')).toBeInTheDocument()
    expect(screen.getByText('Priority 3')).toBeInTheDocument()
    expect(screen.getByText('3 selected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: /Stakeholder Management/ }))
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 selected skills' }))
    expect(onAddRecommendations).toHaveBeenCalled()
  })

  it('places experience, recommendation, and add-skill actions together above the tabs', () => {
    const onRecommend = vi.fn()
    const onAddSkill = vi.fn()
    render(
      <ExperienceActionButtons
        itemType="employment"
        onAddExperience={vi.fn()}
        onRecommend={onRecommend}
        onAddSkill={onAddSkill}
      />,
    )

    expect(screen.getByRole('button', { name: '+ Add Experience' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Recommend skills' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Add skill' }))
    expect(onRecommend).toHaveBeenCalled()
    expect(onAddSkill).toHaveBeenCalled()
  })
})
