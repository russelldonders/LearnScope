import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SUGGESTION_SCHEMA = {
  type: 'object',
  properties: {
    tags: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['tags'],
  additionalProperties: false,
}

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

  const { skillName, existingTags } = req.body ?? {}
  if (!skillName || typeof skillName !== 'string') {
    res.status(400).json({ error: 'Missing skillName' })
    return
  }

  const existingList = Array.isArray(existingTags) ? existingTags.filter((t) => typeof t === 'string') : []

  const prompt = `Suggest up to 4 short tags for the skill "${skillName.trim()}" -- broad, reusable categories (e.g. "Technical", "Leadership", "Languages", "Cooking"), not overly specific restatements of the skill name itself.

Reuse one of these existing tags when it is a genuinely strong fit -- do not stretch a loose or tenuous match just to reuse one:
${existingList.length > 0 ? existingList.join(', ') : '(none yet)'}

Only invent a new tag when none of the existing ones are a strong fit. It's fine to suggest just one or two tags if that's all that genuinely applies. Use Title Case, 1-3 words per tag.`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      output_config: {
        format: { type: 'json_schema', schema: SUGGESTION_SCHEMA },
      },
      messages: [{ role: 'user', content: prompt }],
    })

    if (response.stop_reason === 'refusal') {
      res.status(422).json({ error: "Couldn't suggest tags for this." })
      return
    }

    const textBlock = response.content.find((b) => b.type === 'text')
    const data = JSON.parse(textBlock.text)
    res.status(200).json(data)
  } catch (err) {
    console.error('suggest-tags error:', err)
    res.status(500).json({ error: 'Failed to suggest tags.' })
  }
}
