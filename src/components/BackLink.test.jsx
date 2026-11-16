import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key) => key.split('.').reduce((v, part) => v?.[part], english) ?? key
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})

const { default: BackLink } = await import('./BackLink')

function renderAt(props, { inAppHistory }) {
  window.history.replaceState({ idx: inAppHistory ? 1 : 0 }, '')
  return render(
    <MemoryRouter initialEntries={['/plans/p1', '/courses/c1/learn']} initialIndex={1}>
      <Routes>
        <Route path="/courses/c1/learn" element={<BackLink {...props} fallbackTo="/learning" fallbackLabel="← Back to Learning" />} />
        <Route path="/plans/p1" element={<p>The plan</p>} />
        <Route path="/learning" element={<p>Learning page</p>} />
        <Route path="/skills/s1" element={<p>The skill</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '')
})

describe('BackLink', () => {
  it('goes where the opening page said, by name', () => {
    renderAt({ to: '/skills/s1', label: '← Back to Coaching' }, { inAppHistory: true })
    fireEvent.click(screen.getByRole('link', { name: '← Back to Coaching' }))
    expect(screen.getByText('The skill')).toBeInTheDocument()
  })

  it('otherwise goes back to the previous page in the app', () => {
    renderAt({}, { inAppHistory: true })
    fireEvent.click(screen.getByRole('button', { name: '← Back' }))
    expect(screen.getByText('The plan')).toBeInTheDocument()
  })

  it('falls back to the usual parent when the learner arrived from outside the app', () => {
    renderAt({}, { inAppHistory: false })
    fireEvent.click(screen.getByRole('link', { name: '← Back to Learning' }))
    expect(screen.getByText('Learning page')).toBeInTheDocument()
  })
})
