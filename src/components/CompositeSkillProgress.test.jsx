import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import CompositeSkillProgress from './CompositeSkillProgress'

const composite = {
  version: 2,
  coverage: { percentage: 67, requiredMet: 1, requiredTotal: 2, allRequiredMet: false },
  components: [
    {
      id: 'dough-link',
      name: 'Dough making',
      isRequired: true,
      targetLevel: 3,
      currentLevel: 3,
      targetMet: true,
      trackedSkillId: 'tracked-dough',
    },
    {
      id: 'slicing-link',
      name: 'Pizza slicing',
      isRequired: true,
      targetLevel: 2,
      currentLevel: null,
      targetMet: false,
      trackedSkillId: null,
    },
  ],
}

describe('CompositeSkillProgress', () => {
  it('shows coverage, required targets, and links tracked component skills', () => {
    render(<MemoryRouter><CompositeSkillProgress composite={composite} /></MemoryRouter>)

    expect(screen.getByText('67%')).toBeInTheDocument()
    expect(screen.getByText('1 of 2 required targets met')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Dough making' })).toHaveAttribute('href', '/skills/tracked-dough')
    expect(screen.getByText('Pizza slicing')).toBeInTheDocument()
    expect(screen.getByText('Not yet tracked')).toBeInTheDocument()
    expect(screen.getByText('Based on published component set version 2.')).toBeInTheDocument()
  })

  it('stays hidden when the skill has no published component set', () => {
    const { container } = render(<MemoryRouter><CompositeSkillProgress composite={null} /></MemoryRouter>)
    expect(container).toBeEmptyDOMElement()
  })
})
