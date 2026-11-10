import { describe, expect, it, vi } from 'vitest'

const remove = vi.fn(() => Promise.resolve({ error: null }))
const deleted = vi.fn(() => Promise.resolve({ data: [{ id: 'a' }], error: null }))
vi.mock('./supabaseClient', () => ({
  supabase: {
    from: () => ({ delete: () => ({ eq: () => ({ select: deleted }) }) }),
    storage: { from: () => ({ remove }) },
  },
}))

const { activityEditFields, applyActivityEdit, canEditActivity, deleteActivity } = await import('./activityEdits')
const { DIAGNOSTIC_EXTENSION_IRI, PROVENANCE_EXTENSION_IRI, buildStatement, durationMinutes, measurementsFromStatement } = await import('./xapiStatement')

const fitness = { id: 'fit', name: 'Fitness' }
const actor = { name: 'Me', email: 'me@example.com' }

function row(overrides = {}, statementOverrides = {}) {
  const statement = buildStatement({
    actor,
    verbValue: 'practiced',
    activityName: 'Sit-ups',
    description: 'Felt good',
    timestamp: '2026-11-09T18:30:00.000Z',
    relatedSkills: [fitness],
    durationHours: 0,
    durationMinutes: 10,
    measurements: [{ metric: 'sit_ups', kind: 'count', unit: 'sit-ups', value: 100 }, { metric: 'plank', kind: 'duration', unit: 'seconds', value: 60 }],
  })
  return { id: 'a', resource_id: null, recorded_at: '2026-11-09T18:30:00.000Z', evidence_paths: [], statement: { ...statement, ...statementOverrides }, ...overrides }
}

describe('which activities can be edited', () => {
  it('is the ones the learner logged, not course records, imports or check-ins', () => {
    expect(canEditActivity(row())).toBe(true)
    expect(canEditActivity(row({ resource_id: 'course' }))).toBe(false)
    expect(canEditActivity(row({}, { context: { extensions: { [PROVENANCE_EXTENSION_IRI]: { source: 'strava' } } } }))).toBe(false)
    expect(canEditActivity(row({}, { result: { extensions: { [DIAGNOSTIC_EXTENSION_IRI]: {} } } }))).toBe(false)
  })
})

describe('editing an activity', () => {
  it('starts from what was saved, offering counted values but not times', () => {
    const fields = activityEditFields(row())
    expect(fields).toMatchObject({ title: 'Sit-ups', verb: 'practiced', minutes: '10', hours: '', note: 'Felt good' })
    expect(fields.values).toEqual([{ index: 0, metric: 'sit_ups', kind: 'count', unit: 'sit-ups', value: '100' }])
  })

  it('saves the changes, keeping what a changed value said before', () => {
    const original = row()
    const fields = { ...activityEditFields(original), title: 'Sit-ups (evening)', verb: 'experienced', minutes: '', note: '', values: [{ ...activityEditFields(original).values[0], value: '120' }] }
    const { statement, recordedAt } = applyActivityEdit(original, fields, '2026-11-11')
    expect(statement.object.definition.name['en-US']).toBe('Sit-ups (evening)')
    expect(statement.object.definition.description).toBeUndefined()
    expect(statement.verb.id).toBe('http://adlnet.gov/expapi/verbs/experienced')
    expect(durationMinutes(statement)).toBe(0)
    const [situps, plank] = measurementsFromStatement(statement)
    expect(situps).toMatchObject({ value: 120, corrections: [expect.objectContaining({ value: 100 })] })
    expect(plank).toMatchObject({ value: 60 })
    expect(plank.corrections).toBeUndefined()
    // Same day: the original time stays, so the day's order doesn't change.
    expect(recordedAt).toBe('2026-11-09T18:30:00.000Z')
    expect(statement.object.id).toBe(original.statement.object.id)
  })

  it('moves the activity to another day when its date changes', () => {
    const original = row()
    const { recordedAt } = applyActivityEdit(original, { ...activityEditFields(original), date: '2026-11-07' }, '2026-11-11')
    expect(recordedAt.slice(0, 10)).toBe(new Date('2026-11-07T12:00:00').toISOString().slice(0, 10))
  })

  it('refuses an empty name, a future date, a bad duration or a part-number count', () => {
    const original = row()
    const base = activityEditFields(original)
    expect(applyActivityEdit(original, { ...base, title: ' ' }, '2026-11-11').error).toBe('activity.edit.errorTitle')
    expect(applyActivityEdit(original, { ...base, date: '2026-11-12' }, '2026-11-11').error).toBe('activity.edit.errorDate')
    expect(applyActivityEdit(original, { ...base, minutes: '75' }, '2026-11-11').error).toBe('activity.edit.errorDuration')
    expect(applyActivityEdit(original, { ...base, values: [{ ...base.values[0], value: '2.5' }] }, '2026-11-11').error).toBe('skillGoals.errorWholeNumber')
  })
})

describe('deleting an activity', () => {
  it('removes the activity and its attached files', async () => {
    await deleteActivity(row({ evidence_paths: ['me/fit/a/photo.jpg'] }))
    expect(deleted).toHaveBeenCalled()
    expect(remove).toHaveBeenCalledWith(['me/fit/a/photo.jpg'])
  })

  it('says so when nothing was deleted', async () => {
    deleted.mockResolvedValueOnce({ data: [], error: null })
    await expect(deleteActivity(row())).rejects.toThrow("couldn't be deleted")
  })
})
