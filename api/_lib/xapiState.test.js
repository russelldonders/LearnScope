import { beforeEach, describe, expect, it } from 'vitest'
import { bodyText, handleState } from './xapiState.js'

// A small in-memory xapi_activity_state, enough for the handler's queries.
function fakeAdmin(rows) {
  function query() {
    const filters = []
    let op = 'select'
    let payload = null
    let head = false
    const matches = (row) => filters.every((f) => f(row))
    const run = () => {
      const hit = rows.filter(matches)
      if (op === 'delete') {
        for (const row of hit) rows.splice(rows.indexOf(row), 1)
        return { data: null, error: null }
      }
      if (op === 'update') {
        for (const row of hit) Object.assign(row, payload)
        return { data: null, error: null }
      }
      if (op === 'insert') {
        rows.push({ id: `row-${rows.length + 1}`, updated_at: new Date().toISOString(), ...payload })
        return { data: null, error: null }
      }
      return head ? { count: hit.length, error: null } : { data: hit, error: null }
    }
    const builder = {
      select: (_cols, opts) => { head = Boolean(opts?.head); return builder },
      insert: (value) => { op = 'insert'; payload = value; return builder },
      update: (value) => { op = 'update'; payload = value; return builder },
      delete: () => { op = 'delete'; return builder },
      eq: (col, value) => { filters.push((row) => row[col] === value); return builder },
      is: (col, value) => { filters.push((row) => (row[col] ?? null) === value); return builder },
      gt: (col, value) => { filters.push((row) => row[col] > value); return builder },
      maybeSingle: () => Promise.resolve({ data: rows.filter(matches)[0] ?? null, error: null }),
      then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
    }
    return builder
  }
  return { from: () => query() }
}

function fakeRes() {
  const res = { statusCode: null, headers: {}, body: undefined }
  res.status = (code) => { res.statusCode = code; return res }
  res.setHeader = (key, value) => { res.headers[key.toLowerCase()] = value }
  res.json = (value) => { res.body = value; return res }
  res.send = (value) => { res.body = value; return res }
  res.end = () => res
  return res
}

const REG = '11111111-2222-3333-4444-555555555555'
const session = { user_id: 'learner', skill_resource_id: 'pkg-1', resource_id: null }
const req = (method, query, body, contentType = 'application/json') => ({
  method,
  query: { activityId: 'https://example.com/course', registration: REG, ...query },
  headers: { 'content-type': contentType },
  body,
})

let rows
let admin
beforeEach(() => {
  rows = []
  admin = fakeAdmin(rows)
})

async function call(r) {
  const res = fakeRes()
  await handleState(admin, session, r, res)
  return res
}

describe('xAPI State API', () => {
  it('saves a document and gives it back on the next launch, as stored', async () => {
    expect((await call(req('PUT', { stateId: 'bookmark' }, 'slide-12', 'text/plain'))).statusCode).toBe(204)
    const res = await call(req('GET', { stateId: 'bookmark' }))
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('slide-12')
    expect(rows[0]).toMatchObject({ user_id: 'learner', skill_resource_id: 'pkg-1', registration: REG, state_id: 'bookmark' })
  })

  it('never serves a document as something a browser would render, whatever type the package claimed', async () => {
    await call(req('PUT', { stateId: 'page' }, '<script>steal()</script>', 'text/html'))
    const html = await call(req('GET', { stateId: 'page' }))
    expect(html.body).toBe('<script>steal()</script>')
    expect(html.headers['content-type']).toBe('application/octet-stream')
    expect(html.headers['content-disposition']).toBe('attachment')
    expect(html.headers['content-security-policy']).toBe("sandbox; default-src 'none'")
    expect(html.headers['x-content-type-options']).toBe('nosniff')

    await call(req('PUT', { stateId: 'json' }, { slide: 3 }, 'image/svg+xml'))
    expect((await call(req('GET', { stateId: 'json' }))).headers['content-type']).toBe('application/json; charset=utf-8')
  })

  it('keeps it to the learner and package of the launch, whatever agent the package names', async () => {
    await call(req('PUT', { stateId: 'stamps', agent: '{"name":"someone else"}' }, { gold: true }))
    const otherPackage = fakeRes()
    await handleState(admin, { ...session, skill_resource_id: 'pkg-2' }, req('GET', { stateId: 'stamps' }), otherPackage)
    expect(otherPackage.statusCode).toBe(404)
    const otherLearner = fakeRes()
    await handleState(admin, { ...session, user_id: 'someone' }, req('GET', { stateId: 'stamps' }), otherLearner)
    expect(otherLearner.statusCode).toBe(404)
  })

  it('merges a POSTed JSON object into the stored one, and replaces with PUT', async () => {
    await call(req('PUT', { stateId: 'stamps' }, { gold: true, silver: false }))
    await call(req('POST', { stateId: 'stamps' }, { silver: true, bronze: true }))
    expect(JSON.parse((await call(req('GET', { stateId: 'stamps' }))).body)).toEqual({ gold: true, silver: true, bronze: true })
    await call(req('PUT', { stateId: 'stamps' }, { only: 1 }))
    expect(JSON.parse((await call(req('GET', { stateId: 'stamps' }))).body)).toEqual({ only: 1 })
  })

  it('lists the saved state ids, and deletes one or all of them', async () => {
    await call(req('PUT', { stateId: 'a' }, 'x', 'text/plain'))
    await call(req('PUT', { stateId: 'b' }, 'y', 'text/plain'))
    expect((await call(req('GET', {}))).body).toEqual(['a', 'b'])
    await call(req('DELETE', { stateId: 'a' }))
    expect((await call(req('GET', {}))).body).toEqual(['b'])
    await call(req('DELETE', {}))
    expect((await call(req('GET', {}))).body).toEqual([])
  })

  it('keeps state saved without a registration apart from state saved with one', async () => {
    await call(req('PUT', { stateId: 'a', registration: '' }, 'none', 'text/plain'))
    expect((await call(req('GET', { stateId: 'a' }))).statusCode).toBe(404)
    expect((await call(req('GET', { stateId: 'a', registration: '' }))).body).toBe('none')
  })

  it('turns away a request without an activity, a bad registration, or a write without a state id', async () => {
    expect((await call(req('GET', { activityId: '' }))).statusCode).toBe(400)
    expect((await call(req('GET', { registration: 'not-a-uuid' }))).statusCode).toBe(400)
    expect((await call(req('PUT', {}, 'x', 'text/plain'))).statusCode).toBe(400)
    expect(rows).toHaveLength(0)
  })

  it('refuses a document over 256KB', async () => {
    const res = await call(req('PUT', { stateId: 'big' }, 'x'.repeat(256 * 1024 + 1), 'text/plain'))
    expect(res.statusCode).toBe(413)
    expect(rows).toHaveLength(0)
  })

  it('reads the body as text however the runtime parsed it', () => {
    expect(bodyText(undefined)).toBe('')
    expect(bodyText('abc')).toBe('abc')
    expect(bodyText(Buffer.from('buf'))).toBe('buf')
    expect(bodyText({ a: 1 })).toBe('{"a":1}')
  })

  it('reports a package over its saved-state limit, which the database enforces', async () => {
    const limited = {
      from: () => {
        const builder = {
          select: () => builder, eq: () => builder, is: () => builder,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          insert: () => Promise.resolve({ error: { code: '23514', message: 'over limit' } }),
        }
        return builder
      },
    }
    const res = fakeRes()
    await handleState(limited, session, req('PUT', { stateId: 'one-too-many' }, 'x', 'text/plain'), res)
    expect(res.statusCode).toBe(413)
  })
})
