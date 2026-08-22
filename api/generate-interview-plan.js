import Anthropic from '@anthropic-ai/sdk'
import { verifySupabaseUser } from './_lib/auth.js'
import { supabaseAdmin } from './_lib/supabaseAdmin.js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    openingQuestion: { type: 'string' },
    topics: { type: 'array', items: { type: 'string' } },
    rubric: { type: 'string' },
  },
  required: ['openingQuestion', 'topics', 'rubric'],
  additionalProperties: false,
}

const PROMPT_VERSION = 1

const KNOWLEDGE_LEVEL_LABELS = {
  1: 'Unfamiliar',
  2: 'Aware',
  3: 'Familiar',
  4: 'Knowledgeable',
  5: 'Deep understanding',
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

  const { skillName, level, librarySkillId } = req.body ?? {}
  if (!skillName || typeof skillName !== 'string') {
    res.status(400).json({ error: 'Missing skillName' })
    return
  }
  if (!level || level < 1 || level > 5) {
    res.status(400).json({ error: 'Missing or invalid level' })
    return
  }

  const admin = supabaseAdmin()

  if (librarySkillId) {
    const { data: cached } = await admin
      .from('skill_diagnostic_content')
      .select('id, content')
      .eq('diagnostic_type', 'interview')
      .eq('axis', 'knowledge')
      .eq('library_skill_id', librarySkillId)
      .eq('level', level)
      .eq('prompt_version', PROMPT_VERSION)
      .maybeSingle()
    if (cached) {
      res.status(200).json({ diagnosticContentId: cached.id, content: cached.content })
      return
    }
  }

  const levelLabel = KNOWLEDGE_LEVEL_LABELS[level]
  const prompt = `You are preparing a short conversational interview to verify whether someone's theoretical knowledge of "${skillName.trim()}" genuinely reaches the "${levelLabel}" level (level ${level} of 5 on this scale: 1 Unfamiliar, 2 Aware, 3 Familiar, 4 Knowledgeable, 5 Deep understanding).

Produce:
- openingQuestion: a single warm, conversational opening question (1-2 sentences) that gets them talking about their understanding of this skill.
- topics: 4-6 short topic/concept labels this interview should probe to distinguish someone genuinely at level ${level} from someone below it.
- rubric: 2-4 sentences describing what a genuine level-${level} answer sounds like versus a weaker one, for an interviewer to judge against.

Pitch everything specifically at level ${level} ("${levelLabel}") -- not easier, not harder.`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      output_config: {
        format: { type: 'json_schema', schema: PLAN_SCHEMA },
      },
      messages: [{ role: 'user', content: prompt }],
    })

    if (response.stop_reason === 'refusal') {
      res.status(422).json({ error: "Couldn't prepare an interview for this skill." })
      return
    }

    const textBlock = response.content.find((b) => b.type === 'text')
    const plan = JSON.parse(textBlock.text)
    // Clamped to the same bounds api/interview-turn.js validates on the way
    // back in, so a cached plan can never fail that check later.
    const content = {
      interactionType: 'interview',
      openingQuestion: plan.openingQuestion,
      topics: (plan.topics ?? []).slice(0, 8).map((t) => String(t).slice(0, 200)),
      rubric: String(plan.rubric ?? '').slice(0, 1000),
    }

    if (!librarySkillId) {
      res.status(200).json({ diagnosticContentId: null, content })
      return
    }

    const { data: inserted, error: insertError } = await admin
      .from('skill_diagnostic_content')
      .insert({
        diagnostic_type: 'interview',
        axis: 'knowledge',
        library_skill_id: librarySkillId,
        skill_name: skillName.trim(),
        level,
        content,
        prompt_version: PROMPT_VERSION,
      })
      .select('id, content')
      .single()

    if (insertError) {
      // Another request generated and cached this identity first -- reuse it.
      if (insertError.code === '23505') {
        const { data: existing } = await admin
          .from('skill_diagnostic_content')
          .select('id, content')
          .eq('diagnostic_type', 'interview')
          .eq('axis', 'knowledge')
          .eq('library_skill_id', librarySkillId)
          .eq('level', level)
          .eq('prompt_version', PROMPT_VERSION)
          .single()
        if (existing) {
          res.status(200).json({ diagnosticContentId: existing.id, content: existing.content })
          return
        }
      }
      throw insertError
    }

    res.status(200).json({ diagnosticContentId: inserted.id, content: inserted.content })
  } catch (err) {
    console.error('generate-interview-plan error:', err)
    res.status(500).json({ error: 'Failed to prepare interview.' })
  }
}
