import { cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RouteTitle from './RouteTitle'

vi.mock('../context/LanguageContext', () => import('../test/languageMock'))

afterEach(cleanup)

function titleAt(path) {
  render(<MemoryRouter initialEntries={[path]}><RouteTitle /></MemoryRouter>)
  return document.title
}

describe('RouteTitle', () => {
  it('uses the translated title for a learner route', () => {
    expect(titleAt('/skills/abc')).toBe('Skill details | LearnScope')
  })

  it('keeps the English title for a staff route', () => {
    expect(titleAt('/admin/tags')).toBe('Admin tags | LearnScope')
  })

  it('falls back to the app name for an unknown route', () => {
    expect(titleAt('/no-such-page')).toBe('LearnScope')
  })
})
