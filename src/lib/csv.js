// Minimal RFC-4180-ish CSV encode/decode -- no dependency pulled in for
// this since the only producer/consumer is our own roster template
// round-trip (parseRosterCsv/buildRosterCsvTemplate in employerRosterCsv.js):
// a field is quoted only when it actually needs to be (contains a comma,
// quote, or newline), and a quoted field's own quotes are doubled, which is
// enough to handle values pasted in from a real spreadsheet export too.

export function toCsv(rows) {
  return rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n')
}

function escapeCsvField(value) {
  const str = value == null ? '' : String(value)
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

// Returns an array of rows, each an array of raw string cells -- no header/
// type handling here, that's the caller's job (parseRosterCsv maps cells to
// field definitions by header text).
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  // Normalizing \r\n and lone \r to \n up front keeps the main loop from
  // needing to special-case a \r that isn't part of a \r\n pair.
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i]
    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  // Trailing field/row only if the file didn't end on its own newline --
  // avoids a phantom empty row at the end of a normally-terminated file.
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}
