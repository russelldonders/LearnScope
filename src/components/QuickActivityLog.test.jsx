import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ tables: { skills: [{ id: 'skill-1', name: 'Running', user_id: 'user-1' }] }, calls: [] }))

vi.mock('../lib/supabaseClient', async () => {
  const { createSupabaseFake } = await import('../test/supabaseFake')
  return { supabase: createSupabaseFake(db) }
})
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1', email: 'a@example.com' } }) }))
vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
    return params ? String(value).replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})
vi.mock('../lib/quickActivityLog', async (importOriginal) => ({
  ...(await importOriginal()),
  draftActivitiesFromText: vi.fn(async () => ({ outcome: 'activities' })),
  cardsFromDraft: () => [
    {
      key: 'card-1',
      title: 'Morning run',
      date: '2026-11-20',
      durationMinutes: '',
      verb: 'experienced',
      skills: [{ id: 'skill-1', name: 'Running' }],
      goalValues: [],
      experienceId: null,
      note: '',
      newSkill: null,
    },
  ],
}))

import QuickActivityLog from './QuickActivityLog'

afterEach(cleanup)

async function logSentence(props = {}) {
  render(<QuickActivityLog user={{ id: 'user-1', email: 'a@example.com' }} goalItems={[]} onLogged={vi.fn()} {...props} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'What did you do?' }), { target: { value: 'ran this morning' } })
  fireEvent.click(screen.getByRole('button', { name: 'Log it' }))
  return screen.findByDisplayValue('Morning run')
}

describe('QuickActivityLog', () => {
  it('opens the activities to check in a pop-up, and closing it discards them', async () => {
    await logSentence()
    const dialog = screen.getByRole('dialog', { name: 'What did you do?' })
    expect(within(dialog).getByDisplayValue('Morning run')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save (1)' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('Morning run')).not.toBeInTheDocument()
  })

  it('keeps them in place when the log is already in a pop-up', async () => {
    await logSentence({ inDialog: true })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
