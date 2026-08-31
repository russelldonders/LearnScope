import Anthropic from '@anthropic-ai/sdk'
import { verifySupabaseUser } from './_lib/auth.js'

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

const RECOMMENDATIONS_SCHEMA = {
  type: 'object',
  properties: {
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['name', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['recommendations'],
  additionalProperties: false,
}

function clean(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function buildExperienceRecommendationRequest(body) {
  const { experience, linkedSkillNames } = body
  const title = clean(experience?.title, 160)
  if (!title) return { error: 'Missing experience title' }

  const type = clean(experience?.type, 40) || 'experience'
  const organization = clean(experience?.organization, 160)
  const description = clean(experience?.description, 2000)
  const excluded = Array.isArray(linkedSkillNames)
    ? linkedSkillNames.map((name) => clean(name, 120)).filter(Boolean).slice(0, 100)
    : []

  return {
    schema: RECOMMENDATIONS_SCHEMA,
    maxTokens: 768,
    excluded,
    refusalError: "Couldn't recommend skills for this experience.",
    failureError: 'Failed to recommend skills.',
    logLabel: 'recommend-experience-skills',
    prompt: `Recommend the most important additional skills a learner would need for this job or experience.

Experience type: ${type}
Title: ${title}
Organization: ${organization || '(not supplied)'}
Description: ${description || '(not supplied)'}

Skills already linked (do not recommend these or close synonyms):
${excluded.length ? excluded.join(', ') : '(none)'}

Return at most 3 recommendations, ordered from most important to least important. Use established, reusable skill names rather than responsibilities, tools that are too specific, or vague traits. Each reason must be one concise sentence explaining why the skill matters for this exact experience. If the title and description do not support 3 useful recommendations, return fewer.`,
  }
}

function buildTagSuggestionRequest(body) {
  const { skillName, existingTags } = body
  if (!skillName || typeof skillName !== 'string') return { error: 'Missing skillName' }

  const existingList = Array.isArray(existingTags) ? existingTags.filter((tag) => typeof tag === 'string') : []
  return {
    schema: SUGGESTION_SCHEMA,
    maxTokens: 512,
    refusalError: "Couldn't suggest tags for this.",
    failureError: 'Failed to suggest tags.',
    logLabel: 'suggest-tags',
    prompt: `Suggest up to 3 short tags that best categorize the skill "${skillName.trim()}" -- broad, reusable categories (e.g. "Technical", "Leadership", "Languages", "Cooking"), not overly specific restatements of the skill name itself.

Pick whichever tags are the best fit, freely inventing new ones as needed -- do not force a fit to an existing tag just to reuse it. For reference, these tags already exist and can be reused if one is a genuinely strong fit:
${existingList.length > 0 ? existingList.join(', ') : '(none yet)'}

It's fine to suggest just one or two tags if that's all that genuinely applies. Use Title Case, 1-3 words per tag.`,
  }
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

  const body = req.body ?? {}
  const request = body.operation === 'experience-skills'
    ? buildExperienceRecommendationRequest(body)
    : buildTagSuggestionRequest(body)
  if (request.error) {
    res.status(400).json({ error: request.error })
    return
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: request.maxTokens,
      output_config: {
        format: { type: 'json_schema', schema: request.schema },
      },
      messages: [{ role: 'user', content: request.prompt }],
    })

    if (response.stop_reason === 'refusal') {
      res.status(422).json({ error: request.refusalError })
      return
    }

    const textBlock = response.content.find((block) => block.type === 'text')
    const data = JSON.parse(textBlock?.text ?? '{}')
    if (body.operation !== 'experience-skills') {
      res.status(200).json({ tags: (data.tags ?? []).slice(0, 3) })
      return
    }

    const seen = new Set(request.excluded.map((name) => name.toLowerCase()))
    const recommendations = []
    for (const item of data.recommendations ?? []) {
      const name = clean(item?.name, 120)
      const reason = clean(item?.reason, 240)
      const key = name.toLowerCase()
      if (!name || !reason || seen.has(key)) continue
      seen.add(key)
      recommendations.push({ name, reason })
      if (recommendations.length === 3) break
    }
    res.status(200).json({ recommendations })
  } catch (err) {
    console.error(`${request.logLabel} error:`, err)
    res.status(500).json({ error: request.failureError })
  }
}
