import Anthropic from '@anthropic-ai/sdk'
import { verifySupabaseUser } from './_lib/auth.js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const ASSESSMENT_SCHEMA = {
  type: 'object',
  properties: {
    level: { type: 'integer' },
    reasoning: { type: 'string' },
  },
  required: ['level', 'reasoning'],
  additionalProperties: false,
}

// Practical axis only -- self-assessment, recorded activity and peer
// ratings are all evidence of what the learner has actually *done*.
// Knowledge (e.g. a quiz score) is deliberately excluded: it belongs to a
// separate axis and must never blend into or raise this practical estimate.
function buildPrompt({ skillName, selfLevel, selfComments, activities, peerRatings }) {
  const lines = []
  lines.push(`Skill: "${skillName.trim()}"`)
  lines.push('')
  lines.push(
    'Practical proficiency scale (low to high): Watching and learning, Trying it with support, Doing it independently, Handling the tricky stuff, Raising the standard.'
  )
  lines.push('')
  lines.push(
    selfLevel
      ? `Self-assessment: the learner rates themself as "${selfLevel}".${selfComments ? ` Their comment: "${selfComments}"` : ''}`
      : 'Self-assessment: none given yet.'
  )
  lines.push('')
  if (Array.isArray(activities) && activities.length > 0) {
    lines.push(`Recorded activities (${activities.length}):`)
    activities
      .slice(0, 10)
      .forEach((e) => lines.push(`- ${e.verb} "${e.activity}"${e.description ? `: ${e.description}` : ''} (${e.date})`))
  } else {
    lines.push('Recorded activities: none.')
  }
  lines.push('')
  if (Array.isArray(peerRatings) && peerRatings.length > 0) {
    lines.push(
      `Peer ratings (${peerRatings.length}), each with a credibility weight -- weight this rater's opinion in your judgement roughly proportional to the weight value, higher weight means give it more influence:`
    )
    peerRatings.slice(0, 15).forEach((r) => {
      const trackNote = r.raterTracksThisSkill
        ? ` This rater also tracks this same skill themselves and is at the "${r.raterOwnStage}" stage of their own development, which is why their weight is higher.`
        : ''
      lines.push(`- Rated "${r.level}" (weight ${r.weight}x).${r.comments ? ` Comment: "${r.comments}"` : ''}${trackNote}`)
    })
  } else {
    lines.push('Peer ratings: none.')
  }

  return `You are helping a learner establish a baseline *practical* proficiency level for a skill they are tracking, by synthesizing several inputs into a single best-estimate level. Practical proficiency is what someone can reliably do, not what they know in theory -- do not treat familiarity or understanding as proof of practical capability.

${lines.join('\n')}

Weigh all the available evidence -- self-assessment, recorded activity, and peer ratings (using the given weights) -- to propose a single overall level from this scale: 1=Watching and learning, 2=Trying it with support, 3=Doing it independently, 4=Handling the tricky stuff, 5=Raising the standard. A single demonstration is weaker evidence than repeated or varied application -- weigh repetition and variety of context accordingly. If little or no evidence is available, default toward a conservative (lower) estimate rather than guessing high. Return the level as an integer 1-5, and a short 2-4 sentence explanation of how you weighed the inputs.`
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

  const { skillName, selfLevel, selfComments, activities, peerRatings } = req.body ?? {}
  if (!skillName || typeof skillName !== 'string') {
    res.status(400).json({ error: 'Missing skillName' })
    return
  }

  const prompt = buildPrompt({ skillName, selfLevel, selfComments, activities, peerRatings })

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      output_config: {
        format: { type: 'json_schema', schema: ASSESSMENT_SCHEMA },
      },
      messages: [{ role: 'user', content: prompt }],
    })

    if (response.stop_reason === 'refusal') {
      res.status(422).json({ error: "Couldn't assess a baseline for this skill." })
      return
    }

    const textBlock = response.content.find((b) => b.type === 'text')
    const data = JSON.parse(textBlock.text)
    const level = Math.min(5, Math.max(1, Math.round(Number(data.level) || 1)))
    res.status(200).json({ level, reasoning: data.reasoning })
  } catch (err) {
    console.error('assess-baseline error:', err)
    res.status(500).json({ error: 'Failed to assess baseline.' })
  }
}
