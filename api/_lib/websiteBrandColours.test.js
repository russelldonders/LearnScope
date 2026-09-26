import { describe, expect, it, vi } from 'vitest'
import { extractWebsiteBrandColours, validatePublicWebsiteUrl } from './websiteBrandColours.js'

describe('website brand colour extraction', () => {
  it('prioritises declared theme and brand custom-property colours', () => {
    const html = `
      <meta name="theme-color" content="#1d428a">
      <style>.notice { color: rgb(255, 205, 0) }</style>
    `
    const css = `
      :root { --brand-primary: #1d428a; --brand-accent: #ffcd00; }
      .button { background-color: hsl(219, 65%, 33%); color: #fff; }
    `

    const colours = extractWebsiteBrandColours(html, [css])

    expect(colours[0].hex).toBe('#1d428a')
    expect(colours.map(({ hex }) => hex)).toContain('#ffcd00')
  })

  it('rejects private network destinations before fetching them', async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }])

    await expect(validatePublicWebsiteUrl('http://internal.example', lookup))
      .rejects.toThrow('not publicly reachable')
  })

  it('allows public websites', async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])

    await expect(validatePublicWebsiteUrl('https://example.com', lookup))
      .resolves.toMatchObject({ hostname: 'example.com' })
  })
})
