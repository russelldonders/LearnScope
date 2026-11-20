import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const updateLibrarySkill = vi.fn(() => Promise.resolve())
const generateLevelGuide = vi.fn(() => Promise.resolve(['g1', 'g2', 'g3', 'g4', 'g5']))
vi.mock('../../lib/admin/skills', () => ({ updateLibrarySkill: (...a) => updateLibrarySkill(...a) }))
vi.mock('../../lib/levelGuide', async (importOriginal) => ({
  ...(await importOriginal()),
  generateLevelGuide: (...a) => generateLevelGuide(...a),
}))
vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))

const { default: LevelDefinitionsSection } = await import('./LevelDefinitionsSection')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const skill = {
  id: 'lib1',
  name: 'Python',
  knowledge_level_guide: ['k1', 'k2', 'k3', 'k4', 'k5'],
  practical_level_guide: null,
}

describe('LevelDefinitionsSection', () => {
  it('lets an admin edit and save one axis’s definitions', async () => {
    const onSkillChange = vi.fn()
    render(<LevelDefinitionsSection skill={skill} onSkillChange={onSkillChange} />)
    const knowledge = screen.getByRole('region', { name: 'Knowledge' })
    expect(within(knowledge).getByText('k3')).toBeTruthy()

    fireEvent.click(within(knowledge).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(knowledge).getByLabelText('3. Familiar'), { target: { value: '  Edited three  ' } })
    fireEvent.click(within(knowledge).getByRole('button', { name: 'Save definitions' }))

    await waitFor(() =>
      expect(updateLibrarySkill).toHaveBeenCalledWith('lib1', {
        knowledge_level_guide: ['k1', 'k2', 'Edited three', 'k4', 'k5'],
      })
    )
    expect(onSkillChange).toHaveBeenCalledWith(expect.objectContaining({ knowledge_level_guide: ['k1', 'k2', 'Edited three', 'k4', 'k5'] }))
  })

  it('refuses to save with a level left blank', async () => {
    render(<LevelDefinitionsSection skill={skill} onSkillChange={vi.fn()} />)
    const knowledge = screen.getByRole('region', { name: 'Knowledge' })
    fireEvent.click(within(knowledge).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(knowledge).getByLabelText('1. Unfamiliar'), { target: { value: '   ' } })
    fireEvent.click(within(knowledge).getByRole('button', { name: 'Save definitions' }))
    expect(await within(knowledge).findByText('Every level needs a description.')).toBeTruthy()
    expect(updateLibrarySkill).not.toHaveBeenCalled()
  })

  it('generates missing definitions on request', async () => {
    const onSkillChange = vi.fn()
    render(<LevelDefinitionsSection skill={skill} onSkillChange={onSkillChange} />)
    const practical = screen.getByRole('region', { name: 'Practical ability' })
    fireEvent.click(within(practical).getByRole('button', { name: 'Generate now' }))
    await waitFor(() => expect(onSkillChange).toHaveBeenCalledWith(expect.objectContaining({ practical_level_guide: ['g1', 'g2', 'g3', 'g4', 'g5'] })))
    expect(generateLevelGuide).toHaveBeenCalledWith('practical', 'Python', 'lib1')
  })
})
