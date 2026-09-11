import { supabase } from '../supabaseClient'

export async function ltiRequest(action, values = {}) {
  const { data } = await supabase.auth.getSession()
  const response = await fetch(`/api/lti/${action}`, { method:'POST', headers:{'Content-Type':'application/json','X-Lti-Session':sessionStorage.getItem('lti-session') || '',...(data.session ? {Authorization:`Bearer ${data.session.access_token}`}:{})},body:JSON.stringify(values) })
  const result = await response.json()
  if(!response.ok) throw new Error(result.error || 'Unable to connect to your LMS.')
  return result
}
