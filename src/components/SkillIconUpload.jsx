import { useRef, useState } from 'react'
import { uploadSkillIcon, removeSkillIcon } from '../lib/skillLibrary'
import { optimizeSkillIcon } from '../lib/optimizeImage'
import SkillIcon from './SkillIcon'

// Shared between AdminSkillDetail.jsx (platform admin) and
// ProviderSkillDetail.jsx (provider org admin) -- both already gate showing
// this on the same can_manage_skill_composite authorization boundary the
// set_skill_icon RPC itself re-checks server-side (20260909100000), same
// shape as SkillCompositionSection being reused across those two consoles.
export default function SkillIconUpload({ skill, onUpdated }) {
  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setUploading(true)
    try {
      const optimized = await optimizeSkillIcon(file)
      await uploadSkillIcon(skill.id, optimized)
      await onUpdated()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  async function handleRemove() {
    setUploading(true)
    setError(null)
    try {
      await removeSkillIcon(skill.id)
      await onUpdated()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex items-center gap-4">
      <SkillIcon name={skill.name} iconUrl={skill.icon_url} size="lg" className="border border-hairline" />
      <div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
          >
            {uploading ? 'Uploading…' : skill.icon_url ? 'Change icon' : 'Upload icon'}
          </button>
          {skill.icon_url && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={uploading}
              className="text-sm text-secondary hover:text-red-700 disabled:opacity-60"
            >
              Remove
            </button>
          )}
        </div>
        {error && <p className="text-xs text-red-700 mt-1">{error}</p>}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label="Upload skill icon"
        onChange={handleFileChange}
      />
    </div>
  )
}
