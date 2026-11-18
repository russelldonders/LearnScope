import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => [])
const state = vi.hoisted(() => ({ error: null }))

vi.mock('./supabaseClient', () => ({
  supabase: {
    rpc: vi.fn((name, args) => {
      calls.push({ name, args })
      return Promise.resolve({ error: state.error })
    }),
  },
}))

import { savePositions } from './learnerPlans'

beforeEach(() => {
  calls.splice(0)
  state.error = null
})

describe('savePositions', () => {
  it('saves a plan item order in one call, in position order', async () => {
    await savePositions('learner_plan_items', [
      { id: 'item-b', position: 1 },
      { id: 'item-a', position: 0 },
      { id: 'item-c', position: 2 },
    ])
    expect(calls).toEqual([{ name: 'reorder_learner_plan_items', args: { p_item_ids: ['item-a', 'item-b', 'item-c'] } }])
  })

  it('saves a section order in one call', async () => {
    await savePositions('learner_plan_sections', [{ id: 's1', position: 0 }, { id: 's2', position: 1 }])
    expect(calls).toEqual([{ name: 'reorder_learner_plan_sections', args: { p_section_ids: ['s1', 's2'] } }])
  })

  it('reports a failed save', async () => {
    state.error = { message: 'Not allowed' }
    await expect(savePositions('learner_plan_items', [{ id: 'a', position: 0 }])).rejects.toEqual({ message: 'Not allowed' })
  })

  it('refuses a table it cannot reorder', async () => {
    await expect(savePositions('learner_plans', [])).rejects.toThrow("Can't reorder learner_plans.")
    expect(calls).toHaveLength(0)
  })
})
