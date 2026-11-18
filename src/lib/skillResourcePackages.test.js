import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ calls: [], insert: vi.fn(), update: vi.fn(), remove: vi.fn(), list: vi.fn() }))
const content = vi.hoisted(() => ({
  readPackage: vi.fn(),
  uploadZipEntries: vi.fn(),
  removeStorageFolder: vi.fn(),
  scormLaunchUrl: (item) => `/course-content/${item.storage_path}/${item.launch_path}`,
}))

vi.mock('./supabaseClient', () => ({
  supabase: {
    from: () => ({
      insert: (row) => { db.calls.push('insert'); return db.insert(row) },
      update: (row) => ({ eq: (_, id) => { db.calls.push('update'); return db.update(row, id) } }),
      delete: () => ({ eq: (_, id) => { db.calls.push('delete'); return db.remove(id) } }),
    }),
    storage: { from: () => ({ list: db.list }) },
  },
}))
vi.mock('./courseContent', () => content)

const { addResource, adminDeleteRemovedPackageFiles, deleteResource, packageLaunchUrl, audiencesFor } = await import('./skillResources')

const zip = { name: 'course.zip', size: 1000 }
const base = { userId: 'u1', skillId: 's1', title: ' Course ', audience: 'private' }

beforeEach(() => {
  vi.clearAllMocks()
  db.calls = []
  vi.spyOn(crypto, 'randomUUID').mockReturnValue('r1')
  content.readPackage.mockResolvedValue({ zip: 'ZIP', launchPath: 'index.html' })
  content.uploadZipEntries.mockImplementation(async () => { db.calls.push('upload') })
  content.removeStorageFolder.mockResolvedValue()
  db.insert.mockResolvedValue({ error: null })
  db.update.mockResolvedValue({ error: null })
  db.remove.mockResolvedValue({ error: null })
})

describe('SCORM and xAPI packages on a skill', () => {
  it('adds the resource privately, unpacks into its own folder, then shares it', async () => {
    expect(await addResource({ ...base, kind: 'xapi', file: zip, audience: 'connections' })).toBe('r1')
    expect(content.readPackage).toHaveBeenCalledWith(zip, 'xapi')
    expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'r1', user_id: 'u1', skill_id: 's1', kind: 'xapi', title: 'Course', audience: 'private',
      package_path: 'learners/u1/r1', launch_path: 'index.html', file_name: 'course.zip', file_size: 1000,
    }))
    expect(content.uploadZipEntries).toHaveBeenCalledWith('ZIP', 'learners/u1/r1')
    expect(db.update).toHaveBeenCalledWith({ audience: 'connections' }, 'r1')
    // Storage only takes a package for a resource that already exists.
    expect(db.calls).toEqual(['insert', 'upload', 'update'])
  })

  it('stays private without a second write when that was the choice', async () => {
    await addResource({ ...base, kind: 'scorm', file: zip })
    expect(db.update).not.toHaveBeenCalled()
  })

  it('removes the files and the resource if the upload fails', async () => {
    content.uploadZipEntries.mockRejectedValue(new Error('nope'))
    await expect(addResource({ ...base, kind: 'scorm', file: zip })).rejects.toThrow('nope')
    expect(content.removeStorageFolder).toHaveBeenCalledWith('learners/u1/r1')
    expect(db.remove).toHaveBeenCalledWith('r1')
  })

  it('uploads nothing if the resource can\'t be added', async () => {
    db.insert.mockResolvedValue({ error: new Error('denied') })
    await expect(addResource({ ...base, kind: 'scorm', file: zip })).rejects.toThrow('denied')
    expect(content.uploadZipEntries).not.toHaveBeenCalled()
  })

  it('refuses a package over 200MB before reading it', async () => {
    await expect(addResource({ ...base, kind: 'scorm', file: { name: 'big.zip', size: 201 * 1024 * 1024 } })).rejects.toThrow(/too large/)
    expect(content.readPackage).not.toHaveBeenCalled()
  })

  it('removes the package folder with the resource', async () => {
    await deleteResource({ id: 'r1', package_path: 'learners/u1/r1' })
    expect(content.removeStorageFolder).toHaveBeenCalledWith('learners/u1/r1')
  })

  it('opens from its launch page, and can be shared like a link', () => {
    expect(packageLaunchUrl({ package_path: 'learners/u1/r1', launch_path: 'a/index.html' })).toBe('/course-content/learners/u1/r1/a/index.html')
    expect(packageLaunchUrl({ package_path: null, launch_path: null })).toBeNull()
    expect(audiencesFor('scorm', { hasLibrarySkill: true })).toContain('skill_public')
  })

  it('won\'t open a launch page that leads outside the package', () => {
    expect(packageLaunchUrl({ package_path: 'learners/u1/r1', launch_path: '%2e%2e/%2e%2e/r2/index.html' })).toBeNull()
    expect(packageLaunchUrl({ package_path: 'learners/u1/r1', launch_path: '../r2/index.html' })).toBeNull()
  })
})

describe('deleting a package moderators removed', () => {
  it('removes its folder and checks nothing is left', async () => {
    db.list.mockResolvedValue({ data: [], error: null })
    await adminDeleteRemovedPackageFiles('learners/u1/r1')
    expect(content.removeStorageFolder).toHaveBeenCalledWith('learners/u1/r1')
    expect(db.list).toHaveBeenCalledWith('learners/u1/r1', { limit: 1 })
  })

  it('says so when storage quietly kept some files', async () => {
    db.list.mockResolvedValue({ data: [{ name: 'index.html', id: 'f1' }], error: null })
    await expect(adminDeleteRemovedPackageFiles('learners/u1/r1')).rejects.toThrow(/could not be deleted/)
  })
})
