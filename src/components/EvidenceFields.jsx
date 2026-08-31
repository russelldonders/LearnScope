import { useRef, useState } from 'react'

function UploadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

export default function EvidenceFields({ evidenceUrl, onEvidenceUrlChange, files, onFilesChange, onHide }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const dragCounter = useRef(0)

  function handleFileChange(e) {
    const newFiles = Array.from(e.target.files ?? [])
    onFilesChange([...files, ...newFiles])
    e.target.value = ''
  }

  function removeFile(index) {
    onFilesChange(files.filter((_, i) => i !== index))
  }

  function handleDragEnter(e) {
    e.preventDefault()
    dragCounter.current += 1
    setDragging(true)
  }

  function handleDragLeave(e) {
    e.preventDefault()
    dragCounter.current -= 1
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setDragging(false)
    }
  }

  function handleDragOver(e) {
    e.preventDefault()
  }

  function handleDrop(e) {
    e.preventDefault()
    dragCounter.current = 0
    setDragging(false)
    const newFiles = Array.from(e.dataTransfer.files ?? [])
    if (newFiles.length > 0) onFilesChange([...files, ...newFiles])
  }

  return (
    <div className="border-t border-hairline pt-4 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="font-mono text-xs uppercase tracking-wide text-secondary">Evidence</h4>
        {onHide && (
          <button
            type="button"
            onClick={onHide}
            className="text-xs text-secondary hover:text-ink underline normal-case"
          >
            Hide
          </button>
        )}
      </div>

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
        <div
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={`flex flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed px-3 py-4 text-center transition-colors ${
            dragging ? 'border-moss bg-moss/10' : 'border-hairline'
          }`}
        >
          <UploadIcon />
          <p className="text-xs text-secondary">
            Drag and drop files here, or
          </p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper"
          >
            {files.length > 0
              ? `Add more files (${files.length} attached)`
              : 'Attach files'}
          </button>
        </div>
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
                <span className="truncate min-w-0">{file.name}</span>
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
