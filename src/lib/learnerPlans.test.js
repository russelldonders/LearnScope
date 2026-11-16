import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  saveActivity: vi.fn(),
  deleteActivity: vi.fn(),
  calls: [],
  statementRow: null,
  updateError: null,
}))

vi.mock('./activitySkillLinks', () => ({ saveActivity: mocks.saveActivity }))
vi.mock('./activityEdits', () => ({ deleteActivity: mocks.deleteActivity }))
vi.mock('./skillGoals', () => ({ listActiveGoalsWithActivities: vi.fn() }))
vi.mock('./supabaseClient', () => ({
  supabase: {
    from: (table) => ({
      update: (values) => ({
        eq: (_column, id) => {
          mocks.calls.push(['update', table, values, id])
          return Promise.resolve({ error: mocks.updateError })
        },
      }),
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: mocks.statementRow, error: null }) }),
      }),
    }),
  },
}))

const { isUneditedPlanActivity, setItemDone } = await import('./learnerPlans')
const { PROVENANCE_EXTENSION_IRI, SKILL_EXTENSION_IRI } = await import('./xapiStatement')

const step = { id: 'item-1', item_type: 'step', step_title: 'Shadow a senior lead', step_skill: { id: 's1', name: 'Coaching' }, completion_statement_id: null, completed_on: null }
const resource = { id: 'item-2', item_type: 'skill_resource', skill_resources: { title: 'Style guide', skills: { id: 's2', name: 'Writing' } } }
const actor = { name: 'Sam', email: 'sam@example.com' }
const ticked = { ...step, completed_on: '2026-11-16', completion_statement_id: 'statement-1' }
const recorded = { id: 'statement-1', statement: { object: { definition: { name: { 'en-US': 'Shadow a senior lead' } } } } }

beforeEach(() => {
  mocks.calls = []
  mocks.statementRow = null
  mocks.updateError = null
  mocks.saveActivity.mockReset().mockResolvedValue({ id: 'statement-1' })
  mocks.deleteActivity.mockReset().mockImplementation(async () => { mocks.calls.push(['deleteActivity']) })
})

describe('setItemDone', () => {
  it('records a ticked step as an ordinary completed activity on its skill, and links the item to it', async () => {
    await setItemDone(step, true, { userId: 'me', actor })
    const { userId, statement, skillIds } = mocks.saveActivity.mock.calls[0][0]
    expect(userId).toBe('me')
    expect(skillIds).toEqual(['s1'])
    expect(statement.verb.id).toBe('http://adlnet.gov/expapi/verbs/completed')
    expect(statement.object.definition.name['en-US']).toBe('Shadow a senior lead')
    expect(statement.context.extensions[SKILL_EXTENSION_IRI]).toEqual([{ id: 's1', name: 'Coaching' }])
    // No import tag: the learner can edit it like any activity they logged.
    expect(statement.context.extensions[PROVENANCE_EXTENSION_IRI]).toBeUndefined()
    const [, table, values, id] = mocks.calls[0]
    expect(table).toBe('learner_plan_items')
    expect(id).toBe('item-1')
    expect(values.completion_statement_id).toBe('statement-1')
    expect(values.completed_on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('records a ticked resource on the resource\'s skill', async () => {
    await setItemDone(resource, true, { userId: 'me', actor })
    const { statement, skillIds } = mocks.saveActivity.mock.calls[0][0]
    expect(skillIds).toEqual(['s2'])
    expect(statement.object.definition.name['en-US']).toBe('Style guide')
  })

  it('records a step with no skill as an activity on no skill', async () => {
    await setItemDone({ ...step, step_skill: null }, true, { userId: 'me', actor })
    expect(mocks.saveActivity.mock.calls[0][0].skillIds).toEqual([])
  })

  it('records nothing more for an item already ticked', async () => {
    await setItemDone(ticked, true, { userId: 'me', actor })
    expect(mocks.saveActivity).not.toHaveBeenCalled()
    expect(mocks.calls).toEqual([])
  })

  it('takes the activity away again if the tick itself could not be saved', async () => {
    mocks.updateError = new Error('denied')
    await expect(setItemDone(step, true, { userId: 'me', actor })).rejects.toThrow('denied')
    expect(mocks.deleteActivity).toHaveBeenCalledWith({ id: 'statement-1' })
  })

  it('on untick, removes the recorded activity first and then clears the tick', async () => {
    mocks.statementRow = recorded
    await setItemDone(ticked, false, { userId: 'me', actor })
    expect(mocks.calls.map((call) => call[0])).toEqual(['deleteActivity', 'update'])
    expect(mocks.calls[1][2]).toEqual({ completed_on: null, completion_statement_id: null })
  })

  it('keeps an activity the learner has since edited', async () => {
    mocks.statementRow = { ...recorded, evidence_paths: ['me/x.png'] }
    await setItemDone(ticked, false, { userId: 'me', actor })
    expect(mocks.deleteActivity).not.toHaveBeenCalled()
    expect(mocks.calls[0][2]).toEqual({ completed_on: null, completion_statement_id: null })
  })

  it('leaves the item ticked if its activity could not be removed', async () => {
    mocks.statementRow = recorded
    mocks.deleteActivity.mockRejectedValue(new Error('offline'))
    await expect(setItemDone(ticked, false, { userId: 'me', actor })).rejects.toThrow('offline')
    expect(mocks.calls).toEqual([])
  })
})

describe('isUneditedPlanActivity', () => {
  it('recognises only the untouched activity this item points at', () => {
    expect(isUneditedPlanActivity(recorded, ticked)).toBe(true)
    expect(isUneditedPlanActivity(null, ticked)).toBe(false)
    expect(isUneditedPlanActivity({ ...recorded, id: 'another' }, ticked)).toBe(false)
    expect(isUneditedPlanActivity(recorded, step)).toBe(false)
    const renamed = { ...recorded, statement: { object: { definition: { name: { 'en-US': 'Shadowed Jo' } } } } }
    expect(isUneditedPlanActivity(renamed, ticked)).toBe(false)
    const described = { ...recorded, statement: { object: { definition: { name: { 'en-US': 'Shadow a senior lead' }, description: { 'en-US': 'Great day' } } } } }
    expect(isUneditedPlanActivity(described, ticked)).toBe(false)
    const timed = { ...recorded, statement: { ...recorded.statement, result: { duration: 'PT1H' } } }
    expect(isUneditedPlanActivity(timed, ticked)).toBe(false)
  })
})
