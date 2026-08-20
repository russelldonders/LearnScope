import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { Agent, fetch as undiciFetch } from 'undici'
import Anthropic from '@anthropic-ai/sdk'
import mammoth from 'mammoth'
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { verifySupabaseUser } from './_lib/auth.js'

export const config = {
  api: {
    bodyParser: { sizeLimit: '15mb' },
  },
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MAX_URL_FILE_BYTES = 8 * 1024 * 1024
const URL_FETCH_TIMEOUT_MS = 10000
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// Blocks loopback/private/link-local/CGNAT/special-purpose ranges so the
// "import by URL" feature can't be pointed at internal infrastructure (e.g.
// a cloud metadata endpoint). The DNS-rebinding gap this would otherwise
// have -- validating one lookup result but letting fetch() re-resolve and
// connect to a different, unvalidated address -- is closed separately by
// pinning the connection to this validated address (see pinnedDispatcher
// below), so this function only needs to get the range check itself right.
function isPrivateOrReservedIp(ip) {
  const version = isIP(ip)
  if (version === 4) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 127 || a === 10 || a === 0) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a === 192 && b === 0) return true // 192.0.0.0/24 (IETF protocol assignments)
    if (a === 192 && b === 88) return true // 192.88.99.0/24 (former 6to4 relay anycast)
    if (a === 198 && (b === 18 || b === 19)) return true // 198.18.0.0/15 (benchmarking)
    return false
  }
  if (version === 6) {
    const lower = ip.toLowerCase()
    if (lower === '::1' || lower === '::') return true
    if (lower.startsWith('::ffff:')) return isPrivateOrReservedIp(lower.slice(7))
    if (lower.startsWith('::') && lower.includes('.')) {
      // Deprecated IPv4-compatible form (::a.b.c.d) -- check the embedded IPv4.
      return isPrivateOrReservedIp(lower.slice(2))
    }
    if (/^fe[89ab]/.test(lower)) return true // fe80::/10 link-local
    if (/^f[cd]/.test(lower)) return true // fc00::/7 unique local
    if (/^ff/.test(lower)) return true // ff00::/8 multicast
    return false
  }
  return true
}

function userFacingError(message) {
  const err = new Error(message)
  err.isUserFacing = true
  return err
}

// Resolves and validates the hostname, returning the address to pin the
// connection to. Validating a hostname and then handing it to fetch()
// unpinned would let a fetch()-time DNS lookup return something different
// from what was just checked (an attacker controlling the domain's DNS can
// answer the first lookup with a public address and the second with an
// internal one) -- pinning the connection to the address already validated
// here closes that gap rather than just documenting it.
async function resolvePinnedAddress(hostname) {
  if (isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) throw userFacingError('That URL points to a private address.')
    return hostname
  }
  const { address } = await lookup(hostname)
  if (isPrivateOrReservedIp(address)) throw userFacingError('That URL points to a private address.')
  return address
}

function pinnedDispatcher(address) {
  const family = isIP(address)
  return new Agent({
    connect: {
      lookup: (hostname, options, callback) => {
        if (options?.all) callback(null, [{ address, family }])
        else callback(null, address, family)
      },
    },
  })
}

function discardBody(res) {
  res.body?.cancel().catch(() => {})
}

// Follows redirects manually (rather than fetch's automatic 'follow') so
// each hop can be re-validated -- otherwise a redirect could be used to
// reach an internal address after the initial URL passed the check. The
// deadline spans the whole operation (all hops plus the body download),
// not just the initial connection -- fetch() resolves as soon as headers
// arrive, so a timeout that only wrapped that call would leave a malicious
// server free to drip-feed the body indefinitely afterward.
async function fetchDocumentFromUrl(urlString) {
  const deadline = Date.now() + URL_FETCH_TIMEOUT_MS
  let current = urlString
  for (let hop = 0; hop < 5; hop++) {
    let parsed
    try {
      parsed = new URL(current)
    } catch {
      throw userFacingError("That doesn't look like a valid URL.")
    }
    if (parsed.protocol !== 'https:') {
      throw userFacingError('Please use an https:// link.')
    }
    const pinnedAddress = await resolvePinnedAddress(parsed.hostname)

    const remaining = deadline - Date.now()
    if (remaining <= 0) throw userFacingError('That took too long to download.')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), remaining)

    let res
    try {
      res = await undiciFetch(parsed.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        dispatcher: pinnedDispatcher(pinnedAddress),
      })
    } catch (err) {
      clearTimeout(timeout)
      throw err.name === 'AbortError'
        ? userFacingError('That took too long to download.')
        : userFacingError('Could not download that file.')
    }

    if (res.status >= 300 && res.status < 400) {
      discardBody(res)
      clearTimeout(timeout)
      const location = res.headers.get('location')
      if (!location) throw userFacingError('That link could not be resolved.')
      current = new URL(location, parsed).toString()
      continue
    }
    if (!res.ok) {
      discardBody(res)
      clearTimeout(timeout)
      throw userFacingError('Could not download that file.')
    }

    const contentType = res.headers.get('content-type') || ''
    const path = parsed.pathname.toLowerCase()
    let fileType
    if (contentType.includes('application/pdf') || path.endsWith('.pdf')) {
      fileType = 'pdf'
    } else if (contentType.includes(DOCX_MIME) || path.endsWith('.docx')) {
      fileType = 'docx'
    } else {
      discardBody(res)
      clearTimeout(timeout)
      throw userFacingError('That link did not lead to a PDF or Word (.docx) file.')
    }

    // Content-Length is attacker-controlled (they run the server) and easy
    // to omit or lie about, so the real cap is this running total against
    // the actual bytes read -- it aborts the moment the limit is crossed
    // rather than buffering the whole body first and checking after.
    const reader = res.body.getReader()
    const chunks = []
    let total = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > MAX_URL_FILE_BYTES) {
          controller.abort()
          throw userFacingError('That file is too large (max 8MB).')
        }
        chunks.push(value)
      }
    } catch (err) {
      if (err.isUserFacing) throw err
      throw err.name === 'AbortError'
        ? userFacingError('That took too long to download.')
        : userFacingError('Could not download that file.')
    } finally {
      clearTimeout(timeout)
    }

    return { buffer: Buffer.concat(chunks.map((c) => Buffer.from(c))), fileType }
  }
  throw userFacingError('That link redirected too many times.')
}

const NULLABLE_STRING = { anyOf: [{ type: 'string' }, { type: 'null' }] }

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    profile: {
      type: 'object',
      properties: {
        full_name: NULLABLE_STRING,
        country: NULLABLE_STRING,
        location: NULLABLE_STRING,
        language: NULLABLE_STRING,
      },
      required: ['full_name', 'country', 'location', 'language'],
      additionalProperties: false,
    },
    skills: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: '2-4 short, general tags for this skill (e.g. "Technical", "Communication", "Leadership").',
          },
          level: { type: 'integer', enum: [1, 2, 3, 4, 5] },
          notes: NULLABLE_STRING,
          current_role: {
            type: 'boolean',
            description: 'True if this skill is used in the person\'s current/most recent role.',
          },
        },
        required: ['name', 'tags', 'level', 'notes', 'current_role'],
        additionalProperties: false,
      },
    },
    courses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          provider: NULLABLE_STRING,
          completed_date: NULLABLE_STRING,
          notes: NULLABLE_STRING,
        },
        required: ['name', 'provider', 'completed_date', 'notes'],
        additionalProperties: false,
      },
    },
    experience: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['education', 'employment'] },
          title: { type: 'string' },
          organization: { type: 'string' },
          start_date: NULLABLE_STRING,
          end_date: NULLABLE_STRING,
          description: NULLABLE_STRING,
        },
        required: ['type', 'title', 'organization', 'start_date', 'end_date', 'description'],
        additionalProperties: false,
      },
    },
  },
  required: ['profile', 'skills', 'courses', 'experience'],
  additionalProperties: false,
}

const EXTRACTION_PROMPT = `Extract profile details, skills, courses/training, and education/employment experience from this CV or LinkedIn profile export.

For profile: pull full name, country, current city/region (location), and primary language if stated or clearly inferable. Leave a field null if not present.

For skills: infer a reasonable proficiency level 1-5 (1 = beginner, 5 = expert) from years of experience, seniority language, or context; if genuinely unclear, use 3. Suggest 2-4 short, general tags per skill (e.g. "Technical", "Communication", "Leadership") rather than one rigid category. Mark current_role true only for skills clearly used in the most recent / current role (usually the first-listed or undated-end job); mark the rest false.

For courses/training: include certifications, completed courses, and formal training programs. Leave completed_date null if no date is given.

For experience: include every job and every degree/education entry as a separate item, type "employment" or "education". Use ISO date format YYYY-MM-DD for start_date and end_date; if only a month/year or year is given, use the 1st of that month (or January 1st). Leave end_date null if the role or program is current/ongoing.

Only include information actually present in the document. Do not invent details.`

function extractPdfPhoto(pdfBytes) {
  try {
    // Node Buffers can be views into a larger pooled ArrayBuffer — pdf-lib's
    // low-level JPEG/stream handling assumes .buffer spans exactly the data,
    // so make a tightly-sized copy before handing it off.
    const pdfDoc = PDFDocument.load(new Uint8Array(pdfBytes), {
      ignoreEncryption: true,
      updateMetadata: false,
    })
    return pdfDoc.then((doc) => {
      let best = null
      for (const [, obj] of doc.context.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFRawStream)) continue
        const dict = obj.dict
        const subtype = dict.get(PDFName.of('Subtype'))
        if (!subtype || subtype.toString() !== '/Image') continue
        const filter = dict.get(PDFName.of('Filter'))
        const filterStr = filter ? filter.toString() : ''
        if (!filterStr.includes('DCTDecode')) continue
        const widthObj = dict.get(PDFName.of('Width'))
        const heightObj = dict.get(PDFName.of('Height'))
        const width = widthObj && typeof widthObj.asNumber === 'function' ? widthObj.asNumber() : 0
        const height = heightObj && typeof heightObj.asNumber === 'function' ? heightObj.asNumber() : 0
        if (width < 120 || height < 120) continue
        const area = width * height
        if (!best || area > best.area) {
          best = { area, bytes: obj.contents }
        }
      }
      if (!best) return null
      return { base64: Buffer.from(best.bytes).toString('base64'), contentType: 'image/jpeg' }
    })
  } catch {
    return Promise.resolve(null)
  }
}

async function extractDocxTextAndPhoto(buffer) {
  let bestImage = null

  const textResult = await mammoth.extractRawText({ buffer })

  try {
    await mammoth.convertToHtml(
      { buffer },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          const base64 = await image.read('base64')
          if (!bestImage || base64.length > bestImage.size) {
            bestImage = { base64, contentType: image.contentType, size: base64.length }
          }
          return {}
        }),
      }
    )
  } catch {
    // Non-fatal — proceed without a photo.
  }

  return { text: textResult.value, photo: bestImage }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization' })
    return
  }

  const user = await verifySupabaseUser(authHeader.slice(7))
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired session' })
    return
  }

  const { fileBase64, fileType: bodyFileType, url } = req.body ?? {}

  try {
    let buffer
    let fileType

    if (typeof url === 'string' && url.trim()) {
      ;({ buffer, fileType } = await fetchDocumentFromUrl(url.trim()))
    } else if (fileBase64 && typeof fileBase64 === 'string') {
      if (bodyFileType !== 'pdf' && bodyFileType !== 'docx') {
        res.status(400).json({ error: 'fileType must be "pdf" or "docx"' })
        return
      }
      buffer = Buffer.from(fileBase64, 'base64')
      fileType = bodyFileType
    } else {
      res.status(400).json({ error: 'Provide either fileBase64 or url' })
      return
    }

    let messageContent
    let photo = null

    if (fileType === 'pdf') {
      photo = await extractPdfPhoto(buffer)
      messageContent = [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') },
        },
        { type: 'text', text: EXTRACTION_PROMPT },
      ]
    } else {
      const { text, photo: docxPhoto } = await extractDocxTextAndPhoto(buffer)
      photo = docxPhoto
      messageContent = [
        { type: 'text', text: `${EXTRACTION_PROMPT}\n\nDocument text:\n\n${text}` },
      ]
    }

    const response = await anthropic.messages.create({
      model: 'claude-opus-5',
      max_tokens: 8192,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: EXTRACTION_SCHEMA },
      },
      messages: [{ role: 'user', content: messageContent }],
    })

    if (response.stop_reason === 'refusal') {
      res.status(422).json({ error: "Couldn't process this document." })
      return
    }

    const textBlock = response.content.find((b) => b.type === 'text')
    const data = JSON.parse(textBlock.text)

    if (photo) {
      data.photoBase64 = photo.base64
      data.photoContentType = photo.contentType
    }

    res.status(200).json(data)
  } catch (err) {
    if (err.isUserFacing) {
      res.status(422).json({ error: err.message })
      return
    }
    console.error('parse-cv error:', err)
    res.status(500).json({ error: 'Failed to parse the document.' })
  }
}
