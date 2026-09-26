import { describe, expect, it } from 'vitest'
import {
  getBrandPaletteContrastChecks,
  recommendBrandPaletteFromPixels,
} from './brandPalette'

function pixels(colours) {
  return new Uint8ClampedArray(colours.flatMap(({ rgb, count }) => (
    Array.from({ length: count }, () => [...rgb, 255]).flat()
  )))
}

describe('recommendBrandPaletteFromPixels', () => {
  function expectWcagAaPalette(palette) {
    const failedChecks = getBrandPaletteContrastChecks(palette).filter((check) => !check.passes)
    expect(failedChecks, failedChecks.map((check) => `${check.role}: ${check.ratio}:1`).join(', ')).toEqual([])
  }

  it('turns dominant logo colours into a complete accessible brand palette', () => {
    const palette = recommendBrandPaletteFromPixels(pixels([
      { rgb: [35, 96, 190], count: 60 },
      { rgb: [240, 132, 25], count: 24 },
      { rgb: [255, 255, 255], count: 80 },
    ]))

    Object.values(palette).forEach((colour) => expect(colour).toMatch(/^#[0-9a-f]{6}$/))
    expectWcagAaPalette(palette)
    expect(palette.hover).not.toBe(palette.primary)
  })

  it('derives a tonal secondary colour for a single-colour logo', () => {
    const palette = recommendBrandPaletteFromPixels(pixels([
      { rgb: [15, 15, 15], count: 50 },
      { rgb: [255, 255, 255], count: 50 },
    ]))

    expect(palette.secondary).not.toBe(palette.primary)
    expectWcagAaPalette(palette)
  })

  it('prefers a smaller chromatic brand mark over a large neutral wordmark', () => {
    const palette = recommendBrandPaletteFromPixels(pixels([
      { rgb: [20, 20, 20], count: 160 },
      { rgb: [35, 96, 190], count: 24 },
    ]))

    const channels = [1, 3, 5].map((index) => Number.parseInt(palette.primary.slice(index, index + 2), 16))
    expect(Math.max(...channels) - Math.min(...channels)).toBeGreaterThan(20)
    expectWcagAaPalette(palette)
  })

  it('passes every WCAG AA pairing across the RGB colour space', () => {
    for (let red = 0; red <= 255; red += 51) {
      for (let green = 0; green <= 255; green += 51) {
        for (let blue = 0; blue <= 255; blue += 51) {
          if (red === 255 && green === 255 && blue === 255) continue
          const palette = recommendBrandPaletteFromPixels(pixels([
            { rgb: [red, green, blue], count: 40 },
          ]))
          expectWcagAaPalette(palette)
        }
      }
    }
  })

  it('uses a website action colour instead of darkening a bright logo accent', () => {
    const palette = recommendBrandPaletteFromPixels(
      pixels([{ rgb: [255, 205, 0], count: 100 }]),
      {
        websiteColours: [
          { hex: '#ffcd00', weight: 30 },
          { hex: '#1d428a', weight: 18 },
        ],
      },
    )

    const [red, green, blue] = [1, 3, 5].map((index) => Number.parseInt(palette.primary.slice(index, index + 2), 16))
    expect(blue).toBeGreaterThan(red)
    expect(blue).toBeGreaterThan(green)
    expect(palette.background).toMatch(/^#f[8-9a-f][f8-9a-f][f8-9a-f][f8-9a-f][f8-9a-f]$/i)
    expectWcagAaPalette(palette)
  })
})
