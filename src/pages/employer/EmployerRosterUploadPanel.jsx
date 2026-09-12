import { useRef, useState } from 'react'
import { buildRosterCsvTemplate, parseRosterCsv } from '../../lib/employerRosterCsv'
import { addEmployerMember } from '../../lib/admin/employers'

// CSV bulk-add, replacing the old plain-textarea "bulk import" (emails
// only) -- every roster field is mandatory-or-not the same way the
// individual add form enforces it, so a row missing a required field is
// flagged in the preview and excluded from the actual import rather than
// creating a member with gaps that would just need filling in again via
// "Edit details" afterward.
export default function EmployerRosterUploadPanel({ employerId, fields, onImported }) {
  const [role, setRole] = useState('member')
  const [fileName, setFileName] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [parseError, setParseError] = useState(null)
  const [importing, setImporting] = useState(false)
  const [results, setResults] = useState(null)
  const fileInputRef = useRef(null)

  const emailField = fields.find((f) => f.key === 'email')

  function handleDownloadTemplate() {
    const blob = new Blob([buildRosterCsvTemplate(fields)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'learnscope-roster-template.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setResults(null)
    setParseError(null)
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        setParsed(parseRosterCsv(String(reader.result), fields))
      } catch (err) {
        setParsed(null)
        setParseError(err.message)
      }
    }
    reader.onerror = () => setParseError('Could not read that file.')
    reader.readAsText(file)
  }

  const validRows = (parsed?.rows ?? []).filter((row) => row.errors.length === 0)

  async function handleImport() {
    setImporting(true)
    const settled = await Promise.allSettled(
      validRows.map((row) => addEmployerMember(employerId, row.values[emailField.id], role, row.values))
    )
    setResults(settled.map((r, i) => {
      const email = validRows[i].values[emailField.id]
      if (r.status === 'rejected') return { email, outcome: 'failed', detail: r.reason?.message || 'Import failed' }
      return {
        email,
        outcome: r.value.alreadyExisted ? 'already-member' : 'invited',
        detail: r.value.alreadyExisted ? 'Added, pending their acceptance' : 'Invited',
      }
    }))
    setImporting(false)
    setParsed(null)
    setFileName(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    onImported?.()
  }

  return (
    <details className="bg-card border border-hairline rounded-lg p-4 mb-4">
      <summary className="text-sm font-medium text-ink cursor-pointer">Upload roster (CSV)</summary>
      <div className="mt-3 space-y-3">
        <button
          type="button"
          onClick={handleDownloadTemplate}
          className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink hover:bg-paper"
        >
          Download CSV template
        </button>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs text-secondary mb-1" htmlFor="employerRosterFile">
              Filled-in CSV
            </label>
            <input
              id="employerRosterFile"
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="text-xs text-ink"
            />
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1" htmlFor="employerRosterRole">
              Role
            </label>
            <select
              id="employerRosterRole"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>

        {parseError && <p className="text-xs text-red-700">{parseError}</p>}

        {parsed && (
          <div className="border-t border-hairline pt-3">
            {parsed.unmatchedHeaders.length > 0 && (
              <p className="text-xs text-amber-700 mb-2">
                Column(s) not recognized, ignored: {parsed.unmatchedHeaders.join(', ')}
              </p>
            )}
            {parsed.rows.length === 0 ? (
              <p className="text-xs text-secondary">{fileName} has no data rows.</p>
            ) : (
              <>
                <p className="text-xs text-secondary mb-2">
                  {fileName} &middot; {validRows.length} of {parsed.rows.length} row(s) valid
                </p>
                <ul className="space-y-1 max-h-64 overflow-y-auto">
                  {parsed.rows.map((row) => (
                    <li key={row.rowNumber} className="text-xs flex flex-wrap gap-1">
                      <span className={row.errors.length ? 'text-red-700' : 'text-moss'}>
                        {row.errors.length ? '✗' : '✓'}
                      </span>
                      {row.errors.length ? (
                        <span className="text-secondary">row {row.rowNumber}: {row.errors.join('; ')}</span>
                      ) : (
                        <span className="font-mono text-ink">
                          {Object.values(row.values).filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={importing || validRows.length === 0}
                  className="mt-3 rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
                >
                  {importing ? 'Importing…' : `Import ${validRows.length} valid row${validRows.length === 1 ? '' : 's'}`}
                </button>
              </>
            )}
          </div>
        )}

        {results && (
          <div className="border-t border-hairline pt-3">
            <p className="text-xs text-secondary mb-2">
              {results.length} {results.length === 1 ? 'result' : 'results'}:
            </p>
            <ul className="space-y-1">
              {results.map((r) => (
                <li key={r.email} className="text-xs flex flex-wrap gap-1">
                  <span className="font-mono text-ink">{r.email}</span>
                  <span className={r.outcome === 'failed' ? 'text-red-700' : r.outcome === 'already-member' ? 'text-secondary' : 'text-moss'}>
                    {r.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  )
}
