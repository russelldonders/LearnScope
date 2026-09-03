import { supabase } from '../supabaseClient'

export async function listAllOnboardingSteps() {
  const { data, error } = await supabase
    .from('onboarding_steps')
    .select('key, label, enabled, order_index')
    .order('order_index')
  if (error) throw error
  return data ?? []
}

export async function setOnboardingStepEnabled(key, enabled) {
  const { error } = await supabase
    .from('onboarding_steps')
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq('key', key)
  if (error) throw error
}

// Moves one step earlier/later in the sequence by swapping its order_index
// with its immediate neighbour's -- a no-op at either end of the list.
// Re-reads the current order first rather than trusting a caller-supplied
// list, so this stays correct even if another admin changed the order
// since this page last loaded. Written generally (find neighbour by
// position, not by an assumed 2-row table) so it keeps working if a third
// step is ever added.
export async function reorderOnboardingStep(key, direction) {
  const steps = await listAllOnboardingSteps()
  const index = steps.findIndex((s) => s.key === key)
  if (index === -1) return

  const neighbourIndex = direction === 'up' ? index - 1 : index + 1
  if (neighbourIndex < 0 || neighbourIndex >= steps.length) return

  const current = steps[index]
  const neighbour = steps[neighbourIndex]
  const updated_at = new Date().toISOString()

  const { error: errA } = await supabase
    .from('onboarding_steps')
    .update({ order_index: neighbour.order_index, updated_at })
    .eq('key', current.key)
  if (errA) throw errA

  const { error: errB } = await supabase
    .from('onboarding_steps')
    .update({ order_index: current.order_index, updated_at })
    .eq('key', neighbour.key)
  if (errB) throw errB
}
