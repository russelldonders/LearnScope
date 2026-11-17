import { describe, expect, it } from 'vitest'
import { summarisePrerequisites } from './planSettings'

const option = (id, met) => ({ id, kind: 'skill', met })

describe('summarisePrerequisites', () => {
  it('needs every group, and any one option within a group', () => {
    const summary = summarisePrerequisites([
      { id: 'g1', enforcement: 'required', options: [option('a', false), option('b', true)] },
      { id: 'g2', enforcement: 'guidance', options: [option('c', false)] },
    ])
    expect(summary.groups.map((group) => group.met)).toEqual([true, false])
    expect(summary.allMet).toBe(false)
    expect(summary.blocked).toBe(false)
  })

  it('blocks only while a required group is unmet', () => {
    expect(summarisePrerequisites([{ id: 'g1', enforcement: 'required', options: [option('a', false)] }]).blocked).toBe(true)
    expect(summarisePrerequisites([{ id: 'g1', enforcement: 'guidance', options: [option('a', false)] }]).blocked).toBe(false)
  })

  it('ignores a group with nothing in it', () => {
    const summary = summarisePrerequisites([{ id: 'g1', enforcement: 'required', options: [] }])
    expect(summary).toMatchObject({ any: false, allMet: true, blocked: false })
  })
})
