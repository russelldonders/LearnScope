import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { english } from '../lib/i18n/translations'

vi.mock('../context/LanguageContext', async () => {
  const { english: en } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], en) ?? key
    return typeof value === 'string' && params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})

const { default: SkillLearningSection } = await import('./SkillLearningSection')

const l = english.skillDetail.learning

afterEach(cleanup)

const group = (title) => screen.getByRole('heading', { name: title }).parentElement

describe('SkillLearningSection', () => {
  it('splits linked courses into completed and enrolled, and lists catalogue courses on offer', () => {
    const onOpenAvailable = vi.fn()
    const available = { id: 'cat-1', name: 'Advanced Golf', provider: 'Golf Academy' }
    render(
      <MemoryRouter>
        <SkillLearningSection
          courseLinks={[
            { id: 'l1', courses: { id: 'c1', name: 'Golf Basics', provider: 'Club', completed_date: '2026-10-01' } },
            { id: 'l2', courses: { id: 'c2', name: 'Putting Clinic', provider: null, completed_date: null } },
          ]}
          availableCourses={[{ course: available, level: 4 }]}
          onFindCourse={vi.fn()}
          onOpenAvailable={onOpenAvailable}
        />
      </MemoryRouter>,
    )
    expect(within(group(l.completed)).getByRole('link', { name: /Golf Basics/ })).toHaveAttribute('href', '/courses/c1')
    expect(within(group(l.enrolled)).getByRole('link', { name: /Putting Clinic/ })).toHaveAttribute('href', '/courses/c2/learn')
    const offered = within(group(l.available)).getByRole('button', { name: /Advanced Golf/ })
    expect(offered).toHaveTextContent('Teaches Skilled')
    fireEvent.click(offered)
    expect(onOpenAvailable).toHaveBeenCalledWith(available)
  })

  it('says when there is nothing in a group, and leaves out what is on offer for someone else’s skill', () => {
    render(
      <MemoryRouter>
        <SkillLearningSection courseLinks={[]} availableCourses={null} onFindCourse={null} onOpenAvailable={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByText(l.noneCompleted)).toBeInTheDocument()
    expect(screen.getByText(l.noneEnrolled)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: l.available })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: english.skillDetail.findACourse })).not.toBeInTheDocument()
  })
})
