import { parseCsv, toCsv } from './csv'

// One column per roster field definition, header = the field's label --
// matches what EmployerMemberFieldInputs shows the admin on-screen, so a
// filled-in template reads the same way the add-user form does. Column
// order follows sort_order (the same order fields/listFieldDefinitionsForEmployer
// already returns them in), matching the form's own field order too.
export function buildRosterCsvTemplate(fields) {
  return toCsv([fields.map((f) => f.label)])
}

// Matches header text to fields (labels first, key second) rather than a
// fixed column order -- resilient to an admin reordering columns in their
// spreadsheet, so long as the header row's text still matches. A header
// with no match is reported (unmatchedHeaders) but doesn't fail the whole
// import -- its column's values are just ignored, which surfaces as missing
// required fields on affected rows instead of a total parse failure.
export function parseRosterCsv(text, fields) {
  const rows = parseCsv(text.trim())
  if (rows.length === 0) return { rows: [], unmatchedHeaders: [] }

  const [headerRow, ...dataRows] = rows
  const byLabel = new Map(fields.map((f) => [f.label.trim().toLowerCase(), f]))
  const byKey = new Map(fields.map((f) => [f.key.trim().toLowerCase(), f]))
  const unmatchedHeaders = []
  const columns = headerRow.map((header) => {
    const normalized = header.trim().toLowerCase()
    const field = byLabel.get(normalized) || byKey.get(normalized)
    if (!field) unmatchedHeaders.push(header)
    return field || null
  })

  const parsedRows = dataRows
    // Skips a fully-blank row (trailing blank line in the file) rather than
    // reporting it as an all-fields-missing error row.
    .filter((cells) => cells.some((cell) => cell.trim() !== ''))
    .map((cells, dataIndex) => {
      const values = {}
      columns.forEach((field, colIndex) => {
        if (field) values[field.id] = (cells[colIndex] ?? '').trim()
      })
      const errors = fields
        .filter((f) => f.required && !String(values[f.id] ?? '').trim())
        .map((f) => `"${f.label}" is required`)
      // +2: the header is row 1, so the first data row is row 2 -- matches
      // what the admin sees if they open the file in a spreadsheet.
      return { rowNumber: dataIndex + 2, values, errors }
    })

  return { rows: parsedRows, unmatchedHeaders }
}
