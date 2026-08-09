import Anthropic from '@anthropic-ai/sdk'
import mammoth from 'mammoth'
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'

export const config = {
  api: {
    bodyParser: { sizeLimit: '15mb' },
  },
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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
          category: { type: 'string' },
          level: { type: 'integer', enum: [1, 2, 3, 4, 5] },
          notes: NULLABLE_STRING,
          current_role: {
            type: 'boolean',
            description: 'True if this skill is used in the person\'s current/most recent role.',
          },
        },
        required: ['name', 'category', 'level', 'notes', 'current_role'],
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

For skills: infer a reasonable proficiency level 1-5 (1 = beginner, 5 = expert) from years of experience, seniority language, or context; if genuinely unclear, use 3. Group similar skills under a sensible free-form category (e.g. "Technical", "Communication", "Leadership"). Mark current_role true only for skills clearly used in the most recent / current role (usually the first-listed or undated-end job); mark the rest false.

For courses/training: include certifications, completed courses, and formal training programs. Leave completed_date null if no date is given.

For experience: include every job and every degree/education entry as a separate item, type "employment" or "education". Use ISO date format YYYY-MM-DD for start_date and end_date; if only a month/year or year is given, use the 1st of that month (or January 1st). Leave end_date null if the role or program is current/ongoing.

Only include information actually present in the document. Do not invent details.`

async function verifySupabaseUser(accessToken) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  })
  if (!res.ok) return null
  return res.json()
}

function extractPdfPhoto(pdfBytes) {
  try {
    const pdfDoc = PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false })
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

  const { fileBase64, fileType } = req.body ?? {}
  if (!fileBase64 || typeof fileBase64 !== 'string') {
    res.status(400).json({ error: 'Missing fileBase64' })
    return
  }
  if (fileType !== 'pdf' && fileType !== 'docx') {
    res.status(400).json({ error: 'fileType must be "pdf" or "docx"' })
    return
  }

  try {
    let messageContent
    let photo = null

    if (fileType === 'pdf') {
      const buffer = Buffer.from(fileBase64, 'base64')
      photo = await extractPdfPhoto(buffer)
      messageContent = [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 },
        },
        { type: 'text', text: EXTRACTION_PROMPT },
      ]
    } else {
      const buffer = Buffer.from(fileBase64, 'base64')
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
    console.error('parse-cv error:', err)
    res.status(500).json({ error: 'Failed to parse the document.' })
  }
}
