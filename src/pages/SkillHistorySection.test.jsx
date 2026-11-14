import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildStatement } from '../lib/xapiStatement'

vi.mock('../components/EvidenceThumbnail', () => ({ default: () => null }))
vi.mock('../components/EvidenceAttachmentLink', () => ({ default: () => null }))
vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
    return typeof value === 'string' && params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})

const { TimelineEntry } = await import('./SkillHistorySection')

afterEach(cleanup)

function activityRow(name) {
  const statement = buildStatement({
    actor: { name: 'Me', email: 'me@example.com' },
    verbValue: 'practiced',
    activityName: name,
    timestamp: '2026-11-10T09:00:00.000Z',
    relatedSkills: [{ id: 's1', name: 'Golf' }],
    durationHours: 1,
    durationMinutes: 30,
  })
  return { id: 'a1', statement, recorded_at: statement.timestamp, created_at: statement.timestamp }
}

describe('an activity in a skill’s history', () => {
  it('uses the dashboard timeline’s row -- title to open it, skill chip, figures -- with its date', () => {
    const onSelect = vi.fn()
    render(
      <MemoryRouter>
        <TimelineEntry event={{ type: 'activity', statement: activityRow('Range session') }} isLast onSelect={onSelect} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Range session' }))
    expect(onSelect).toHaveBeenCalledOnce()
    expect(screen.getByRole('link', { name: /Golf/ })).toHaveAttribute('href', '/skills/s1')
    expect(screen.getByText('1h 30m')).toBeInTheDocument()
    // History has no day headings, so the row carries its own date.
    expect(screen.getByTitle(/2026/)).toBeInTheDocument()
  })
})
