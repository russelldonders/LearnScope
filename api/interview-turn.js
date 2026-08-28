import Anthropic from '@anthropic-ai/sdk'
import { verifySupabaseUser } from './_lib/auth.js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Caps the number of learner answers per interview so cost/time stay bounded
// and the flow doesn't ramble -- mirrors the fixed-length quiz's implicit
// bound (10 questions). The model is instructed to wrap up on its own well
// before this; it's a hard backstop, not the target length.
const MAX_LEARNER_TURNS = 6

const TURN_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    done: { type: 'boolean' },
    confirmedLevel: { type: 'integer' },
    reasoning: { type: 'string' },
  },
  required: ['message', 'done', 'confirmedLevel', 'reasoning'],
  additionalProperties: false,
}

const KNOWLEDGE_LEVEL_LABELS = {
  1: 'Unfamiliar',
  2: 'Aware',
  3: 'Familiar',
  4: 'Knowledgeable',
  5: 'Deep understanding',
}

function buildSystemPrompt({ skillName, level, calibrate, plan, mustConclude }) {
  const levelLabel = KNOWLEDGE_LEVEL_LABELS[level]
  const intro = calibrate
    ? `You are conducting a short spoken-style interview to find out, from scratch, what level a learner's theoretical knowledge of "${skillName.trim()}" genuinely reaches on this scale: 1 Unfamiliar, 2 Aware, 3 Familiar, 4 Knowledgeable, 5 Deep understanding. Nothing is known about their level yet, so start with an accessible question and let their answers tell you how far to push -- move to harder ground quickly if they're clearly beyond the basics, or stay foundational if they're not.`
    : `You are conducting a short spoken-style interview to verify whether a learner's theoretical knowledge of "${skillName.trim()}" genuinely reaches the "${levelLabel}" level (level ${level} of 5: 1 Unfamiliar, 2 Aware, 3 Familiar, 4 Knowledgeable, 5 Deep understanding).`
  const conclusion = calibrate
    ? `Once you have enough evidence to place them confidently, conclude the interview: set done to true, give a confirmedLevel 1-5 reflecting what they actually demonstrated, and a 2-4 sentence reasoning explaining your judgement. Base it entirely on what they showed, not what they claimed -- there's no ceiling and no floor to protect, just your honest read of where they land.`
    : `Once you have enough evidence (this doesn't need to cover every topic), conclude the interview: set done to true, give a confirmedLevel 1-${level} reflecting what they actually demonstrated -- not what they claimed -- and a 2-4 sentence reasoning explaining your judgement. The confirmed level can never exceed ${level}: this interview only checks whether they meet the level they were pitched at, the same standard a passing quiz score would confirm -- it doesn't promote them beyond it even if they seem to know more. Don't inflate the level out of politeness either; if their answers don't support level ${level}, confirm a lower one instead.`
  return `${intro}

Topics to probe: ${plan.topics.join('; ')}
Rubric: ${plan.rubric}

Ask one focused, conversational question at a time -- never a list of questions. Follow up naturally on their previous answer: probe deeper if it's vague, move to a new topic once they've clearly shown (or clearly lack) understanding of the current one. Keep each message to 1-3 sentences of plain spoken language -- it may be read aloud.

${conclusion} While done is false, still fill confirmedLevel with your current best-guess level and reasoning with a short note-to-self -- they won't be shown to the learner until done is true.${
    mustConclude
      ? "\n\nThis must be your final turn: set done to true now, regardless of how many topics you've covered. Your message this turn must be a short closing remark (e.g. thanking them, or a one-line summary) -- not a new question, since they won't get to answer one."
      : ''
  }`
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

  const { skillName, level, calibrate, plan, transcript } = req.body ?? {}
  if (!skillName || typeof skillName !== 'string' || skillName.length > 200) {
    res.status(400).json({ error: 'Missing or invalid skillName' })
    return
  }
  if (!calibrate && (!level || level < 1 || level > 5)) {
    res.status(400).json({ error: 'Missing or invalid level' })
    return
  }
  // plan is echoed back into every turn's system prompt rather than
  // re-fetched from the shared cache -- this is a stateless endpoint with no
  // server-held session, so nothing else stops a client sending an
  // arbitrarily large plan on every call. Bound it the same way the
  // transcript is bounded below.
  if (
    !Array.isArray(plan?.topics) ||
    plan.topics.length === 0 ||
    plan.topics.length > 8 ||
    !plan.topics.every((t) => typeof t === 'string' && t.length <= 200) ||
    typeof plan?.rubric !== 'string' ||
    plan.rubric.length === 0 ||
    plan.rubric.length > 1000
  ) {
    res.status(400).json({ error: 'Missing or invalid interview plan' })
    return
  }
  if (!Array.isArray(transcript) || transcript.length === 0 || transcript[0]?.role !== 'user') {
    res.status(400).json({ error: 'Transcript must start with the learner\'s first answer' })
    return
  }
  if (!transcript.every((t) => (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')) {
    res.status(400).json({ error: 'Malformed transcript' })
    return
  }
  // A legitimate transcript never exceeds 2 * MAX_LEARNER_TURNS - 1 entries
  // (alternating turns starting with the learner); this is a stateless
  // endpoint with no server-held session, so nothing else stops a client
  // from submitting an oversized, hand-crafted transcript to run up cost.
  if (transcript.length > 2 * MAX_LEARNER_TURNS - 1 || transcript.some((t) => t.content.length > 4000)) {
    res.status(400).json({ error: 'Transcript is too long' })
    return
  }

  const turnCount = transcript.filter((t) => t.role === 'user').length
  const mustConclude = turnCount >= MAX_LEARNER_TURNS

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: buildSystemPrompt({ skillName, level, calibrate, plan, mustConclude }),
      output_config: {
        format: { type: 'json_schema', schema: TURN_SCHEMA },
      },
      messages: transcript.map((t) => ({ role: t.role, content: t.content })),
    })

    if (response.stop_reason === 'refusal') {
      res.status(422).json({ error: "Couldn't continue the interview." })
      return
    }

    const textBlock = response.content.find((b) => b.type === 'text')
    const data = JSON.parse(textBlock.text)
    const done = mustConclude ? true : Boolean(data.done)
    // Confirming mode clamps to `level` (the pitched level), not the global
    // 1-5 range -- same ceiling the quiz enforces (a pass confirms the
    // pitched level, it never promotes beyond it). Calibrating mode has no
    // such ceiling: the model is finding the level from scratch, so only the
    // scale's own 1-5 bounds apply. See buildSystemPrompt above.
    const ceiling = calibrate ? 5 : level
    const confirmedLevel = Math.min(ceiling, Math.max(1, Math.round(Number(data.confirmedLevel) || ceiling)))
    res.status(200).json({ message: data.message, done, confirmedLevel, reasoning: data.reasoning })
  } catch (err) {
    console.error('interview-turn error:', err)
    res.status(500).json({ error: 'Failed to continue the interview.' })
  }
}
