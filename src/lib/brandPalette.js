const SAMPLE_EDGE = 96
const MIN_PIXEL_ALPHA = 160
const WHITE = '#ffffff'
const WHITE_RGB = [255, 255, 255]
const BLACK_RGB = [0, 0, 0]
const DEFAULT_INK = '#20301f'
const DEFAULT_SECONDARY = '#5a6752'
const DEFAULT_HAIRLINE = '#858d7b'
const DEFAULT_FOCUS = '#80651d'
const DEFAULT_ERROR = '#b91c1c'
const HOVER_OPACITY = 0.9

export const WCAG_AA_TEXT_CONTRAST = 4.5
export const WCAG_AA_NON_TEXT_CONTRAST = 3

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function rgbToHex([red, green, blue]) {
  return `#${[red, green, blue].map((value) => clampByte(value).toString(16).padStart(2, '0')).join('')}`
}

function hexToRgb(hex) {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16))
}

function mix(rgb, target, amount) {
  return rgb.map((value, index) => value + (target[index] - value) * amount)
}

function composite(foreground, background, opacity) {
  return foreground.map((value, index) => value * opacity + background[index] * (1 - opacity))
}

function relativeLuminance(rgb) {
  const channels = rgb.map((value) => {
    const channel = value / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

export function contrastRatio(firstHex, secondHex) {
  const first = relativeLuminance(hexToRgb(firstHex))
  const second = relativeLuminance(hexToRgb(secondHex))
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

function saturation(rgb) {
  const highest = Math.max(...rgb)
  const lowest = Math.min(...rgb)
  if (highest === lowest) return 0
  const lightness = (highest + lowest) / 510
  return (highest - lowest) / (255 * (1 - Math.abs(2 * lightness - 1)))
}

function distance(first, second) {
  return Math.sqrt(first.reduce((total, value, index) => total + (value - second[index]) ** 2, 0))
}

function darkenUntil(rgb, checks) {
  let result = [...rgb]
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const hex = rgbToHex(result)
    if (checks.every(({ against, minimum }) => contrastRatio(hex, against) >= minimum)) return result
    result = mix(result, BLACK_RGB, 0.1)
  }
  return BLACK_RGB
}

function lightenUntil(rgb, checks) {
  let result = [...rgb]
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const hex = rgbToHex(result)
    if (checks.every(({ against, minimum }) => contrastRatio(hex, against) >= minimum)) return result
    result = mix(result, WHITE_RGB, 0.1)
  }
  return WHITE_RGB
}

function hoverContrastRatio(hoverHex, backgroundHex) {
  const background = hexToRgb(backgroundHex)
  const renderedHover = rgbToHex(composite(hexToRgb(hoverHex), background, HOVER_OPACITY))
  const renderedText = rgbToHex(composite(WHITE_RGB, background, HOVER_OPACITY))
  return contrastRatio(renderedText, renderedHover)
}

function translucentWhiteContrastRatio(surfaceHex) {
  const surface = hexToRgb(surfaceHex)
  return contrastRatio(rgbToHex(composite(WHITE_RGB, surface, HOVER_OPACITY)), surfaceHex)
}

function darkenForTranslucentWhite(rgb) {
  let result = [...rgb]
  for (let attempt = 0; attempt < 18; attempt += 1) {
    if (translucentWhiteContrastRatio(rgbToHex(result)) >= WCAG_AA_TEXT_CONTRAST) return result
    result = mix(result, BLACK_RGB, 0.1)
  }
  return BLACK_RGB
}

function darkenHoverUntil(rgb, backgroundHex) {
  let result = [...rgb]
  for (let attempt = 0; attempt < 18; attempt += 1) {
    if (hoverContrastRatio(rgbToHex(result), backgroundHex) >= WCAG_AA_TEXT_CONTRAST) return result
    result = mix(result, BLACK_RGB, 0.1)
  }
  return BLACK_RGB
}

export function getBrandPaletteContrastChecks(palette) {
  return [
    {
      role: 'Primary button text',
      ratio: contrastRatio(WHITE, palette.primary),
      minimum: WCAG_AA_TEXT_CONTRAST,
    },
    {
      role: 'Hover button text',
      ratio: hoverContrastRatio(palette.hover, palette.background),
      minimum: WCAG_AA_TEXT_CONTRAST,
    },
    {
      role: 'Primary links',
      ratio: contrastRatio(palette.primary, palette.background),
      minimum: WCAG_AA_TEXT_CONTRAST,
    },
    {
      role: 'Thumbnail text on primary',
      ratio: translucentWhiteContrastRatio(palette.primary),
      minimum: WCAG_AA_TEXT_CONTRAST,
    },
    {
      role: 'Page text',
      ratio: contrastRatio(palette.text, palette.background),
      minimum: WCAG_AA_TEXT_CONTRAST,
    },
    {
      role: 'Secondary accents',
      ratio: contrastRatio(palette.secondary, palette.background),
      minimum: WCAG_AA_NON_TEXT_CONTRAST,
    },
    {
      role: 'Default body text',
      ratio: contrastRatio(DEFAULT_INK, palette.background),
      minimum: WCAG_AA_TEXT_CONTRAST,
    },
    {
      role: 'Default supporting text',
      ratio: contrastRatio(DEFAULT_SECONDARY, palette.background),
      minimum: WCAG_AA_TEXT_CONTRAST,
    },
    {
      role: 'Default boundaries',
      ratio: contrastRatio(DEFAULT_HAIRLINE, palette.background),
      minimum: WCAG_AA_NON_TEXT_CONTRAST,
    },
    {
      role: 'Focus indicator',
      ratio: contrastRatio(DEFAULT_FOCUS, palette.background),
      minimum: WCAG_AA_NON_TEXT_CONTRAST,
    },
    {
      role: 'Error text',
      ratio: contrastRatio(DEFAULT_ERROR, palette.background),
      minimum: WCAG_AA_TEXT_CONTRAST,
    },
  ].map((check) => ({ ...check, passes: check.ratio >= check.minimum }))
}

function rankedColours(pixelData) {
  const bins = new Map()

  for (let index = 0; index < pixelData.length; index += 4) {
    const alpha = pixelData[index + 3]
    if (alpha < MIN_PIXEL_ALPHA) continue

    const rgb = [pixelData[index], pixelData[index + 1], pixelData[index + 2]]
    const luminance = relativeLuminance(rgb)
    const colourSaturation = saturation(rgb)
    if (luminance > 0.94 && colourSaturation < 0.12) continue

    const key = rgb.map((value) => Math.floor(value / 24)).join('-')
    const current = bins.get(key) ?? { count: 0, totals: [0, 0, 0], saturation: 0 }
    current.count += alpha / 255
    current.saturation += colourSaturation
    rgb.forEach((value, channel) => { current.totals[channel] += value * (alpha / 255) })
    bins.set(key, current)
  }

  return [...bins.values()]
    .map((bin) => {
      const rgb = bin.totals.map((total) => total / bin.count)
      const averageSaturation = bin.saturation / bin.count
      return {
        rgb,
        saturation: averageSaturation,
        score: bin.count * (0.45 + averageSaturation * 0.55),
      }
    })
    .sort((first, second) => second.score - first.score)
}

function rankedWebsiteColours(websiteColours) {
  return websiteColours
    .filter((colour) => /^#[0-9a-f]{6}$/i.test(colour?.hex))
    .map((colour) => {
      const rgb = hexToRgb(colour.hex)
      return {
        rgb,
        saturation: saturation(rgb),
        score: Math.max(1, Number(colour.weight) || 1),
        source: 'website',
      }
    })
    .sort((first, second) => second.score - first.score)
}

export function recommendBrandPaletteFromPixels(pixelData, { websiteColours = [] } = {}) {
  const colours = rankedColours(pixelData)
  if (colours.length === 0) {
    throw new Error('This logo does not contain enough visible colour to recommend a palette.')
  }

  const websiteCandidates = rankedWebsiteColours(websiteColours)
  // A website often declares both a bright accent and the darker colour it
  // pairs with for navigation/buttons. Prefer the declared colour that is
  // already closest to a usable action colour, rather than heavily darkening
  // a dominant yellow logo into an unrelated-looking olive.
  const websitePrimary = websiteCandidates.find((colour) => (
    colour.saturation >= 0.2
    && relativeLuminance(colour.rgb) >= 0.025
    && relativeLuminance(colour.rgb) <= 0.42
    && contrastRatio(rgbToHex(colour.rgb), WHITE) >= 3
  ))
  const logoPrimary = colours.find((colour) => (
    colour.saturation >= 0.22 && colour.score >= colours[0].score * 0.08
  ))
  const logoActionColour = logoPrimary && contrastRatio(rgbToHex(logoPrimary.rgb), WHITE) >= 3
    ? logoPrimary
    : null
  // The logo remains the primary authority when its colour is already close
  // to a usable action shade. The website fills the action role only when a
  // bright logo accent (for example yellow) would have to be distorted into
  // a different-looking colour to carry white text.
  const primarySource = (logoActionColour ?? websitePrimary ?? logoPrimary ?? colours[0]).rgb
  // Brand colour belongs in actions and accents. The page canvas stays very
  // near neutral so supporting text and card boundaries remain visually
  // distinct even when the source brand colour is bright or yellow-heavy.
  const background = rgbToHex(lightenUntil(mix(primarySource, WHITE_RGB, 0.985), [
    { against: DEFAULT_INK, minimum: WCAG_AA_TEXT_CONTRAST },
    { against: DEFAULT_SECONDARY, minimum: WCAG_AA_TEXT_CONTRAST },
    { against: DEFAULT_HAIRLINE, minimum: WCAG_AA_NON_TEXT_CONTRAST },
    { against: DEFAULT_FOCUS, minimum: WCAG_AA_NON_TEXT_CONTRAST },
    { against: DEFAULT_ERROR, minimum: WCAG_AA_TEXT_CONTRAST },
  ]))
  const primary = darkenUntil(primarySource, [
    { against: WHITE, minimum: WCAG_AA_TEXT_CONTRAST },
    { against: background, minimum: WCAG_AA_TEXT_CONTRAST },
  ])
  const thumbnailSafePrimary = darkenForTranslucentWhite(primary)

  // Preserve a visibly distinct logo colour as the accent before looking to
  // secondary website colours. This keeps both sources represented when the
  // website supplies the action colour.
  const distinctSecondary = colours.find(({ rgb }) => distance(rgb, primarySource) >= 72)?.rgb
    ?? websiteCandidates.find(({ rgb }) => distance(rgb, primarySource) >= 72)?.rgb
  const secondarySource = distinctSecondary ?? mix(primarySource, relativeLuminance(primarySource) < 0.2 ? WHITE_RGB : BLACK_RGB, 0.34)
  const secondary = darkenUntil(secondarySource, [{ against: background, minimum: WCAG_AA_NON_TEXT_CONTRAST }])
  const hover = darkenHoverUntil(mix(thumbnailSafePrimary, BLACK_RGB, 0.18), background)
  const text = darkenUntil(mix(primarySource, BLACK_RGB, 0.76), [{ against: background, minimum: 7 }])

  const palette = {
    primary: rgbToHex(thumbnailSafePrimary),
    secondary: rgbToHex(secondary),
    hover: rgbToHex(hover),
    background,
    text: rgbToHex(text),
  }

  if (!getBrandPaletteContrastChecks(palette).every((check) => check.passes)) {
    throw new Error('A WCAG-compliant palette could not be generated from this logo.')
  }

  return palette
}

async function sourceToBlob(source) {
  if (source instanceof Blob) return source
  const response = await fetch(source, { mode: 'cors' })
  if (!response.ok) throw new Error('The logo could not be downloaded for colour analysis.')
  return response.blob()
}

export async function recommendBrandPalette(source, { websiteColours = [] } = {}) {
  if (!source) throw new Error('Upload a logo before requesting colour recommendations.')

  const blob = await sourceToBlob(source)
  const objectUrl = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = objectUrl
    await image.decode()

    const scale = Math.min(SAMPLE_EDGE / image.naturalWidth, SAMPLE_EDGE / image.naturalHeight)
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('This browser could not analyse the logo.')
    context.drawImage(image, 0, 0, width, height)
    return recommendBrandPaletteFromPixels(
      context.getImageData(0, 0, width, height).data,
      { websiteColours },
    )
  } catch (error) {
    if (error instanceof Error && error.message.includes('recommend')) throw error
    throw new Error('The logo could not be analysed. Try uploading it again.')
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
