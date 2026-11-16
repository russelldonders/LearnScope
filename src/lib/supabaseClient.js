import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const IMPERSONATION_BOOTSTRAP_KEY = 'learnscope:impersonation-bootstrap'
const IMPERSONATION_STATE_KEY = 'learnscope:impersonation-state'

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in your Supabase project credentials.'
  )
}

function browserSessionStorage() {
  return typeof window === 'undefined' ? null : window.sessionStorage
}

export function readImpersonationState() {
  const storage = browserSessionStorage()
  if (!storage) return null
  try {
    return JSON.parse(storage.getItem(IMPERSONATION_STATE_KEY))
  } catch {
    return null
  }
}

export function readImpersonationBootstrap() {
  const storage = browserSessionStorage()
  if (!storage) return null
  try {
    return JSON.parse(storage.getItem(IMPERSONATION_BOOTSTRAP_KEY))
  } catch {
    return null
  }
}

export function activateImpersonationState(state) {
  browserSessionStorage()?.setItem(IMPERSONATION_STATE_KEY, JSON.stringify(state))
  browserSessionStorage()?.removeItem(IMPERSONATION_BOOTSTRAP_KEY)
}

export function clearImpersonationState() {
  browserSessionStorage()?.removeItem(IMPERSONATION_STATE_KEY)
  browserSessionStorage()?.removeItem(IMPERSONATION_BOOTSTRAP_KEY)
}

// An impersonation preview is opened in its own window. Giving that window a
// separate, tab-scoped storage key prevents its target-user session from ever
// replacing the administrator's normal localStorage session in the console.
const isImpersonationWindow = Boolean(readImpersonationBootstrap() || readImpersonationState())

async function guardedFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input.url
  const method = (init.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase()
  if (readImpersonationState() && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const target = new URL(url, window.location.origin)
    const isAuthMutation = target.href.startsWith(`${supabaseUrl}/auth/v1/`)
    const isStorageMutation = target.href.startsWith(`${supabaseUrl}/storage/v1/`)
    const isDirectTableMutation = target.href.startsWith(`${supabaseUrl}/rest/v1/`)
      && !target.pathname.includes('/rpc/')
    if (isAuthMutation || isStorageMutation || isDirectTableMutation) {
      return new Response(JSON.stringify({ message: 'This user preview is read-only.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }
  return fetch(input, init)
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: isImpersonationWindow
    ? {
        storage: browserSessionStorage(),
        storageKey: 'learnscope-impersonation-auth',
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      }
    : undefined,
  global: { fetch: guardedFetch },
})
