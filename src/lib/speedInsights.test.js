import { describe, expect, it } from 'vitest'
import { anonymiseRoute, anonymiseVital } from './speedInsights'

describe('anonymiseRoute', () => {
  it('keeps fixed route words', () => {
    expect(anonymiseRoute('/dashboard')).toBe('/dashboard')
    expect(anonymiseRoute('/admin/organisations')).toBe('/admin/organisations')
    expect(anonymiseRoute('/')).toBe('/')
  })

  it('replaces ids', () => {
    expect(anonymiseRoute('/admin/users/3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90')).toBe('/admin/users/:id')
    expect(anonymiseRoute('/admin/courses/3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90/edit')).toBe('/admin/courses/:id/edit')
    expect(anonymiseRoute('/skills/abc123def')).toBe('/skills/:id')
  })

  it('replaces private codes, even ones without digits', () => {
    expect(anonymiseRoute('/rate/abcdefgh')).toBe('/rate/:code')
    expect(anonymiseRoute('/recommend/qwerty')).toBe('/recommend/:code')
    expect(anonymiseRoute('/shared/sometoken')).toBe('/shared/:code')
    expect(anonymiseRoute('/plan-invite/abcdef')).toBe('/plan-invite/:code')
  })
})

describe('anonymiseVital', () => {
  it('drops the query string and hash and sets the route', () => {
    const event = { type: 'vital', url: 'https://learnscope.example/organisation?org=3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90&section=roles#x' }
    expect(anonymiseVital(event)).toEqual({ type: 'vital', url: 'https://learnscope.example/organisation', route: '/organisation' })
  })

  it('drops an event whose URL cannot be read', () => {
    expect(anonymiseVital({ type: 'vital', url: 'not a url' })).toBeNull()
  })
})
