import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const FIVE = ['1', '2', '3', '4', '5']
const generateLevelGuide = vi.fn(() => Promise.resolve(FIVE))
vi.mock('../../lib/levelGuide', async (importOriginal) => ({
  ...(await importOriginal()),
  generateLevelGuide: (...a) => generateLevelGuide(...a),
}))
vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../../context/LanguageContext', async () => {
  const { english } = await import('../../lib/i18n/translations')
  const t = (key) => key.split('.').reduce((v, part) => v?.[part], english) ?? key
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})

const { default: MissingLevelDefinitions } = await import('./MissingLevelDefinitions')
const { missingLevelDefinitionTasks } = await import('../../lib/levelGuide')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const skills = [
  { id: 'a', name: 'A', status: 'active', is_private: false, knowledge_level_guide: null, practical_level_guide: FIVE },
  { id: 'b', name: 'B', status: 'active', is_private: false, knowledge_level_guide: null, practical_level_guide: null },
  { id: 'c', name: 'C', status: 'active', is_private: false, knowledge_level_guide: FIVE, practical_level_guide: FIVE },
  { id: 'd', name: 'D', status: 'inactive', is_private: false, knowledge_level_guide: null, practical_level_guide: null },
  { id: 'e', name: 'E', status: 'active', is_private: true, knowledge_level_guide: null, practical_level_guide: null },
]

describe('missingLevelDefinitionTasks', () => {
  it('lists each missing axis of active, non-private skills only', () => {
    expect(missingLevelDefinitionTasks(skills).map((t) => `${t.skill.id}:${t.axis}`)).toEqual([
      'a:knowledge',
      'b:knowledge',
      'b:practical',
    ])
  })
})

describe('MissingLevelDefinitions', () => {
  it('generates every missing set after confirmation and reports back each result', async () => {
    const onSkillGuide = vi.fn()
    render(<MissingLevelDefinitions skills={skills} onSkillGuide={onSkillGuide} />)
    expect(screen.getByText(/2 skills are missing level definitions \(3 sets/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Generate missing definitions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    expect(await screen.findByText('All missing level definitions have been generated.')).toBeTruthy()
    expect(generateLevelGuide.mock.calls).toEqual([
      ['knowledge', 'A', 'a'],
      ['knowledge', 'B', 'b'],
      ['practical', 'B', 'b'],
    ])
    expect(onSkillGuide).toHaveBeenCalledWith('b', 'practical', FIVE)
  })

  it('stops when the daily AI allowance runs out', async () => {
    generateLevelGuide.mockRejectedValueOnce(new Error("You've reached today's limit for this feature."))
    render(<MissingLevelDefinitions skills={skills} onSkillGuide={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Generate missing definitions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(screen.getByText(/Stopped: You've reached today's limit/)).toBeTruthy())
    expect(generateLevelGuide).toHaveBeenCalledTimes(1)
  })
})
