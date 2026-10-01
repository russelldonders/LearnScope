import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
    return typeof value === 'string' && params ? value.replace(/\{(\w+)\}/g, (m, k) => params[k] ?? m) : value
  }
  return { useLanguage: () => ({ language: 'en', t }) }
})
vi.mock('../lib/skillValidationRequests', () => ({
  listValidatorCandidates: vi.fn().mockResolvedValue([
    { skill_id: 's1', validator_id: 'v1', level: 4, full_name: 'Priya', avatar_url: null, is_connection: true, person_confirmed: true },
    { skill_id: 's2', validator_id: 'v2', level: 4, full_name: 'Sam', avatar_url: null, is_connection: false, person_confirmed: false },
  ]),
  createValidationRequest: vi.fn(),
  getValidationRequestContact: vi.fn(),
  sendValidationRequestEmail: vi.fn(),
}))

const { default: RequestValidationModal } = await import('./RequestValidationModal')

describe('RequestValidationModal', () => {
  it("shows whether each validator's own skill was confirmed by a person or only an AI check", async () => {
    render(
      <RequestValidationModal skill={{ id: 'mine', name: 'Coaching', library_skill_id: 'lib' }} user={{ id: 'u' }} targetLevel={4} onClose={() => {}} />
    )
    const priya = (await screen.findByText('Priya')).closest('button')
    const sam = screen.getByText('Sam').closest('button')
    expect(priya).toHaveTextContent('Their skill is confirmed by another person')
    expect(sam).toHaveTextContent('Their skill passed an AI check, not yet confirmed by a person')
  })
})
