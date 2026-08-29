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

import {
  buildExperienceSkillProgress,
  ExperienceActionButtons,
  getDevelopedSkills,
  getExperienceTabs,
  SkillsSubsection,
} from './ExperienceDetail'

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

  it('combines skill and experience creation into one add menu with skill first', () => {
    const onAddExperience = vi.fn()
    const onRecommend = vi.fn()
    const onAddSkill = vi.fn()
    render(
      <ExperienceActionButtons
        itemType="employment"
        onAddExperience={onAddExperience}
        onRecommend={onRecommend}
        onAddSkill={onAddSkill}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '+ Add' }))
    const menuOptions = screen.getAllByRole('button').map((button) => button.textContent)
    expect(menuOptions.indexOf('Skill')).toBeLessThan(menuOptions.indexOf('Project'))
    fireEvent.click(screen.getByRole('button', { name: 'Skill' }))
    expect(onAddSkill).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '+ Add' }))
    fireEvent.click(screen.getByRole('button', { name: 'Project' }))
    expect(onAddExperience).toHaveBeenCalledWith('project')

    fireEvent.click(screen.getByRole('button', { name: 'Recommend skills' }))
    expect(onRecommend).toHaveBeenCalled()
  })
})

describe('experience tabs', () => {
  it('hides Courses until the first course is linked', () => {
    expect(getExperienceTabs(item, []).map((tab) => tab.id)).toEqual(['overview', 'skills'])
    expect(getExperienceTabs(item, [{ id: 'course-link-1' }]).map((tab) => tab.id)).toEqual([
      'overview',
      'courses',
      'skills',
    ])
  })

  it('keeps Courses hidden for nested experiences', () => {
    expect(
      getExperienceTabs({ ...item, parent_experience_id: 'parent-1' }, [{ id: 'course-link-1' }]).map(
        (tab) => tab.id,
      ),
    ).toEqual(['overview', 'skills'])
  })
})

describe('experience skill progress', () => {
  const skillLink = {
    skill_id: 'skill-1',
    skills: { id: 'skill-1', name: 'Product Strategy', level: 5 },
  }
  const assessments = [
    { id: 'before', skill_id: 'skill-1', level: 1, assessed_at: '2019-11-01T09:00:00Z' },
    { id: 'start', skill_id: 'skill-1', level: 2, assessed_at: '2020-01-01T09:00:00Z' },
    { id: 'growth', skill_id: 'skill-1', level: 3, assessed_at: '2021-06-15T09:00:00Z' },
    { id: 'exit', skill_id: 'skill-1', level: 4, assessed_at: '2022-12-01T09:00:00Z' },
    { id: 'later', skill_id: 'skill-1', level: 5, assessed_at: '2024-02-01T09:00:00Z' },
  ]

  it('uses the level at role start and the current level for an open role', () => {
    const progress = buildExperienceSkillProgress(
      skillLink,
      assessments,
      { start_date: '2020-01-01', end_date: null },
      new Date('2021-12-31T12:00:00Z'),
    )

    expect(progress.entryLevel).toBe(2)
    expect(progress.endLevel).toBe(5)
    expect(progress.endLabel).toBe('Current level')
    expect(progress.duringRole.map((entry) => entry.id)).toEqual(['start', 'growth'])
  })

  it('uses the last assessment before an ended role finished and excludes later history', () => {
    const progress = buildExperienceSkillProgress(skillLink, assessments, {
      start_date: '2020-01-01',
      end_date: '2022-12-31',
    })

    expect(progress.entryLevel).toBe(2)
    expect(progress.endLevel).toBe(4)
    expect(progress.endLabel).toBe('When role ended')
    expect(progress.duringRole.map((entry) => entry.id)).toEqual(['start', 'growth', 'exit'])
  })

  it('does not invent an entry level when no assessment existed at role start', () => {
    const progress = buildExperienceSkillProgress(skillLink, assessments.slice(2), {
      start_date: '2020-01-01',
      end_date: '2022-12-31',
    })

    expect(progress.entryLevel).toBeNull()
    expect(progress.endLevel).toBe(4)
  })

  it('only includes skills whose measured level increased during the role', () => {
    const unchangedLink = {
      skill_id: 'skill-2',
      skills: { id: 'skill-2', name: 'Data Analysis', level: 3 },
    }
    const unchangedAssessments = [
      { id: 'unchanged-start', skill_id: 'skill-2', level: 3, assessed_at: '2020-01-01T09:00:00Z' },
      { id: 'unchanged-end', skill_id: 'skill-2', level: 3, assessed_at: '2022-12-01T09:00:00Z' },
    ]

    const developed = getDevelopedSkills(
      [skillLink, unchangedLink],
      [...assessments, ...unchangedAssessments],
      { start_date: '2020-01-01', end_date: '2022-12-31' },
    )

    expect(developed.map(({ link }) => link.skill_id)).toEqual(['skill-1'])
  })

  it('excludes skills without a measured entry level because growth cannot be established', () => {
    const developed = getDevelopedSkills(
      [skillLink],
      assessments.slice(2),
      { start_date: '2020-01-01', end_date: '2022-12-31' },
    )

    expect(developed).toEqual([])
  })
})
