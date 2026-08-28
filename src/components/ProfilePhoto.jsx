import { useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { uploadAvatar, removeAvatar } from '../lib/avatar'
import ConfirmDialog from './ConfirmDialog'

const MAX_BYTES = 5 * 1024 * 1024

export default function ProfilePhoto({ avatarUrl, onUploaded }) {
  const { user } = useAuth()
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('That image is too large (max 5MB).')
      return
    }
    setError(null)
    setUploading(true)
    try {
      const url = await uploadAvatar(user.id, file)
      onUploaded(url)
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
      await removeAvatar(user.id)
      onUploaded(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
      setConfirmingRemove(false)
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="w-20 h-20 rounded-full overflow-hidden border border-hairline bg-paper flex items-center justify-center shrink-0">
        {avatarUrl ? (
          <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
        ) : (
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-secondary"
          >
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
          </svg>
        )}
      </div>
      <div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
          >
            {uploading ? 'Uploading…' : avatarUrl ? 'Change photo' : 'Upload photo'}
          </button>
          {avatarUrl && (
            <button
              type="button"
              onClick={() => setConfirmingRemove(true)}
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
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {confirmingRemove && (
        <ConfirmDialog
          message="Remove your profile photo?"
          onConfirm={handleRemove}
          onCancel={() => setConfirmingRemove(false)}
          confirming={uploading}
        />
      )}
    </div>
  )
}
