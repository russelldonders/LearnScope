// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { signGrant, verifyGrant } from '../validate-skill.js'

const KEY = Buffer.from('test-key')
const NOW = 1_800_000_000_000
const payload = { sub: 'user-1', skillId: 'skill-1', level: 3, passed: true, feedback: 'Good.', exp: NOW + 60_000 }

describe('validation grants', () => {
  it('round-trips a signed, unexpired grant', () => {
    expect(verifyGrant(signGrant(payload, KEY), KEY, NOW)).toEqual(payload)
  })

  it('rejects an expired grant', () => {
    expect(verifyGrant(signGrant({ ...payload, exp: NOW - 1 }, KEY), KEY, NOW)).toBeNull()
  })

  it('rejects a grant signed with a different key', () => {
    expect(verifyGrant(signGrant(payload, Buffer.from('other-key')), KEY, NOW)).toBeNull()
  })

  it('rejects a tampered payload', () => {
    const [, signature] = signGrant(payload, KEY).split('.')
    const forged = Buffer.from(JSON.stringify({ ...payload, passed: true, level: 5 })).toString('base64url')
    expect(verifyGrant(`${forged}.${signature}`, KEY, NOW)).toBeNull()
  })

  it('rejects malformed values', () => {
    expect(verifyGrant(undefined, KEY, NOW)).toBeNull()
    expect(verifyGrant('', KEY, NOW)).toBeNull()
    expect(verifyGrant('abc', KEY, NOW)).toBeNull()
    expect(verifyGrant('a.b.c', KEY, NOW)).toBeNull()
  })
})
