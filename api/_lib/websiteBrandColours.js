import dns from 'node:dns/promises'
import net from 'node:net'

const MAX_REDIRECTS = 4
const MAX_HTML_BYTES = 2 * 1024 * 1024
const MAX_CSS_BYTES = 512 * 1024
const MAX_STYLESHEETS = 5
const FETCH_TIMEOUT_MS = 8_000
const HEX_RE = /#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})(?![\da-f])/gi
const RGB_RE = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*[\d.%]+)?\s*\)/gi
const HSL_RE = /hsla?\(\s*([\d.]+)(?:deg)?[,\s]+([\d.]+)%[,\s]+([\d.]+)%(?:\s*[,/]\s*[\d.%]+)?\s*\)/gi

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function rgbToHex(rgb) {
  return `#${rgb.map((value) => clampByte(value).toString(16).padStart(2, '0')).join('')}`
}

function normaliseHex(value) {
  const hex = value.toLowerCase()
  if (hex.length === 4 || hex.length === 5) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
  }
  return hex.slice(0, 7)
}

function hslToHex(hue, saturation, lightness) {
  const h = ((Number(hue) % 360) + 360) % 360 / 360
  const s = Math.max(0, Math.min(1, Number(saturation) / 100))
  const l = Math.max(0, Math.min(1, Number(lightness) / 100))
  const channel = (offset) => {
    const k = (offset + h * 12) % 12
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return rgbToHex([channel(0) * 255, channel(8) * 255, channel(4) * 255])
}

function addColour(scores, hex, weight) {
  const normalised = normaliseHex(hex)
  const rgb = [1, 3, 5].map((index) => Number.parseInt(normalised.slice(index, index + 2), 16))
  const lightness = (Math.max(...rgb) + Math.min(...rgb)) / 510
  if (lightness < 0.025 || lightness > 0.975) return
  scores.set(normalised, (scores.get(normalised) ?? 0) + weight)
}

function collectColours(text, scores, weight) {
  for (const match of text.matchAll(HEX_RE)) addColour(scores, match[0], weight)
  for (const match of text.matchAll(RGB_RE)) addColour(scores, rgbToHex(match.slice(1, 4).map(Number)), weight)
  for (const match of text.matchAll(HSL_RE)) addColour(scores, hslToHex(match[1], match[2], match[3]), weight)
}

function colourDistance(firstHex, secondHex) {
  const first = [1, 3, 5].map((index) => Number.parseInt(firstHex.slice(index, index + 2), 16))
  const second = [1, 3, 5].map((index) => Number.parseInt(secondHex.slice(index, index + 2), 16))
  return Math.sqrt(first.reduce((sum, value, index) => sum + (value - second[index]) ** 2, 0))
}

export function extractWebsiteBrandColours(html, stylesheets = []) {
  const scores = new Map()

  for (const match of html.matchAll(/<meta\b[^>]*\bname=["']theme-color["'][^>]*\bcontent=["']([^"']+)["'][^>]*>/gi)) {
    collectColours(match[1], scores, 30)
  }
  for (const match of html.matchAll(/<meta\b[^>]*\bcontent=["']([^"']+)["'][^>]*\bname=["']theme-color["'][^>]*>/gi)) {
    collectColours(match[1], scores, 30)
  }
  for (const match of html.matchAll(/\bstyle=["']([^"']+)["']/gi)) collectColours(match[1], scores, 4)
  for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) collectColours(match[1], scores, 2)

  for (const css of stylesheets) {
    for (const match of css.matchAll(/--[\w-]*(?:brand|primary|secondary|accent|theme|nav|button)[\w-]*\s*:\s*([^;}{]+)/gi)) {
      collectColours(match[1], scores, 12)
    }
    for (const match of css.matchAll(/(?:background(?:-color)?|border(?:-color)?|color)\s*:\s*([^;}{]+)/gi)) {
      collectColours(match[1], scores, 1)
    }
  }

  const ranked = [...scores.entries()]
    .map(([hex, weight]) => ({ hex, weight }))
    .sort((first, second) => second.weight - first.weight)

  const distinct = []
  for (const colour of ranked) {
    if (distinct.every((existing) => colourDistance(existing.hex, colour.hex) >= 24)) distinct.push(colour)
    if (distinct.length === 12) break
  }
  return distinct
}

function isPublicAddress(address) {
  const version = net.isIP(address)
  if (version === 4) {
    const [first, second, third] = address.split('.').map(Number)
    if (first === 0 || first === 10 || first === 127 || first >= 224) return false
    if (first === 100 && second >= 64 && second <= 127) return false
    if (first === 169 && second === 254) return false
    if (first === 172 && second >= 16 && second <= 31) return false
    if (first === 192 && second === 168) return false
    if (first === 192 && second === 0 && third <= 2) return false
    if (first === 198 && (second === 18 || second === 19 || second === 51)) return false
    if (first === 203 && second === 0 && third === 113) return false
    return true
  }
  if (version === 6) {
    const normalised = address.toLowerCase().split('%')[0]
    if (normalised === '::' || normalised === '::1') return false
    if (/^(?:fc|fd|fe[89ab]|ff)/.test(normalised) || normalised.startsWith('2001:db8:')) return false
    if (normalised.startsWith('::ffff:')) return isPublicAddress(normalised.slice(7))
    return true
  }
  return false
}

export async function validatePublicWebsiteUrl(value, lookup = dns.lookup) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Enter a complete website URL, including https://.')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Enter a public http or https website URL.')
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('That website address is not publicly reachable.')
  }
  return url
}

async function readLimitedBody(response, maximumBytes) {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new Error('The website response is too large to analyse.')
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maximumBytes) {
      await reader.cancel()
      throw new Error('The website response is too large to analyse.')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

async function fetchPublicText(initialUrl, maximumBytes, acceptedTypes) {
  let url = await validatePublicWebsiteUrl(initialUrl)
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'LearnScope brand colour analyser/1.0', Accept: acceptedTypes },
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || redirect === MAX_REDIRECTS) throw new Error('The website redirected too many times.')
      url = await validatePublicWebsiteUrl(new URL(location, url).href)
      continue
    }
    if (!response.ok) throw new Error(`The website returned ${response.status}.`)
    return { text: await readLimitedBody(response, maximumBytes), url, contentType: response.headers.get('content-type') ?? '' }
  }
  throw new Error('The website could not be reached.')
}

function stylesheetUrls(html, pageUrl) {
  const urls = []
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0]
    if (!/\brel=["'][^"']*stylesheet/i.test(tag)) continue
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1]
    if (!href) continue
    try {
      const url = new URL(href, pageUrl)
      if (url.origin === pageUrl.origin && ['http:', 'https:'].includes(url.protocol)) urls.push(url.href)
    } catch {
      // Ignore malformed stylesheet links from third-party pages.
    }
    if (urls.length === MAX_STYLESHEETS) break
  }
  return urls
}

export async function getWebsiteBrandColours(websiteUrl) {
  try {
    const preferredUrl = await validatePublicWebsiteUrl(websiteUrl)
    // Most brand sites force HTTPS. Starting there avoids an unnecessary
    // redirect and works around hosts that deliberately delay plain HTTP.
    if (preferredUrl.protocol === 'http:') preferredUrl.protocol = 'https:'
    const page = await fetchPublicText(preferredUrl.href, MAX_HTML_BYTES, 'text/html,application/xhtml+xml')
    if (!/html|xhtml/i.test(page.contentType)) throw new Error('The website did not return an HTML page.')
    const stylesheetResults = await Promise.allSettled(
      stylesheetUrls(page.text, page.url).map((url) => fetchPublicText(url, MAX_CSS_BYTES, 'text/css')),
    )
    const stylesheets = stylesheetResults
      .filter((result) => result.status === 'fulfilled' && /css/i.test(result.value.contentType))
      .map((result) => result.value.text)
    return extractWebsiteBrandColours(page.text, stylesheets)
  } catch (error) {
    if (error instanceof Error && /^(Enter|That|The website)/.test(error.message)) throw error
    throw new Error('The website could not be analysed. Check the URL and try again.')
  }
}
