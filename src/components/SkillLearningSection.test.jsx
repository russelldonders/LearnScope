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
const headings = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)

function renderSection(props) {
  return render(
    <MemoryRouter>
      <SkillLearningSection courseLinks={[]} availableCourses={null} onFindCourse={vi.fn()} onOpenAvailable={vi.fn()} {...props} />
    </MemoryRouter>,
  )
}

describe('SkillLearningSection', () => {
  it('lists recommended, enrolled, in progress and completed, top to bottom', () => {
    const onOpenAvailable = vi.fn()
    const available = { id: 'cat-9', name: 'Advanced Golf', provider: 'Golf Academy' }
    renderSection({
      courseLinks: [
        { id: 'l1', courses: { id: 'c1', name: 'Golf Basics', provider: 'Club', completed_date: '2026-10-01' } },
        { id: 'l2', courses: { id: 'c2', name: 'Putting Clinic', provider: null, completed_date: null, catalogue_course_id: 'cat-2' } },
        { id: 'l3', courses: { id: 'c3', name: 'Driving Range', provider: null, completed_date: null, catalogue_course_id: 'cat-3' } },
      ],
      availableCourses: [{ course: available, level: 4 }],
      // A lesson of Putting Clinic has been started; Driving Range not yet.
      startedCatalogueIds: new Set(['cat-2']),
      onOpenAvailable,
    })
    expect(headings()).toEqual([l.available, l.enrolled, l.inProgress, l.completed])
    expect(within(group(l.enrolled)).getByRole('link', { name: /Driving Range/ })).toHaveAttribute('href', '/courses/c3/learn')
    expect(within(group(l.inProgress)).getByRole('link', { name: /Putting Clinic/ })).toHaveAttribute('href', '/courses/c2/learn')
    expect(within(group(l.completed)).getByRole('link', { name: /Golf Basics/ })).toHaveAttribute('href', '/courses/c1')
    const offered = within(group(l.available)).getByRole('button', { name: /Advanced Golf/ })
    expect(offered).toHaveTextContent('Teaches Skilled')
    fireEvent.click(offered)
    expect(onOpenAvailable).toHaveBeenCalledWith(available)
  })

  it('leaves out every group with nothing in it', () => {
    renderSection({
      courseLinks: [{ id: 'l1', courses: { id: 'c1', name: 'Golf Basics', provider: null, completed_date: '2026-10-01' } }],
      availableCourses: [],
    })
    expect(headings()).toEqual([l.completed])
  })

  it('says so when there is no learning at all, and has no Find a course on someone else’s skill', () => {
    renderSection({ onFindCourse: null })
    expect(screen.getByText(l.nothingYet)).toBeInTheDocument()
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0)
    expect(screen.queryByRole('button', { name: english.skillDetail.findACourse })).not.toBeInTheDocument()
  })
})
