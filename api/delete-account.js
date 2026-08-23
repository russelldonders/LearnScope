import { createClient } from '@supabase/supabase-js'
import { verifySupabaseUser } from './_lib/auth.js'
import { supabaseAdmin } from './_lib/supabaseAdmin.js'

const EVIDENCE_BUCKETS = ['skill-evidence', 'avatars']
const LIST_PAGE_SIZE = 100

// Storage .list() only returns one level at a time (paginated, 100 per page
// by default), and doesn't distinguish files from "folders" other than by
// the presence of metadata -- recurse until every entry under the prefix has
// metadata (i.e. is an actual file), paging through each level so an account
// with more than 100 evidence files/folders doesn't leave any behind.
async function listAllFiles(admin, bucket, prefix) {
  const paths = []
  let offset = 0
  while (true) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: LIST_PAGE_SIZE, offset })
    if (error) throw error
    for (const entry of data ?? []) {
      const entryPath = `${prefix}/${entry.name}`
      if (entry.id) {
        paths.push(entryPath)
      } else {
        paths.push(...(await listAllFiles(admin, bucket, entryPath)))
      }
    }
    if (!data || data.length < LIST_PAGE_SIZE) break
    offset += LIST_PAGE_SIZE
  }
  return paths
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
  const accessToken = authHeader.slice(7)

  const user = await verifySupabaseUser(accessToken)
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired session' })
    return
  }

  try {
    // Request-scoped client carrying the caller's own JWT, so auth.uid()
    // resolves inside the RPC and it can only ever act on their own rows.
    const asUser = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    })
    const { error: scrubError } = await asUser.rpc('delete_own_account_scrub')
    if (scrubError) throw scrubError

    // From here on, the pre-deletion scrub has already committed (PII
    // stripped from other learners' records). If anything below fails, the
    // account survives but that scrub can't be undone -- log it distinctly
    // so a partial failure doesn't read the same as an ordinary one.
    try {
      const admin = supabaseAdmin()

      for (const bucket of EVIDENCE_BUCKETS) {
        const paths = await listAllFiles(admin, bucket, user.id)
        if (paths.length > 0) {
          const { error: removeError } = await admin.storage.from(bucket).remove(paths)
          if (removeError) throw removeError
        }
      }

      const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
      if (deleteError) throw deleteError
    } catch (err) {
      console.error(`delete-account PARTIAL FAILURE for user ${user.id}: scrub already committed, account NOT deleted -`, err)
      res.status(500).json({ error: 'Failed to delete account.' })
      return
    }

    res.status(200).json({ ok: true })
  } catch (err) {
    console.error(`delete-account error for user ${user.id}:`, err)
    res.status(500).json({ error: 'Failed to delete account.' })
  }
}
