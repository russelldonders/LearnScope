import { describe, expect, it } from 'vitest'
import {
  buildFilterCss,
  meaningfulEdit,
  normalizeVideoEdit,
  overlayTransform,
  pinchTransform,
  presetFilter,
  presetIdFor,
  shiftRange,
  snapToCentre,
  stepPreset,
} from './videoEdit'

describe('filter presets', () => {
  it('names the preset a filter matches, and none once it is fine-tuned', () => {
    expect(presetIdFor(undefined)).toBe('original')
    expect(presetIdFor(presetFilter('mono'))).toBe('mono')
    expect(presetIdFor({ ...presetFilter('mono'), brightness: 101 })).toBeNull()
  })

  it('steps through presets either way, wrapping round', () => {
    expect(stepPreset(presetFilter('original'), 1)).toBe('vivid')
    expect(stepPreset(presetFilter('original'), -1)).toBe('noir')
    expect(stepPreset({ brightness: 77 }, 1)).toBe('vivid')
  })

  it('includes the hue turn in the CSS filter, defaulting to none', () => {
    expect(buildFilterCss(null)).toContain('hue-rotate(0deg)')
    expect(buildFilterCss(presetFilter('cool'))).toContain('hue-rotate(12deg)')
  })
})

describe('sound', () => {
  it('is on unless an edit turned it off', () => {
    expect(normalizeVideoEdit(null).muted).toBe(false)
    expect(normalizeVideoEdit({ muted: true }).muted).toBe(true)
  })
})

describe('overlay gestures', () => {
  it('places an overlay saved before scale and rotation as it was', () => {
    expect(overlayTransform({ x: 50, y: 50 })).toBe('translate(-50%, -50%) rotate(0deg) scale(1)')
  })

  it('snaps to the centre lines when close to them', () => {
    expect(snapToCentre(51.5, 20)).toEqual({ x: 50, y: 20, guides: { vertical: true, horizontal: false } })
    expect(snapToCentre(60, 48)).toEqual({ x: 60, y: 50, guides: { vertical: false, horizontal: true } })
  })

  it('scales with the distance between two fingers and turns with their angle', () => {
    const start = [{ x: 0, y: 0 }, { x: 100, y: 0 }]
    expect(pinchTransform(start, [{ x: 0, y: 0 }, { x: 200, y: 0 }])).toEqual({ scale: 2, rotation: 0 })
    expect(pinchTransform(start, [{ x: 0, y: 0 }, { x: 0, y: 100 }], 1, 10)).toEqual({ scale: 1, rotation: 100 })
    expect(pinchTransform(start, [{ x: 0, y: 0 }, { x: 1000, y: 0 }]).scale).toBe(4)
  })

  it('moves a time range without changing its length or leaving the video', () => {
    expect(shiftRange(2, 5, 1, 10)).toEqual({ start: 3, end: 6 })
    expect(shiftRange(2, 5, 20, 10)).toEqual({ start: 7, end: 10 })
    expect(shiftRange(2, 5, -5, 10)).toEqual({ start: 0, end: 3 })
  })
})

describe('meaningfulEdit', () => {
  it('is nothing for an untouched recording, and the edit otherwise', () => {
    const untouched = normalizeVideoEdit(null, 12)
    expect(meaningfulEdit(untouched, 12)).toBeNull()
    expect(meaningfulEdit({ ...untouched, muted: true }, 12)).toMatchObject({ muted: true })
    expect(meaningfulEdit({ ...untouched, trimStart: 1 }, 12)).not.toBeNull()
  })
})
