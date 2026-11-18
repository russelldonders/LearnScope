import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  saveActivity: vi.fn(),
  deleteActivity: vi.fn(),
  calls: [],
  statementRow: null,
  writeError: null,
}))

vi.mock('./activitySkillLinks', () => ({ saveActivity: mocks.saveActivity }))
vi.mock('./activityEdits', () => ({ deleteActivity: mocks.deleteActivity }))
vi.mock('./skillGoals', () => ({ listActiveGoalsWithActivities: vi.fn() }))
vi.mock('./supabaseClient', () => ({
  supabase: {
    from: (table) => ({
      // A tick is the learner's own row in learner_plan_item_progress (0303).
      insert: (values) => {
        mocks.calls.push(['insert', table, values])
        return Promise.resolve({ error: mocks.writeError })
      },
      delete: () => {
        const filters = {}
        const chain = {
          eq: (column, value) => {
            filters[column] = value
            if (Object.keys(filters).length === 2) {
              mocks.calls.push(['delete', table, filters])
              return Promise.resolve({ error: mocks.writeError })
            }
            return chain
          },
        }
        return chain
      },
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: mocks.statementRow, error: null }) }),
      }),
    }),
  },
}))

const { activityHasLearnerContent, isUneditedPlanActivity, setItemDone } = await import('./learnerPlans')
const { PLAN_EXTENSION_IRI, PROVENANCE_EXTENSION_IRI, SKILL_EXTENSION_IRI } = await import('./xapiStatement')

const step = { id: 'item-1', item_type: 'step', step_title: 'Shadow a senior lead', step_skill: { id: 's1', name: 'Coaching' }, completion_statement_id: null, completed_on: null }
const resource = { id: 'item-2', item_type: 'skill_resource', skill_resources: { title: 'Style guide', skills: { id: 's2', name: 'Writing' } } }
const actor = { name: 'Sam', email: 'sam@example.com' }
const ticked = { ...step, completed_on: '2026-11-16', completion_statement_id: 'statement-1' }
const recorded = { id: 'statement-1', statement: { object: { definition: { name: { 'en-US': 'Shadow a senior lead' } } } } }

beforeEach(() => {
  mocks.calls = []
  mocks.statementRow = null
  mocks.writeError = null
  mocks.saveActivity.mockReset().mockResolvedValue({ id: 'statement-1' })
  mocks.deleteActivity.mockReset().mockImplementation(async () => { mocks.calls.push(['deleteActivity']) })
})

describe('setItemDone', () => {
  it('records a ticked step as an ordinary completed activity on its skill, and the learner\'s own tick linked to it', async () => {
    await setItemDone(step, true, { userId: 'me', actor })
    const { userId, statement, skillIds } = mocks.saveActivity.mock.calls[0][0]
    expect(userId).toBe('me')
    expect(skillIds).toEqual(['s1'])
    expect(statement.verb.id).toBe('http://adlnet.gov/expapi/verbs/completed')
    expect(statement.object.definition.name['en-US']).toBe('Shadow a senior lead')
    expect(statement.context.extensions[SKILL_EXTENSION_IRI]).toEqual([{ id: 's1', name: 'Coaching' }])
    // No import tag: the learner can edit it like any activity they logged.
    expect(statement.context.extensions[PROVENANCE_EXTENSION_IRI]).toBeUndefined()
    const [kind, table, values] = mocks.calls[0]
    expect(kind).toBe('insert')
    expect(table).toBe('learner_plan_item_progress')
    expect(values.item_id).toBe('item-1')
    expect(values.user_id).toBe('me')
    expect(values.completion_statement_id).toBe('statement-1')
    expect(values.completed_on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('names the plan and step on the activity, so it can lead back to them', async () => {
    await setItemDone(step, true, { userId: 'me', actor, plan: { id: 'plan-1', title: 'Become a team lead' } })
    const { statement } = mocks.saveActivity.mock.calls[0][0]
    expect(statement.context.extensions[PLAN_EXTENSION_IRI]).toEqual({ id: 'plan-1', title: 'Become a team lead', itemId: 'item-1' })
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
    mocks.writeError = new Error('denied')
    await expect(setItemDone(step, true, { userId: 'me', actor })).rejects.toThrow('denied')
    expect(mocks.deleteActivity).toHaveBeenCalledWith({ id: 'statement-1' })
  })

  it('on untick, removes the recorded activity first and then clears the tick', async () => {
    mocks.statementRow = recorded
    await setItemDone(ticked, false, { userId: 'me', actor })
    expect(mocks.calls.map((call) => call[0])).toEqual(['deleteActivity', 'delete'])
    expect(mocks.calls[1].slice(1)).toEqual(['learner_plan_item_progress', { item_id: 'item-1', user_id: 'me' }])
  })

  it('keeps an activity the learner has since edited', async () => {
    mocks.statementRow = { ...recorded, evidence_paths: ['me/x.png'] }
    await setItemDone(ticked, false, { userId: 'me', actor })
    expect(mocks.deleteActivity).not.toHaveBeenCalled()
    expect(mocks.calls[0].slice(1)).toEqual(['learner_plan_item_progress', { item_id: 'item-1', user_id: 'me' }])
  })

  it('leaves the item ticked if its activity could not be removed', async () => {
    mocks.statementRow = recorded
    mocks.deleteActivity.mockRejectedValue(new Error('offline'))
    await expect(setItemDone(ticked, false, { userId: 'me', actor })).rejects.toThrow('offline')
    expect(mocks.calls).toEqual([])
  })
})

describe('marking a step done with a date, comment and evidence', () => {
  it('records them on the activity', async () => {
    const file = new File(['x'], 'photo.png', { type: 'image/png' })
    await setItemDone(step, true, {
      userId: 'me',
      actor,
      completedOn: '2026-11-10',
      comment: '  Sat in on two 1:1s  ',
      evidence: { evidenceUrl: ' https://example.com/notes ', files: [file] },
    })
    const { statement, evidence } = mocks.saveActivity.mock.calls[0][0]
    expect(statement.object.definition.description['en-US']).toBe('Sat in on two 1:1s')
    expect(statement.timestamp.slice(0, 10)).toBe(new Date('2026-11-10T12:00:00').toISOString().slice(0, 10))
    expect(evidence).toEqual({ evidenceUrl: 'https://example.com/notes', files: [file] })
    expect(mocks.calls[0][2].completed_on).toBe('2026-11-10')
  })

  it('sends no evidence when none was given', async () => {
    await setItemDone(step, true, { userId: 'me', actor, comment: '', evidence: { evidenceUrl: '  ', files: [] } })
    const { statement, evidence } = mocks.saveActivity.mock.calls[0][0]
    expect(evidence).toBeNull()
    expect(statement.object.definition.description).toBeUndefined()
  })

  it('removes an activity with the learner\'s comment only when they choose to', async () => {
    mocks.statementRow = { ...recorded, evidence_url: 'https://example.com/notes' }
    await setItemDone(ticked, false, { userId: 'me', actor, removeActivity: true })
    expect(mocks.deleteActivity).toHaveBeenCalledWith(mocks.statementRow)

    mocks.deleteActivity.mockClear()
    mocks.calls = []
    await setItemDone(ticked, false, { userId: 'me', actor, removeActivity: false })
    expect(mocks.deleteActivity).not.toHaveBeenCalled()
    expect(mocks.calls[0].slice(1)).toEqual(['learner_plan_item_progress', { item_id: 'item-1', user_id: 'me' }])
  })

  it('never removes an activity the item does not point at, even when asked', async () => {
    mocks.statementRow = { ...recorded, id: 'someone-else' }
    await setItemDone(ticked, false, { userId: 'me', actor, removeActivity: true })
    expect(mocks.deleteActivity).not.toHaveBeenCalled()
  })
})

describe('activityHasLearnerContent', () => {
  it('spots a comment or evidence', () => {
    expect(activityHasLearnerContent(recorded)).toBe(false)
    expect(activityHasLearnerContent(null)).toBe(false)
    expect(activityHasLearnerContent({ ...recorded, evidence_paths: ['me/x.png'] })).toBe(true)
    expect(activityHasLearnerContent({ ...recorded, evidence_url: 'https://example.com' })).toBe(true)
    expect(activityHasLearnerContent({ statement: { object: { definition: { name: { 'en-US': 'x' }, description: { 'en-US': 'Went well' } } } } })).toBe(true)
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
