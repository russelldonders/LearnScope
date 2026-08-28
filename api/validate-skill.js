import Anthropic from '@anthropic-ai/sdk'
import { verifySupabaseUser } from './_lib/auth.js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const VALIDATION_SCHEMA = {
  type: 'object',
  properties: {
    level: { type: 'integer' },
    passed: { type: 'boolean' },
    feedback: { type: 'string' },
  },
  required: ['level', 'passed', 'feedback'],
  additionalProperties: false,
}

// Practical axis only. Completed training and knowledge-quiz performance are
// deliberately excluded: finishing a course or passing a quiz shows exposure
// to the material, not that the learner can reliably apply it -- neither
// should count as scored evidence toward a practical target level.
function buildPrompt({ skillName, targetLevel, selfLevel, selfComments, activities, peerRatings }) {
  const lines = []
  lines.push(`Skill: "${skillName.trim()}"`)
  lines.push(`Target level the learner is trying to reach: "${targetLevel}".`)
  lines.push('')
  lines.push(
    'Practical proficiency scale (low to high): Beginner, Developing, Capable, Skilled, Expert.'
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

  return `You are validating whether a learner has reached a target *practical* proficiency level for a skill they are tracking, by weighing everything they have recorded as evidence of what they can actually do. Practical proficiency means applying the skill, not just having studied it -- do not treat familiarity or understanding as proof of practical capability.

${lines.join('\n')}

Weigh all the available evidence -- self-assessment, recorded activity, and peer ratings (using the given weights) -- to propose a single overall current level from this scale: 1=Beginner, 2=Developing, 3=Capable, 4=Skilled, 5=Expert. A single demonstration is weaker evidence than repeated or varied application -- weigh repetition and variety of context accordingly. If little or no evidence is available, default toward a conservative (lower) estimate rather than guessing high.

Decide "passed" as true only if the evidence clearly supports the learner having reached the target level ("${targetLevel}") or higher; otherwise false.

Write "feedback" as 2-5 sentences addressed directly to the learner: if passed, briefly explain what evidence supports it. If not passed, explain the gap and give concrete, actionable tips on what to do next to close it (e.g. specific practice, evidence to gather, or training to pursue).`
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

  const { skillName, targetLevel, selfLevel, selfComments, activities, peerRatings } = req.body ?? {}
  if (!skillName || typeof skillName !== 'string') {
    res.status(400).json({ error: 'Missing skillName' })
    return
  }
  if (!targetLevel || typeof targetLevel !== 'string') {
    res.status(400).json({ error: 'Missing targetLevel' })
    return
  }

  const prompt = buildPrompt({ skillName, targetLevel, selfLevel, selfComments, activities, peerRatings })

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      output_config: {
        format: { type: 'json_schema', schema: VALIDATION_SCHEMA },
      },
      messages: [{ role: 'user', content: prompt }],
    })

    if (response.stop_reason === 'refusal') {
      res.status(422).json({ error: "Couldn't validate this skill." })
      return
    }

    const textBlock = response.content.find((b) => b.type === 'text')
    const data = JSON.parse(textBlock.text)
    const level = Math.min(5, Math.max(1, Math.round(Number(data.level) || 1)))
    res.status(200).json({ level, passed: Boolean(data.passed), feedback: data.feedback })
  } catch (err) {
    console.error('validate-skill error:', err)
    res.status(500).json({ error: 'Failed to validate skill.' })
  }
}
