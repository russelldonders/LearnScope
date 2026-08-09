import Anthropic from '@anthropic-ai/sdk'

export const config = {
  api: {
    bodyParser: { sizeLimit: '15mb' },
  },
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    skills: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          category: { type: 'string' },
          level: { type: 'integer', enum: [1, 2, 3, 4, 5] },
          notes: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
        required: ['name', 'category', 'level', 'notes'],
        additionalProperties: false,
      },
    },
    courses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          provider: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          completed_date: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          notes: { anyOf: [{ type: 'string' }, { type: 'null' }] },
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
          start_date: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          end_date: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          description: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
        required: ['type', 'title', 'organization', 'start_date', 'end_date', 'description'],
        additionalProperties: false,
      },
    },
  },
  required: ['skills', 'courses', 'experience'],
  additionalProperties: false,
}

const EXTRACTION_PROMPT = `Extract skills, courses/training, and education/employment experience from this CV or LinkedIn profile export.

For skills: infer a reasonable proficiency level 1-5 (1 = beginner, 5 = expert) from years of experience, seniority language, or context; if genuinely unclear, use 3. Group similar skills under a sensible free-form category (e.g. "Technical", "Communication", "Leadership").

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

  const { pdfBase64 } = req.body ?? {}
  if (!pdfBase64 || typeof pdfBase64 !== 'string') {
    res.status(400).json({ error: 'Missing pdfBase64' })
    return
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-5',
      max_tokens: 8192,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: EXTRACTION_SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
            },
            { type: 'text', text: EXTRACTION_PROMPT },
          ],
        },
      ],
    })

    if (response.stop_reason === 'refusal') {
      res.status(422).json({ error: "Couldn't process this document." })
      return
    }

    const textBlock = response.content.find((b) => b.type === 'text')
    const data = JSON.parse(textBlock.text)
    res.status(200).json(data)
  } catch (err) {
    console.error('parse-cv error:', err)
    res.status(500).json({ error: 'Failed to parse the document.' })
  }
}
