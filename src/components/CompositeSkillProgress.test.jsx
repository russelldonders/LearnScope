import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
      childComposite: {
        components: [{ id: 'knife-safety' }, { id: 'portion-control' }],
        coverage: { percentage: 50, requiredMet: 1, requiredTotal: 2, allRequiredMet: false },
      },
    },
  ],
}

afterEach(cleanup)

describe('CompositeSkillProgress', () => {
  it('shows coverage, required targets, and links tracked component skills', () => {
    render(<MemoryRouter><CompositeSkillProgress composite={composite} /></MemoryRouter>)

    expect(screen.getByText('67%')).toBeInTheDocument()
    expect(screen.getByText('1 of 2 required targets met')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Dough making' })).toHaveAttribute('href', '/skills/tracked-dough')
    expect(screen.getByText('Pizza slicing')).toBeInTheDocument()
    expect(screen.getByText('Not yet tracked')).toBeInTheDocument()
    expect(screen.getByText('Also built from 2 subskills · 50% subskill coverage')).toBeInTheDocument()
    expect(screen.getByText('Based on published component set version 2.')).toBeInTheDocument()
  })

  it('stays hidden when the skill has no published component set', () => {
    const { container } = render(<MemoryRouter><CompositeSkillProgress composite={null} /></MemoryRouter>)
    expect(container).toBeEmptyDOMElement()
  })

  it('offers to start a not-yet-tracked component, and calls onStartComponent with it', () => {
    const onStartComponent = vi.fn()
    render(<MemoryRouter><CompositeSkillProgress composite={composite} onStartComponent={onStartComponent} /></MemoryRouter>)
    expect(screen.queryByText('Add it from your Skills page to begin.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start working on this skill now' }))
    expect(onStartComponent).toHaveBeenCalledWith(composite.components[1])
  })

  it('disables and relabels the button for whichever component is currently starting', () => {
    render(<MemoryRouter><CompositeSkillProgress composite={composite} startingComponentId="slicing-link" /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled()
  })

  it('shows an inline error if starting a component fails', () => {
    render(<MemoryRouter><CompositeSkillProgress composite={composite} startError="Couldn't add that skill." /></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't add that skill.")
  })
})
