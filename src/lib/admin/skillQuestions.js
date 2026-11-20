import { supabase } from '../supabaseClient'
import { newInteractiveBlock, normalisePageDocument } from '../pageBuilder'

// A skill's knowledge-check question pool, per level (skill_questions,
// migration 0323) -- managed by platform admins from the skill library.
// Each question is a course-builder scored question (`test_question` block).
// Questions are deactivated rather than deleted.

export const QUESTION_TYPE_LABELS = {
  single: 'One answer',
  multiple: 'Several answers',
  true_false: 'True / false',
  short_text: 'Short answer',
  number: 'Number',
  ordering: 'Ordering',
  matching: 'Matching',
}

export async function listSkillQuestions(librarySkillId, level) {
  const { data, error } = await supabase
    .from('skill_questions')
    .select('id, level, question_type, question, status, source, created_at, updated_at')
    .eq('library_skill_id', librarySkillId)
    .eq('axis', 'knowledge')
    .eq('level', level)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// { [level]: { active, inactive } } for the skill library page.
export async function countSkillQuestionsByLevel(librarySkillId) {
  const { data, error } = await supabase
    .from('skill_questions')
    .select('level, status')
    .eq('library_skill_id', librarySkillId)
    .eq('axis', 'knowledge')
  if (error) throw error
  const counts = {}
  for (const row of data ?? []) {
    counts[row.level] ??= { active: 0, inactive: 0 }
    counts[row.level][row.status === 'active' ? 'active' : 'inactive'] += 1
  }
  return counts
}

export function newSkillQuestion() {
  return { ...newInteractiveBlock('test_question'), title: '' }
}

// The question as it will be stored, or a plain-language reason it can't be.
export function prepareSkillQuestion(block) {
  const question = normalisePageDocument({ blocks: [{ ...block, type: 'test_question' }] }).blocks[0]
  if (!question || question.type !== 'test_question') return { error: 'This question could not be read.' }
  if (!question.title) return { error: 'Write the question.' }
  const items = question.items
  const correct = items.filter((item) => item.correct).length
  switch (question.layout) {
    case 'single':
    case 'true_false':
      if (items.filter((item) => item.label).length < 2) return { error: 'Add at least two answers.' }
      if (correct !== 1) return { error: 'Mark exactly one answer as right.' }
      break
    case 'multiple':
      if (items.filter((item) => item.label).length < 2) return { error: 'Add at least two answers.' }
      if (correct === 0) return { error: 'Mark at least one answer as right.' }
      if (correct === items.length) return { error: 'At least one answer must be wrong.' }
      break
    case 'short_text':
      if (!items.some((item) => item.label)) return { error: 'Add at least one accepted answer.' }
      break
    case 'number':
      if (!items.length) return { error: 'Add the right number.' }
      break
    case 'ordering':
      if (items.filter((item) => item.label).length < 2) return { error: 'Add at least two steps.' }
      break
    case 'matching':
      if (items.length < 2) return { error: 'Add at least two pairs.' }
      if (items.some((item) => !item.label || !item.detail)) return { error: 'Every pair needs both sides.' }
      break
    default:
      return { error: 'Choose a question type.' }
  }
  return { question: { ...question, points: 1 } }
}

export async function addSkillQuestion({ userId, librarySkillId, level, block }) {
  const { question, error: invalid } = prepareSkillQuestion(block)
  if (invalid) throw new Error(invalid)
  const { data, error } = await supabase
    .from('skill_questions')
    .insert({
      library_skill_id: librarySkillId,
      axis: 'knowledge',
      level,
      question_type: question.layout,
      question,
      source: 'manual',
      created_by: userId,
    })
    .select('id, level, question_type, question, status, source, created_at, updated_at')
    .single()
  if (error) throw error
  return data
}

export async function updateSkillQuestion(id, block) {
  const { question, error: invalid } = prepareSkillQuestion(block)
  if (invalid) throw new Error(invalid)
  const { data, error } = await supabase
    .from('skill_questions')
    .update({ question, question_type: question.layout })
    .eq('id', id)
    .select('id, level, question_type, question, status, source, created_at, updated_at')
    .single()
  if (error) throw error
  return data
}

export async function setSkillQuestionStatus(id, status) {
  const { data, error } = await supabase
    .from('skill_questions')
    .update({ status })
    .eq('id', id)
    .select('id, level, question_type, question, status, source, created_at, updated_at')
    .single()
  if (error) throw error
  return data
}

// Generated and stored server-side (AI key, answer-quality checks); not
// limited by the 100-question cap learners' quizzes grow to.
export async function generateSkillQuestions({ librarySkillId, level, count }) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const res = await fetch('/api/generate-diagnostic-quiz', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ mode: 'admin_generate', librarySkillId, level, count }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || 'Failed to generate questions.')
  return body.added ?? 0
}
