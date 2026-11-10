import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const updateActivity = vi.fn(() => Promise.resolve())
const deleteActivity = vi.fn(() => Promise.resolve())
vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../lib/activityEdits', async (importOriginal) => ({ ...(await importOriginal()), updateActivity, deleteActivity }))
vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
    return typeof value === 'string' && params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})

const { default: EditActivityModal } = await import('./EditActivityModal')
const { buildStatement } = await import('../lib/xapiStatement')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const row = {
  id: 'a',
  resource_id: null,
  recorded_at: new Date().toISOString(),
  statement: buildStatement({
    actor: { name: 'Me', email: 'me@example.com' },
    verbValue: 'experienced',
    activityName: 'Sit-ups',
    timestamp: new Date().toISOString(),
    relatedSkills: [{ id: 'fit', name: 'Fitness' }],
    measurements: [{ metric: 'sit_ups', kind: 'count', unit: 'sit-ups', value: 100 }],
  }),
}

describe('EditActivityModal', () => {
  it('saves a changed value', async () => {
    const onDone = vi.fn()
    render(<EditActivityModal row={row} onDone={onDone} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('sit-ups'), { target: { value: '120' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(updateActivity).toHaveBeenCalledWith(row, expect.anything(), expect.any(String))
  })

  it('asks before deleting, and can be backed out of', async () => {
    const onDone = vi.fn()
    render(<EditActivityModal row={row} onDone={onDone} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete activity' }))
    expect(deleteActivity).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete activity' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(deleteActivity).toHaveBeenCalledWith(row)
  })
})
