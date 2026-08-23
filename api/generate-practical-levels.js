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

  const prompt = `Write 5 short statements describing what a learner's demonstrated, practical ability at "${skillName.trim()}" looks like at each of 5 levels, from least to most developed:

1. Beginner -- has observed it being done, hasn't tried it themselves
2. Developing -- can attempt it with guidance, supervision, or a reference
3. Capable -- can complete it alone, without needing help
4. Skilled -- confident handling harder or less familiar situations, not just the routine ones
5. Expert -- others turn to them on this; they push quality or improve how it's done

For each level write one concise, second-person sentence (starting "You...") describing what that level of demonstrated, hands-on ability specifically looks like for "${skillName.trim()}" -- not a generic description that could apply to any skill. Focus on what they can practically do, not what they understand in theory. Return exactly 5 statements in order from level 1 to level 5.`

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
    console.error('generate-practical-levels error:', err)
    res.status(500).json({ error: 'Failed to generate level guidance.' })
  }
}
