import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAppLink } from '../send-email.js'

const HOST = 'learnscope.example.com'
const REQUEST_ID = '0f8fad5b-d9cb-469f-a165-70867728950e'

describe('isAppLink', () => {
  afterEach(() => vi.unstubAllEnvs())

  it("accepts each email type's own page on the request's host", () => {
    expect(isAppLink(`https://${HOST}/rate/abc123`, 'invite', HOST)).toBe(true)
    expect(isAppLink(`https://${HOST}/recommend/abc-123_x`, 'recommend', HOST)).toBe(true)
    expect(isAppLink(`https://${HOST}/validate-request/${REQUEST_ID}`, 'validation_request', HOST)).toBe(true)
  })

  it('accepts APP_URL as an origin too', () => {
    vi.stubEnv('APP_URL', 'https://app.learnscope.example')
    expect(isAppLink('https://app.learnscope.example/rate/abc', 'invite', 'preview.vercel.app')).toBe(true)
  })

  it('accepts http only for localhost', () => {
    expect(isAppLink('http://localhost:3000/rate/abc', 'invite', 'localhost:3000')).toBe(true)
    expect(isAppLink(`http://${HOST}/rate/abc`, 'invite', HOST)).toBe(false)
  })

  it('rejects links to other sites', () => {
    expect(isAppLink('https://evil.example/rate/abc', 'invite', HOST)).toBe(false)
    expect(isAppLink(`https://${HOST}.evil.example/rate/abc`, 'invite', HOST)).toBe(false)
    expect(isAppLink(`https://user@${HOST}/rate/abc`, 'invite', HOST)).toBe(false)
  })

  it('rejects the wrong page, extra path segments, query strings and fragments', () => {
    expect(isAppLink(`https://${HOST}/recommend/abc`, 'invite', HOST)).toBe(false)
    expect(isAppLink(`https://${HOST}/login`, 'invite', HOST)).toBe(false)
    expect(isAppLink(`https://${HOST}/rate/abc/../../login`, 'invite', HOST)).toBe(false)
    expect(isAppLink(`https://${HOST}/rate/abc?next=https://evil.example`, 'invite', HOST)).toBe(false)
    expect(isAppLink(`https://${HOST}/rate/abc#x`, 'invite', HOST)).toBe(false)
    expect(isAppLink(`https://${HOST}/validate-request/not-a-uuid`, 'validation_request', HOST)).toBe(false)
  })

  it('rejects malformed values and unknown types', () => {
    expect(isAppLink('not a url', 'invite', HOST)).toBe(false)
    expect(isAppLink('javascript:alert(1)', 'invite', HOST)).toBe(false)
    expect(isAppLink(`https://${HOST}/rate/abc`, 'constructor', HOST)).toBe(false)
  })
})
