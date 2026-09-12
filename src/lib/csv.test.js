import { describe, expect, it } from 'vitest'
import { parseCsv, toCsv } from './csv'

describe('toCsv', () => {
  it('joins plain fields with commas and rows with CRLF', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\r\nc,d')
  })

  it('quotes a field containing a comma, quote, or newline', () => {
    expect(toCsv([['a,b', 'c"d', 'e\nf']])).toBe('"a,b","c""d","e\nf"')
  })

  it('renders null/undefined as an empty field', () => {
    expect(toCsv([[null, undefined, 'x']])).toBe(',,x')
  })
})

describe('parseCsv', () => {
  it('parses plain comma-separated rows', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('handles quoted fields containing commas and newlines', () => {
    expect(parseCsv('"a,b",c\n"d\ne",f')).toEqual([['a,b', 'c'], ['d\ne', 'f']])
  })

  it('unescapes doubled quotes inside a quoted field', () => {
    expect(parseCsv('"say ""hi""",b')).toEqual([['say "hi"', 'b']])
  })

  it('does not add a phantom trailing row for a file ending in a newline', () => {
    expect(parseCsv('a,b\n')).toEqual([['a', 'b']])
  })

  it('returns an empty array for an empty string', () => {
    expect(parseCsv('')).toEqual([])
  })
})
