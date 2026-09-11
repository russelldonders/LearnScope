import { useRef, useState } from 'react'
import { updateOrganisation, uploadOrganisationLogo, removeOrganisationLogo } from '../lib/admin/organisations'
import AccessibleDialog from './AccessibleDialog'

const MAX_LOGO_BYTES = 5 * 1024 * 1024

// Mirrors src/index.css's --color-moss/--color-slate/--color-gold/
// --color-paper light values -- shown as each field's placeholder
// swatch/value so "unset" reads as "currently using the default LearnScope
// colours" rather than a blank picker, and used to seed the
// <input type="color"> since that control can't display a true empty state.
const BRAND_COLOR_FIELDS = [
  { key: 'brandPrimaryColor', label: 'Primary', hint: 'Buttons and links', fallback: '#4a6741' },
  { key: 'brandSecondaryColor', label: 'Secondary', hint: 'Accents', fallback: '#3d5a73' },
  { key: 'brandHoverColor', label: 'Hover', hint: 'Button hover state', fallback: '#80651d' },
  { key: 'brandBackgroundColor', label: 'Background', hint: 'Page background', fallback: '#eef0e7' },
  { key: 'brandTextColor', label: 'Text', hint: 'Headings and labels', fallback: '#20301f' },
]

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

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
  const [brandPrimaryColor, setBrandPrimaryColor] = useState(organisation.brand_primary_color ?? '')
  const [brandSecondaryColor, setBrandSecondaryColor] = useState(organisation.brand_secondary_color ?? '')
  const [brandHoverColor, setBrandHoverColor] = useState(organisation.brand_hover_color ?? '')
  const [brandBackgroundColor, setBrandBackgroundColor] = useState(organisation.brand_background_color ?? '')
  const [brandTextColor, setBrandTextColor] = useState(organisation.brand_text_color ?? '')
  const [colorError, setColorError] = useState(null)
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
    setColorError(null)
    for (const field of BRAND_COLOR_FIELDS) {
      const value = { brandPrimaryColor, brandSecondaryColor, brandHoverColor, brandBackgroundColor, brandTextColor }[field.key]
      if (value && !HEX_COLOR_RE.test(value)) {
        setColorError(`${field.label} colour must be a hex value like ${field.fallback}.`)
        return
      }
    }
    setSaving(true)
    setError(null)
    try {
      await updateOrganisation(organisation.id, {
        url,
        about,
        publicProfileEnabled,
        brandPrimaryColor: brandPrimaryColor || null,
        brandSecondaryColor: brandSecondaryColor || null,
        brandHoverColor: brandHoverColor || null,
        brandBackgroundColor: brandBackgroundColor || null,
        brandTextColor: brandTextColor || null,
      })
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
            <label className="block text-sm text-secondary mb-1">Brand colours</label>
            <p className="text-xs text-secondary mb-2">
              Used on your public page below, and on Sign up/Log in for visitors arriving from it. Leave any of
              these blank to use LearnScope's default colours. Buttons use white text on your Primary/Hover
              colours, so pick shades dark enough to stay readable. If you pick a dark Background, set a light
              Text colour too so headings and labels stay readable against it.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {BRAND_COLOR_FIELDS.map((field) => {
                const value = {
                  brandPrimaryColor,
                  brandSecondaryColor,
                  brandHoverColor,
                  brandBackgroundColor,
                  brandTextColor,
                }[field.key]
                const setValue = {
                  brandPrimaryColor: setBrandPrimaryColor,
                  brandSecondaryColor: setBrandSecondaryColor,
                  brandHoverColor: setBrandHoverColor,
                  brandBackgroundColor: setBrandBackgroundColor,
                  brandTextColor: setBrandTextColor,
                }[field.key]
                const inputId = `orgSettings-${field.key}`
                return (
                  <div key={field.key}>
                    <label className="block text-xs text-secondary mb-1" htmlFor={inputId}>
                      {field.label}
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        aria-label={`${field.label} colour swatch`}
                        value={HEX_COLOR_RE.test(value) ? value : field.fallback}
                        onChange={(e) => setValue(e.target.value)}
                        className="w-9 h-9 rounded border border-hairline shrink-0 cursor-pointer bg-paper"
                      />
                      <input
                        id={inputId}
                        type="text"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder={field.fallback}
                        className="w-full min-w-0 rounded-md border border-hairline bg-paper px-2 py-1.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                      />
                    </div>
                    <p className="text-[11px] text-secondary mt-1">{field.hint}</p>
                  </div>
                )
              })}
            </div>
            {colorError && <p className="text-sm text-red-700 mt-2">{colorError}</p>}
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
