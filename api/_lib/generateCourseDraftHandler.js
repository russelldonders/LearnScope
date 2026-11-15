import Anthropic from '@anthropic-ai/sdk'
import { verifySupabaseUser } from './auth.js'
import { consumeQuota, sendQuotaExceeded } from './quota.js'
import { COURSE_DRAFT_SCHEMA, buildCourseDraftRequest, normalizeGeneratedCourseDraft } from './courseDraft.js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export default async function generateCourseDraftHandler(req, res) {
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

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.error('generate-course-draft error: ANTHROPIC_API_KEY is not configured')
    res.status(503).json({ error: 'Course generation is not configured on this environment.' })
    return
  }

  const request = buildCourseDraftRequest(req.body)
  if (request.error) {
    res.status(400).json({ error: request.error })
    return
  }
  if (!(await consumeQuota(user.id, 'ai'))) {
    sendQuotaExceeded(res)
    return
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: request.maxTokens,
      output_config: { format: { type: 'json_schema', schema: COURSE_DRAFT_SCHEMA } },
      messages: [{ role: 'user', content: request.prompt }],
    })
    if (response.stop_reason === 'refusal') {
      res.status(422).json({ error: "Couldn't generate this course. Try a different brief." })
      return
    }
    const textBlock = response.content.find((block) => block.type === 'text')
    const draft = textBlock ? normalizeGeneratedCourseDraft(JSON.parse(textBlock.text), request.values) : null
    if (!draft) throw new Error('The generated course did not match the required structure.')
    res.status(200).json({ draft })
  } catch (err) {
    console.error('generate-course-draft error:', err)
    if (err?.status === 401 || err?.status === 403) {
      res.status(503).json({ error: 'Course generation could not authenticate with the AI service.' })
      return
    }
    if (err?.status === 429) {
      res.status(429).json({ error: 'The AI service is busy or its usage limit has been reached. Try again shortly.' })
      return
    }
    if (err?.status === 400) {
      res.status(502).json({ error: 'The AI service rejected the course request format.' })
      return
    }
    res.status(500).json({ error: 'Failed to generate the course. Try again.' })
  }
}
