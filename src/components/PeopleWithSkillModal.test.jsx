import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/skillDiscovery', () => ({
  listSkillMatches: vi.fn(() =>
    Promise.resolve([
      { user_id: 'u1', full_name: 'Expert Eva', level: 5, profile_viewable: false },
      { user_id: 'u2', full_name: 'Skilled Sam', level: 4, profile_viewable: false },
      { user_id: 'u3', full_name: 'Beginner Ben', level: 1, profile_viewable: false },
      { user_id: 'u4', full_name: 'Unknown Una', level: null, profile_viewable: false },
    ]),
  ),
  sendConnectionRequest: vi.fn(),
  isDuplicatePendingRequestError: () => false,
}))
vi.mock('./GrowthRing', () => ({ default: () => null }))
vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
    return typeof value === 'string' && params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})

const { default: PeopleWithSkillModal } = await import('./PeopleWithSkillModal')

afterEach(cleanup)

describe('finding an expert', () => {
  it('filters to people at or above the chosen level', async () => {
    render(
      <MemoryRouter>
        <PeopleWithSkillModal librarySkillId="lib-1" skillName="Golf" skillId="s1" onClose={vi.fn()} />
      </MemoryRouter>,
    )
    await screen.findByText('Expert Eva')
    expect(screen.getByText('Unknown Una')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Skill level'), { target: { value: '4' } })
    expect(screen.getByText('Expert Eva')).toBeInTheDocument()
    expect(screen.getByText('Skilled Sam')).toBeInTheDocument()
    expect(screen.queryByText('Beginner Ben')).not.toBeInTheDocument()
    expect(screen.queryByText('Unknown Una')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Skill level'), { target: { value: '5' } })
    expect(screen.queryByText('Skilled Sam')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Skill level'), { target: { value: '0' } })
    expect(screen.getByText('Beginner Ben')).toBeInTheDocument()
  })
})
