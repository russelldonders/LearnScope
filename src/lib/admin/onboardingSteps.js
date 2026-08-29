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
