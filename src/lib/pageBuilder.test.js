import { describe, expect, it } from 'vitest'
import { normalisePageDocument, sanitiseRichText } from './pageBuilder'

describe('page builder content', () => {
  it('keeps supported formatting and removes executable markup', () => {
    expect(sanitiseRichText('<strong>Safe</strong><img src=x onerror=alert(1)><script>bad()</script>')).toBe(
      '<strong>Safe</strong>bad()'
    )
  })

  it('normalises unknown blocks to safe text blocks', () => {
    const result = normalisePageDocument({ version: 99, blocks: [{ id: 'one', type: 'embed', content: '<b>Hi</b>' }] })
    expect(result).toEqual({ version: 1, blocks: [{ id: 'one', type: 'text', content: '<b>Hi</b>' }] })
  })
})
