import Anthropic from '@anthropic-ai/sdk'
import { verifySupabaseUser } from './_lib/auth.js'
import { supabaseAdmin } from './_lib/supabaseAdmin.js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const QUIZ_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          correctIndex: { type: 'integer' },
        },
        required: ['question', 'options', 'correctIndex'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
}

const KNOWLEDGE_LEVEL_LABELS = {
  1: 'Unfamiliar',
  2: 'Aware',
  3: 'Familiar',
  4: 'Knowledgeable',
  5: 'Deep understanding',
}

function toDiagnosticContent(questions) {
  return {
    interactionType: 'choice',
    questions: questions.map((q, i) => ({
      id: `q${i + 1}`,
      description: { 'en-US': q.question },
      choices: q.options.map((opt, j) => ({
        id: String.fromCharCode(97 + j),
        description: { 'en-US': opt },
      })),
      correctResponsesPattern: [String.fromCharCode(97 + q.correctIndex)],
    })),
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
      .eq('diagnostic_type', 'quiz')
      .eq('axis', 'knowledge')
      .eq('library_skill_id', librarySkillId)
      .eq('level', level)
      .eq('prompt_version', 1)
      .maybeSingle()
    if (cached) {
      res.status(200).json({ diagnosticContentId: cached.id, content: cached.content })
      return
    }
  }

  const levelLabel = KNOWLEDGE_LEVEL_LABELS[level]
  const prompt = `Write a 10-question multiple-choice quiz that tests whether someone's theoretical knowledge of "${skillName.trim()}" genuinely matches the "${levelLabel}" level (level ${level} of 5 on this scale: 1 Unfamiliar, 2 Aware, 3 Familiar, 4 Knowledgeable, 5 Deep understanding).

Pitch every question's difficulty and depth specifically at level ${level} ("${levelLabel}") -- someone genuinely at this level should be able to answer most of these correctly, and someone below it should struggle with several. Avoid trick questions. Each question needs exactly 4 answer options with exactly one correct answer (correctIndex is the 0-based index of the correct option).

Return exactly 10 questions.`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      output_config: {
        format: { type: 'json_schema', schema: QUIZ_SCHEMA },
      },
      messages: [{ role: 'user', content: prompt }],
    })

    if (response.stop_reason === 'refusal') {
      res.status(422).json({ error: "Couldn't generate a knowledge check for this skill." })
      return
    }

    const textBlock = response.content.find((b) => b.type === 'text')
    const { questions } = JSON.parse(textBlock.text)
    const content = toDiagnosticContent(questions)

    if (!librarySkillId) {
      res.status(200).json({ diagnosticContentId: null, content })
      return
    }

    const { data: inserted, error: insertError } = await admin
      .from('skill_diagnostic_content')
      .insert({
        diagnostic_type: 'quiz',
        axis: 'knowledge',
        library_skill_id: librarySkillId,
        skill_name: skillName.trim(),
        level,
        content,
      })
      .select('id, content')
      .single()

    if (insertError) {
      // Another request generated and cached this identity first -- reuse it.
      if (insertError.code === '23505') {
        const { data: existing } = await admin
          .from('skill_diagnostic_content')
          .select('id, content')
          .eq('diagnostic_type', 'quiz')
          .eq('axis', 'knowledge')
          .eq('library_skill_id', librarySkillId)
          .eq('level', level)
          .eq('prompt_version', 1)
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
    console.error('generate-diagnostic-quiz error:', err)
    res.status(500).json({ error: 'Failed to generate knowledge check.' })
  }
}
