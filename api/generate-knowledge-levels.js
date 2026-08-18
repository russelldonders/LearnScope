import Anthropic from '@anthropic-ai/sdk'
import { verifySupabaseUser } from './_lib/auth.js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const LEVEL_GUIDE_SCHEMA = {
  type: 'object',
  properties: {
    statements: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['statements'],
  additionalProperties: false,
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

  const { skillName } = req.body ?? {}
  if (!skillName || typeof skillName !== 'string') {
    res.status(400).json({ error: 'Missing skillName' })
    return
  }

  const prompt = `Write 5 short statements describing what a learner's theoretical knowledge and understanding of "${skillName.trim()}" looks like at each of 5 levels, from least to most developed:

1. Unfamiliar -- never studied it
2. Aware -- basic awareness it exists
3. Familiar -- understands the fundamentals
4. Knowledgeable -- solid theoretical grasp
5. Deep understanding -- comprehensive mastery

For each level write one concise, second-person sentence (starting "You...") describing what that level of understanding specifically looks like for "${skillName.trim()}" -- not a generic description that could apply to any skill. Focus on what they know/understand in theory, not what they can practically do. Return exactly 5 statements in order from level 1 to level 5.`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      output_config: {
        format: { type: 'json_schema', schema: LEVEL_GUIDE_SCHEMA },
      },
      messages: [{ role: 'user', content: prompt }],
    })

    if (response.stop_reason === 'refusal') {
      res.status(422).json({ error: "Couldn't generate level guidance for this skill." })
      return
    }

    const textBlock = response.content.find((b) => b.type === 'text')
    const data = JSON.parse(textBlock.text)
    res.status(200).json(data)
  } catch (err) {
    console.error('generate-knowledge-levels error:', err)
    res.status(500).json({ error: 'Failed to generate level guidance.' })
  }
}
