import { expect, it, vi } from 'vitest'
import { validateLmsConnection } from './configuration'
vi.mock('../supabaseClient', () => ({ supabase: {} }))
const form = { name: 'Canvas sandbox', client_id: 'client', issuer: 'https://lms.example', authorization_url: 'https://lms.example/auth', jwks_url: 'https://lms.example/jwks', token_url: 'https://lms.example/token', deployment_ids: ' a\na\nb ' }
it('keeps issuer exact and deduplicates deployment IDs', () => {
  const validated = validateLmsConnection(form)
  expect(validated.issuer).toBe('https://lms.example')
  expect(validated.deployment_ids).toEqual(['a','b'])
})
it.each(['http://lms.example','https://user:password@lms.example','https://lms.example?x=y','https://lms.example#x'])('rejects invalid issuer %s', (issuer) => {
  expect(() => validateLmsConnection({ ...form, issuer })).toThrow(/HTTPS/)
})
it('requires a deployment ID', () => { expect(() => validateLmsConnection({ ...form, deployment_ids: '' })).toThrow(/deployment/) })
