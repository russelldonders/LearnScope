import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function listApiFunctions(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return entry.name === '_lib' ? [] : listApiFunctions(path)
    return entry.name.endsWith('.js') ? [path] : []
  })
}

describe('Vercel deployment budget', () => {
  it('keeps direct API functions within the Hobby plan limit', () => {
    expect(listApiFunctions(resolve('api'))).toHaveLength(12)
  })

  it('routes course generation through the shared dispatcher', () => {
    const config = JSON.parse(readFileSync(resolve('vercel.json'), 'utf8'))
    expect(config.routes).toContainEqual({
      src: '/api/generate-course-draft',
      dest: '/api/admin/actions?ai=generate-course-draft',
    })
  })
})
