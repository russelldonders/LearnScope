import { describe, expect, it } from 'vitest'
import { contrastRatio, recommendBrandPaletteFromPixels } from './brandPalette'

function pixels(colours) {
  return new Uint8ClampedArray(colours.flatMap(({ rgb, count }) => (
    Array.from({ length: count }, () => [...rgb, 255]).flat()
  )))
}

describe('recommendBrandPaletteFromPixels', () => {
  it('turns dominant logo colours into a complete accessible brand palette', () => {
    const palette = recommendBrandPaletteFromPixels(pixels([
      { rgb: [35, 96, 190], count: 60 },
      { rgb: [240, 132, 25], count: 24 },
      { rgb: [255, 255, 255], count: 80 },
    ]))

    Object.values(palette).forEach((colour) => expect(colour).toMatch(/^#[0-9a-f]{6}$/))
    expect(contrastRatio(palette.primary, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(palette.primary, palette.background)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(palette.secondary, palette.background)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(palette.text, palette.background)).toBeGreaterThanOrEqual(7)
    expect(palette.hover).not.toBe(palette.primary)
  })

  it('derives a tonal secondary colour for a single-colour logo', () => {
    const palette = recommendBrandPaletteFromPixels(pixels([
      { rgb: [15, 15, 15], count: 50 },
      { rgb: [255, 255, 255], count: 50 },
    ]))

    expect(palette.secondary).not.toBe(palette.primary)
    expect(contrastRatio(palette.text, palette.background)).toBeGreaterThanOrEqual(7)
  })

  it('prefers a smaller chromatic brand mark over a large neutral wordmark', () => {
    const palette = recommendBrandPaletteFromPixels(pixels([
      { rgb: [20, 20, 20], count: 160 },
      { rgb: [35, 96, 190], count: 24 },
    ]))

    const channels = [1, 3, 5].map((index) => Number.parseInt(palette.primary.slice(index, index + 2), 16))
    expect(Math.max(...channels) - Math.min(...channels)).toBeGreaterThan(20)
  })
})
