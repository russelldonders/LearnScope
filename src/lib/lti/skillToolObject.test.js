import { describe, expect, it } from 'vitest'
import { buildSkillLtiResourceLink, createSkillLtiObject } from './skillToolObject'
const input = {
  id: '00000000-0000-0000-0000-000000000001',
  skillLibraryId: '00000000-0000-0000-0000-000000000002',
  organisationId: '00000000-0000-0000-0000-000000000003',
  title: '  SQL skill development  ',
  description: ' Practise and review your SQL development. ',
  targetLevel: 3,
}
describe('skill LTI preparation contract', () => {
  it('creates a draft catalogue-backed object without copying personal records', () => {
    const object = createSkillLtiObject({ ...input, learnerId: 'private-user', assessments: ['private'], status: 'published' })
    expect(object).toEqual({ schemaVersion: 1, kind: 'skill-detail', status: 'draft', ...input, title: input.title.trim(), description: input.description.trim() })
    expect(object).not.toHaveProperty('learnerId')
    expect(object).not.toHaveProperty('assessments')
  })
  it('creates a Deep Linking resource item with only the opaque object identity', () => {
    expect(buildSkillLtiResourceLink(input, 'https://tools.example.org')).toEqual({
      type: 'ltiResourceLink', title: input.title.trim(), text: input.description.trim(),
      url: 'https://tools.example.org/lti/resources/00000000-0000-0000-0000-000000000001',
      custom: { learnscope_resource_id: input.id },
    })
  })
  it.each(['http://tools.example.org', 'javascript:alert(1)', 'https://user:password@tools.example.org', 'https://tools.example.org/path', 'https://tools.example.org?token=x', 'https://tools.example.org#token', 'not-a-url'])('rejects invalid tool origin %s', (origin) => {
    expect(() => buildSkillLtiResourceLink(input, origin)).toThrow(/origin/)
  })
  it.each([0, 6, 1.5, '3'])('rejects invalid target level %s', (targetLevel) => {
    expect(() => createSkillLtiObject({ ...input, targetLevel })).toThrow(/Target level/)
  })
  it.each(['id', 'skillLibraryId', 'organisationId'])('requires a valid %s', (field) => {
    expect(() => createSkillLtiObject({ ...input, [field]: '../private-record' })).toThrow(/UUID/)
  })
  it('rejects a blank title', () => { expect(() => createSkillLtiObject({ ...input, title: ' ' })).toThrow(/Title/) })
  it('omits optional description and accepts an unspecified target', () => {
    const object = createSkillLtiObject({ ...input, targetLevel: null, description: '' })
    expect(buildSkillLtiResourceLink(object, 'https://tools.example.org/')).not.toHaveProperty('text')
    expect(object.targetLevel).toBeNull()
  })
})
