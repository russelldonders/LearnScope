import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { updateOrganisation, uploadOrganisationLogo, removeOrganisationLogo, listOrganisationMembers } from '../lib/admin/organisations'
import { listCatalogueApprovers, addCatalogueApprover, removeCatalogueApprover } from '../lib/admin/catalogue'
import AccessibleDialog from './AccessibleDialog'

const MAX_LOGO_BYTES = 5 * 1024 * 1024

// The provider console's settings cog -- website/about are a plain form
// (saved together on submit), but the logo uploads/removes immediately on
// selection, same UX as ProfilePhoto.jsx's avatar upload, since it's a
// separate storage operation rather than a organisations-row field edit.
// Only ever rendered for an org admin (0081's RLS enforces this
// independently of who the UI lets open it).
export default function OrganisationSettingsModal({ organisation, onClose }) {
  const [url, setUrl] = useState(organisation.url ?? '')
  const [about, setAbout] = useState(organisation.about ?? '')
  const [logoUrl, setLogoUrl] = useState(organisation.logo_url ?? null)
  const [publicProfileEnabled, setPublicProfileEnabled] = useState(organisation.public_profile_enabled ?? false)
  // Tracks what's actually persisted, separately from the checkbox above --
  // the link/copy/pop-out block reads this, not the live checkbox, so
  // toggling it on doesn't surface a "working" link before Save has
  // actually made the public page live.
  const [savedPublicProfileEnabled, setSavedPublicProfileEnabled] = useState(organisation.public_profile_enabled ?? false)
  const [saving, setSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)
  const fileInputRef = useRef(null)

  const publicProfileUrl = `${window.location.origin}/providers/${organisation.slug}`

  function handleCopyLink() {
    navigator.clipboard.writeText(publicProfileUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleLogoChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.')
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError('That image is too large (max 5MB).')
      return
    }
    setError(null)
    setUploadingLogo(true)
    try {
      setLogoUrl(await uploadOrganisationLogo(organisation.id, file))
    } catch (err) {
      setError(err.message)
    } finally {
      setUploadingLogo(false)
    }
  }

  async function handleRemoveLogo() {
    setUploadingLogo(true)
    setError(null)
    try {
      await removeOrganisationLogo(organisation.id)
      setLogoUrl(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setUploadingLogo(false)
    }
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await updateOrganisation(organisation.id, { url, about, publicProfileEnabled })
      setSavedPublicProfileEnabled(publicProfileEnabled)
      // Stay open when the public page is (now) enabled, so there's a
      // moment to actually copy/open the link this save just made live --
      // otherwise close as before.
      if (!publicProfileEnabled) onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="organisation-settings-dialog-title"
      onClose={onClose}
      overlayClassName="z-[60]"
      panelClassName="w-full max-w-lg bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
        <h2 id="organisation-settings-dialog-title" className="font-display text-lg text-ink mb-4">Organisation settings</h2>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm text-secondary mb-1">Logo</label>
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-md overflow-hidden border border-hairline bg-paper flex items-center justify-center shrink-0">
                {logoUrl ? (
                  <img src={logoUrl} alt="" className="w-full h-full object-contain" />
                ) : (
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-secondary"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="M21 15l-5-5L5 21" />
                  </svg>
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingLogo}
                    className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
                  >
                    {uploadingLogo ? 'Uploading…' : logoUrl ? 'Change logo' : 'Upload logo'}
                  </button>
                  {logoUrl && (
                    <button
                      type="button"
                      onClick={handleRemoveLogo}
                      disabled={uploadingLogo}
                      className="text-sm text-secondary hover:text-red-700 disabled:opacity-60"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleLogoChange} className="hidden" />
            </div>
          </div>

          <div>
            <label className="block text-sm text-secondary mb-1" htmlFor="orgSettingsUrl">
              Website
            </label>
            <input
              id="orgSettingsUrl"
              type="url"
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
          </div>

          <div>
            <label className="block text-sm text-secondary mb-1" htmlFor="orgSettingsAbout">
              About us
            </label>
            <textarea
              id="orgSettingsAbout"
              rows={4}
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              placeholder="What your organisation offers, who you work with…"
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
          </div>

          <div className="border-t border-hairline pt-4">
            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={publicProfileEnabled}
                onChange={(e) => setPublicProfileEnabled(e.target.checked)}
                className="mt-0.5 rounded border-hairline"
              />
              <span>
                Show a public provider page
                <span className="block text-xs text-secondary mt-0.5 font-normal">
                  Lists the skills you offer and your approved training courses -- visible to anyone with the
                  link, including people who aren't logged in.
                </span>
              </span>
            </label>
            {publicProfileEnabled && !savedPublicProfileEnabled && (
              <p className="text-xs text-secondary mt-2">Save to get your public link.</p>
            )}
            {savedPublicProfileEnabled && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <code className="text-xs bg-paper border border-hairline rounded-md px-2 py-1 text-ink break-all">
                  {publicProfileUrl}
                </code>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="rounded-md border border-hairline text-ink py-1 px-2 text-xs font-medium hover:bg-paper shrink-0"
                >
                  {copied ? 'Copied!' : 'Copy link'}
                </button>
                <a
                  href={publicProfileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open in a new window"
                  aria-label="Open public provider page in a new window"
                  className="flex items-center justify-center w-6 h-6 rounded-md border border-hairline text-ink hover:bg-paper shrink-0"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <path d="M15 3h6v6" />
                    <path d="M10 14 21 3" />
                  </svg>
                </a>
              </div>
            )}
          </div>

          <CatalogueApproversSection organisationId={organisation.id} />

          {error && <p className="text-sm text-red-700">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
    </AccessibleDialog>
  )
}

// Lets an org admin pick which of their own (active) users can approve,
// reject or deactivate this organisation's own catalogue submissions
// without a platform admin (0095) -- each toggle is its own immediate
// add/remove, same "not part of the Save button" pattern as the logo above,
// rather than a field bundled into handleSave's payload.
function CatalogueApproversSection({ organisationId }) {
  const { user } = useAuth()
  const [members, setMembers] = useState([])
  const [approvers, setApprovers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [togglingUserId, setTogglingUserId] = useState(null)

  useEffect(() => {
    load()
  }, [organisationId])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [memberList, approverList] = await Promise.all([
        listOrganisationMembers(organisationId),
        listCatalogueApprovers(organisationId),
      ])
      setMembers(memberList.filter((m) => m.status === 'active'))
      setApprovers(approverList)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleToggle(member, isApprover) {
    setTogglingUserId(member.user_id)
    setError(null)
    try {
      if (isApprover) {
        const row = approvers.find((a) => a.user_id === member.user_id)
        if (row) await removeCatalogueApprover(row.id)
      } else {
        await addCatalogueApprover(organisationId, member.user_id, user.id)
      }
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setTogglingUserId(null)
    }
  }

  return (
    <div className="border-t border-hairline pt-4">
      <label className="block text-sm text-ink font-medium mb-1">Catalogue approvers</label>
      <p className="text-xs text-secondary mb-2">
        These users can approve, reject or deactivate this organisation's own training in the catalogue,
        without needing a platform admin.
      </p>
      {error && <p className="text-xs text-red-700 mb-2">{error}</p>}
      {loading ? (
        <p className="text-xs text-secondary">Loading users…</p>
      ) : members.length === 0 ? (
        <p className="text-xs text-secondary">No users yet.</p>
      ) : (
        <ul className="divide-y divide-hairline border border-hairline rounded-md">
          {members.map((m) => {
            const isApprover = approvers.some((a) => a.user_id === m.user_id)
            return (
              <li key={m.user_id} className="flex items-center justify-between gap-2 text-sm p-2">
                <span className="text-ink text-xs truncate">{m.email || m.user_id}</span>
                <label className="flex items-center gap-1.5 text-xs text-secondary shrink-0">
                  <input
                    type="checkbox"
                    checked={isApprover}
                    disabled={togglingUserId === m.user_id}
                    onChange={() => handleToggle(m, isApprover)}
                    className="rounded border-hairline"
                  />
                  Approver
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
