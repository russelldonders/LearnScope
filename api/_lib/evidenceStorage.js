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

// Shared by the self-service delete-account path and the platform-admin
// hard-delete action -- both need every evidence file under a user's own
// storage prefix removed before (or as part of) deleting the account.
export async function deleteUserEvidenceFiles(admin, userId) {
  for (const bucket of EVIDENCE_BUCKETS) {
    const paths = await listAllFiles(admin, bucket, userId)
    if (paths.length > 0) {
      const { error } = await admin.storage.from(bucket).remove(paths)
      if (error) throw error
    }
  }
}
