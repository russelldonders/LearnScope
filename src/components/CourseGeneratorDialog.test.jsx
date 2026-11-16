import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CourseGeneratorDialog from './CourseGeneratorDialog'
import { createGeneratedCourseDraft, generateCourseDraft } from '../lib/courseGeneration'

vi.mock('../lib/courseGeneration', () => ({
  generateCourseDraft: vi.fn(),
  createGeneratedCourseDraft: vi.fn(),
}))

const draft = {
  name: 'Manual handling essentials',
  synopsis: 'A practical introduction.',
  courseType: 'Online',
  durationValue: 6,
  durationUnit: 'hours',
  sections: [{
    title: 'Prepare',
    instructions: 'Start here.',
    pages: [{ title: 'Assess the lift', pageContent: { version: 1, blocks: [] } }],
  }],
}

describe('CourseGeneratorDialog', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it('generates a reviewable outline before saving anything', async () => {
    generateCourseDraft.mockResolvedValue(draft)
    render(<CourseGeneratorDialog organisationId="org-1" onClose={vi.fn()} onCreated={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Course topic'), { target: { value: 'Manual handling' } })
    fireEvent.change(screen.getByLabelText('Who is it for?'), { target: { value: 'Warehouse starters' } })
    fireEvent.change(screen.getByLabelText('Learning outcomes'), { target: { value: 'Assess a lift safely' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate course' }))

    expect(await screen.findByText('Manual handling essentials')).toBeInTheDocument()
    expect(screen.getByText('Assess the lift')).toBeInTheDocument()
    expect(createGeneratedCourseDraft).not.toHaveBeenCalled()
  })

  it('creates the reviewed draft and returns its id', async () => {
    const onCreated = vi.fn()
    generateCourseDraft.mockResolvedValue(draft)
    createGeneratedCourseDraft.mockResolvedValue('course-1')
    render(<CourseGeneratorDialog organisationId="org-1" onClose={vi.fn()} onCreated={onCreated} />)

    for (const [label, value] of [
      ['Course topic', 'Manual handling'],
      ['Who is it for?', 'Warehouse starters'],
      ['Learning outcomes', 'Assess a lift safely'],
    ]) fireEvent.change(screen.getByLabelText(label), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate course' }))
    await screen.findByText('Manual handling essentials')
    fireEvent.click(screen.getByRole('button', { name: 'Create editable draft' }))

    await waitFor(() => expect(createGeneratedCourseDraft).toHaveBeenCalledWith('org-1', draft))
    expect(onCreated).toHaveBeenCalledWith('course-1')
  })

  it('sends the chosen interactive and visual elements with the brief', async () => {
    generateCourseDraft.mockResolvedValue(draft)
    render(<CourseGeneratorDialog organisationId="org-1" onClose={vi.fn()} onCreated={vi.fn()} />)
    for (const [label, value] of [
      ['Course topic', 'Manual handling'],
      ['Who is it for?', 'Warehouse starters'],
      ['Learning outcomes', 'Assess a lift safely'],
    ]) fireEvent.change(screen.getByLabelText(label), { target: { value } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Chart/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Flip cards/ }))
    fireEvent.click(screen.getByRole('radio', { name: /Rich/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate course' }))

    await waitFor(() => expect(generateCourseDraft).toHaveBeenCalled())
    const brief = generateCourseDraft.mock.calls[0][0]
    expect(brief.elementAmount).toBe('rich')
    expect(brief.elements).toEqual(['knowledge_check', 'hotspots', 'accordion', 'ordering', 'diagram', 'animation'])
  })
})
