import { useRef, useState } from 'react'
import { updateOrganisation, uploadOrganisationLogo, removeOrganisationLogo } from '../lib/admin/organisations'

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
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-[60]" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-card border border-hairline rounded-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-lg text-ink mb-4">Organisation settings</h3>

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
            {publicProfileEnabled && (
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
              </div>
            )}
          </div>

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
      </div>
    </div>
  )
}
