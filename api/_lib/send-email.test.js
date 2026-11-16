import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAppLink, planInviteEmail } from '../send-email.js'

// A stand-in for the service-role client: one row per table, looked up by
// the last .eq() value.
function fakeAdmin(rows) {
  return {
    from(table) {
      const query = {
        select: () => query,
        eq: (column, value) => { query.match = rows[table]?.[column] === value ? rows[table] : null; return query },
        maybeSingle: async () => ({ data: query.match ?? null }),
      }
      return query
    },
  }
}

describe('planInviteEmail', () => {
  const rows = {
    learner_plan_invitations: { share_code: 'abc', invitee_email: 'cat@example.com', inviter_id: 'me', via: 'email', status: 'pending', source_plan_id: 'p1' },
    learner_plans: { id: 'p1', title: 'Learn to present' },
  }
  const url = 'https://learnscope.example.com/plan-invite/abc'

  it('sends to the invited address with the plan’s own title', async () => {
    expect(await planInviteEmail(fakeAdmin(rows), 'me', url)).toEqual({ toEmail: 'cat@example.com', title: 'Learn to present' })
  })

  it('refuses someone else’s invitation, a used one, or an unknown code', async () => {
    expect(await planInviteEmail(fakeAdmin(rows), 'someone-else', url)).toBeNull()
    const used = { ...rows, learner_plan_invitations: { ...rows.learner_plan_invitations, status: 'accepted' } }
    expect(await planInviteEmail(fakeAdmin(used), 'me', url)).toBeNull()
    expect(await planInviteEmail(fakeAdmin(rows), 'me', 'https://learnscope.example.com/plan-invite/zzz')).toBeNull()
  })
})

const HOST = 'learnscope.example.com'
const REQUEST_ID = '0f8fad5b-d9cb-469f-a165-70867728950e'

describe('isAppLink', () => {
  afterEach(() => vi.unstubAllEnvs())

  it("accepts each email type's own page on the request's host", () => {
    expect(isAppLink(`https://${HOST}/rate/abc123`, 'invite', HOST)).toBe(true)
    expect(isAppLink(`https://${HOST}/recommend/abc-123_x`, 'recommend', HOST)).toBe(true)
    expect(isAppLink(`https://${HOST}/validate-request/${REQUEST_ID}`, 'validation_request', HOST)).toBe(true)
    expect(isAppLink(`https://${HOST}/plan-invite/abc123`, 'plan_invite', HOST)).toBe(true)
  })

  it('only accepts a plan invitation page for a plan invitation email', () => {
    expect(isAppLink(`https://${HOST}/rate/abc123`, 'plan_invite', HOST)).toBe(false)
    expect(isAppLink(`https://${HOST}/plan-invite/abc123`, 'invite', HOST)).toBe(false)
    expect(isAppLink(`https://${HOST}/plan-invite/abc/extra`, 'plan_invite', HOST)).toBe(false)
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
