import { supabase } from '../supabaseClient'

export async function getAiUsageDashboard(days = 30) {
  const { data, error } = await supabase.rpc('get_ai_usage_dashboard', { p_days: days })
  if (error) throw error
  return data
}
