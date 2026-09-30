import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ inserts: [], updates: [], uploads: [] }))

vi.mock('./supabaseClient', () => ({
  supabase: {
    from: (table) => ({
      insert: (row) => {
        calls.inserts.push({ table, row })
        const result = { data: { id: 'statement-1', ...row }, error: null }
        return { select: () => ({ single: async () => result }), then: (resolve) => resolve({ error: null }) }
      },
      update: (patch) => ({
        eq: async (column, value) => { calls.updates.push({ table, patch, column, value }); return { error: null } },
      }),
    }),
  },
}))

vi.mock('./skillEvidence', () => ({
  uploadEvidenceFiles: async (userId, skillId, statementId, files) => {
    calls.uploads.push({ userId, skillId, statementId, count: files.length })
    return files.map((_, i) => `${userId}/${skillId}/${statementId}-${i}`)
  },
}))

const { saveActivity } = await import('./activitySkillLinks')

const statement = { timestamp: '2026-09-01T10:00:00Z', verb: { id: 'x' } }

beforeEach(() => {
  calls.inserts = []
  calls.updates = []
  calls.uploads = []
})

describe('saveActivity', () => {
  it('saves the statement with its primary skill and experience, then links every related skill', async () => {
    await saveActivity({ userId: 'u1', statement, evidence: { evidenceUrl: 'https://x.test' }, skillIds: ['s1', 's2'], experienceId: 'e1' })
    expect(calls.inserts[0]).toEqual({
      table: 'xapi_statements',
      row: { user_id: 'u1', statement, recorded_at: statement.timestamp, skill_id: 's1', experience_id: 'e1', evidence_url: 'https://x.test' },
    })
    expect(calls.inserts[1].table).toBe('xapi_statement_skills')
    expect(calls.inserts[1].row.map((r) => r.skill_id)).toEqual(['s1', 's2'])
    expect(calls.uploads).toEqual([])
  })

  it('files evidence under the primary skill and records the paths on the statement', async () => {
    await saveActivity({ userId: 'u1', statement, evidence: { files: [{}, {}] }, skillIds: ['s1'] })
    expect(calls.uploads).toEqual([{ userId: 'u1', skillId: 's1', statementId: 'statement-1', count: 2 }])
    expect(calls.updates[0]).toMatchObject({ table: 'xapi_statements', patch: { evidence_paths: ['u1/s1/statement-1-0', 'u1/s1/statement-1-1'] }, value: 'statement-1' })
  })

  it('keeps evidence in the owner\'s own area when the activity has no skill', async () => {
    await saveActivity({ userId: 'u1', statement, evidence: { files: [{}] }, skillIds: [] })
    expect(calls.inserts[0].row.skill_id).toBeNull()
    expect(calls.uploads[0].skillId).toBe('unlinked')
  })
})
