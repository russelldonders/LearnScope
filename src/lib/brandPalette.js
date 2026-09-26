const SAMPLE_EDGE = 96
const MIN_PIXEL_ALPHA = 160

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
    result = mix(result, [0, 0, 0], 0.1)
  }
  return result
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

export function recommendBrandPaletteFromPixels(pixelData) {
  const colours = rankedColours(pixelData)
  if (colours.length === 0) {
    throw new Error('This logo does not contain enough visible colour to recommend a palette.')
  }

  const chromaticPrimary = colours.find((colour) => (
    colour.saturation >= 0.22 && colour.score >= colours[0].score * 0.08
  ))
  const primarySource = (chromaticPrimary ?? colours[0]).rgb
  const background = rgbToHex(mix(primarySource, [255, 255, 255], 0.94))
  const primary = darkenUntil(primarySource, [
    { against: '#ffffff', minimum: 4.5 },
    { against: background, minimum: 4.5 },
  ])

  const distinctSecondary = colours.find(({ rgb }) => distance(rgb, primarySource) >= 72)?.rgb
  const secondarySource = distinctSecondary ?? mix(primarySource, relativeLuminance(primarySource) < 0.2 ? [255, 255, 255] : [0, 0, 0], 0.34)
  const secondary = darkenUntil(secondarySource, [{ against: background, minimum: 3 }])
  const hover = darkenUntil(mix(primary, [0, 0, 0], 0.18), [{ against: '#ffffff', minimum: 4.5 }])
  const text = darkenUntil(mix(primarySource, [0, 0, 0], 0.76), [{ against: background, minimum: 7 }])

  return {
    primary: rgbToHex(primary),
    secondary: rgbToHex(secondary),
    hover: rgbToHex(hover),
    background,
    text: rgbToHex(text),
  }
}

async function sourceToBlob(source) {
  if (source instanceof Blob) return source
  const response = await fetch(source, { mode: 'cors' })
  if (!response.ok) throw new Error('The logo could not be downloaded for colour analysis.')
  return response.blob()
}

export async function recommendBrandPalette(source) {
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
    return recommendBrandPaletteFromPixels(context.getImageData(0, 0, width, height).data)
  } catch (error) {
    if (error instanceof Error && error.message.includes('recommend')) throw error
    throw new Error('The logo could not be analysed. Try uploading it again.')
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
