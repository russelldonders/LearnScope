import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const people = vi.hoisted(() => ({ list: [] }))
vi.mock('../lib/skillDiscovery', () => ({
  listSkillMatches: vi.fn(() => Promise.resolve(people.list)),
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

const person = (user_id, full_name, level) => ({ user_id, full_name, level, profile_viewable: false })
// Six people, so the level filter is offered; in no particular order.
const SIX = [
  person('u3', 'Beginner Ben', 1),
  person('u4', 'Unknown Una', null),
  person('u2', 'Skilled Sam', 4),
  person('u5', 'Capable Cal', 3),
  person('u1', 'Expert Eva', 5),
  person('u6', 'Developing Dee', 2),
]

function renderModal() {
  return render(
    <MemoryRouter>
      <PeopleWithSkillModal librarySkillId="lib-1" skillName="Golf" skillId="s1" onClose={vi.fn()} />
    </MemoryRouter>,
  )
}

// Each person's name, in the order listed.
const names = () => screen.getAllByRole('listitem').map((li) => SIX.find((p) => li.textContent.includes(p.full_name))?.full_name)

describe('finding an expert', () => {
  it('lists experts first, most skilled down, people with no level last', async () => {
    people.list = SIX
    renderModal()
    await screen.findByText('Expert Eva')
    expect(names()).toEqual(['Expert Eva', 'Skilled Sam', 'Capable Cal', 'Developing Dee', 'Beginner Ben', 'Unknown Una'])
    // Each says their level in words, as on the skill's Network tab.
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Expert Eva' + 'Expert')
    expect(screen.getAllByRole('listitem')[1]).toHaveTextContent('Skilled Sam' + 'Skilled')
  })

  it('offers a level filter only once there are more than five people', async () => {
    people.list = SIX.slice(0, 5)
    renderModal()
    await screen.findByText('Skilled Sam')
    expect(screen.queryByLabelText('Skill level')).not.toBeInTheDocument()
  })

  it('filters to people at or above the chosen level', async () => {
    people.list = SIX
    renderModal()
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
