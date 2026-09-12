import { describe, expect, it } from 'vitest'
import { buildRosterCsvTemplate, parseRosterCsv } from './employerRosterCsv'

const FIELDS = [
  { id: 'f1', key: 'first_name', label: 'First name', required: true },
  { id: 'f2', key: 'last_name', label: 'Last name', required: true },
  { id: 'f3', key: 'email', label: 'Email', required: true },
  { id: 'f4', key: 'department', label: 'Department', required: false },
]

describe('buildRosterCsvTemplate', () => {
  it('emits one header column per field, in order', () => {
    expect(buildRosterCsvTemplate(FIELDS)).toBe('First name,Last name,Email,Department')
  })
})

describe('parseRosterCsv', () => {
  it('maps columns to fields by header label and validates required fields', () => {
    const csv = 'First name,Last name,Email,Department\nJane,Smith,jane@co.com,Sales\nJohn,,john@co.com,'
    const { rows, unmatchedHeaders } = parseRosterCsv(csv, FIELDS)
    expect(unmatchedHeaders).toEqual([])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ rowNumber: 2, values: { f1: 'Jane', f2: 'Smith', f3: 'jane@co.com', f4: 'Sales' }, errors: [] })
    expect(rows[1].rowNumber).toBe(3)
    expect(rows[1].errors).toEqual(['"Last name" is required'])
  })

  it('matches headers by key when the label does not match', () => {
    const csv = 'first_name,last_name,email,department\nJane,Smith,jane@co.com,Sales'
    const { rows, unmatchedHeaders } = parseRosterCsv(csv, FIELDS)
    expect(unmatchedHeaders).toEqual([])
    expect(rows[0].values).toEqual({ f1: 'Jane', f2: 'Smith', f3: 'jane@co.com', f4: 'Sales' })
  })

  it('reports an unrecognized header without failing the whole parse', () => {
    const csv = 'First name,Nickname\nJane,Janey'
    const { rows, unmatchedHeaders } = parseRosterCsv(csv, FIELDS)
    expect(unmatchedHeaders).toEqual(['Nickname'])
    expect(rows[0].values).toEqual({ f1: 'Jane' })
    expect(rows[0].errors).toContain('"Last name" is required')
  })

  it('skips a fully blank trailing row', () => {
    const csv = 'First name,Last name,Email,Department\nJane,Smith,jane@co.com,Sales\n\n'
    const { rows } = parseRosterCsv(csv, FIELDS)
    expect(rows).toHaveLength(1)
  })

  it('returns no rows for an empty file', () => {
    expect(parseRosterCsv('', FIELDS)).toEqual({ rows: [], unmatchedHeaders: [] })
  })
})
