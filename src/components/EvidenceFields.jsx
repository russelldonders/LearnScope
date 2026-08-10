import { useRef } from 'react'

function UploadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

export default function EvidenceFields({ evidenceUrl, onEvidenceUrlChange, files, onFilesChange }) {
  const inputRef = useRef(null)

  function handleFileChange(e) {
    const newFiles = Array.from(e.target.files ?? [])
    onFilesChange([...files, ...newFiles])
    e.target.value = ''
  }

  function removeFile(index) {
    onFilesChange(files.filter((_, i) => i !== index))
  }

  return (
    <div className="border-t border-hairline pt-4 space-y-2">
      <h4 className="font-mono text-xs uppercase tracking-wide text-secondary">Evidence</h4>

      <div>
        <label className="block text-xs text-secondary mb-1" htmlFor="evidenceUrl">
          Link
        </label>
        <input
          id="evidenceUrl"
          type="url"
          placeholder="https://…"
          value={evidenceUrl}
          onChange={(e) => onEvidenceUrlChange(e.target.value)}
          className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
        />
      </div>

      <div>
        <label className="block text-xs text-secondary mb-1">Files</label>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-2 rounded-md border border-hairline text-ink py-2 px-3 text-sm font-medium hover:bg-paper"
        >
          <UploadIcon />
          {files.length > 0
            ? `Add more files (${files.length} attached)`
            : 'Attach files'}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />

        {files.length > 0 && (
          <ul className="mt-2 space-y-1">
            {files.map((file, i) => (
              <li
                key={`${file.name}-${i}`}
                className="flex items-center justify-between gap-2 text-xs text-secondary bg-paper border border-hairline rounded px-2 py-1"
              >
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="text-red-700 shrink-0"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
