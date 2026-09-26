import { describe, expect, it } from 'vitest'
import { orgBrandStyle } from './orgBranding'

describe('orgBrandStyle', () => {
  it('pins white action text only when a custom primary colour is present', () => {
    expect(orgBrandStyle({ primaryColor: '#213a8f', textColor: '#081022' })).toMatchObject({
      '--org-primary': '#213a8f',
      '--org-text': '#081022',
      '--org-primary-contrast': '#ffffff',
    })
    expect(orgBrandStyle({})['--org-primary-contrast']).toBeUndefined()
  })
})
