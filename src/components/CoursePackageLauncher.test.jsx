import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key) => key.split('.').reduce((v, part) => v?.[part], english) ?? key
  return { useLanguage: () => ({ language: 'en-GB', setLanguage: vi.fn(), t }) }
})

const { default: CoursePackageLauncher } = await import('./CoursePackageLauncher')

afterEach(cleanup)

describe('CoursePackageLauncher', () => {
  it('starts the package only when opened, over the whole window, and closes back to the lesson', () => {
    render(
      <CoursePackageLauncher item={{ id: 'i1', title: 'Fire safety' }} recordsActivity>
        <p>player running</p>
      </CoursePackageLauncher>,
    )
    expect(screen.queryByText('player running')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    const dialog = screen.getByRole('dialog', { name: 'Fire safety' })
    expect(dialog).toHaveTextContent('player running')
    expect(dialog).toHaveTextContent('Activity this package reports is added to your learning record.')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('player running')).not.toBeInTheDocument()
  })
})
