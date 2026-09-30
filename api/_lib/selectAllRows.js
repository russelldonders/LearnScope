// PostgREST caps a plain select at 1,000 rows, so a whole-table read for the
// admin lists pages through with range() until a short page comes back.
// Returns the same { data, error } shape as a single query. The order column
// keeps pages stable while they're read.
export const ROW_PAGE_SIZE = 1000
export async function selectAllRows(buildQuery, orderColumn) {
  const rows = []
  for (let from = 0; ; from += ROW_PAGE_SIZE) {
    const { data, error } = await buildQuery().order(orderColumn).range(from, from + ROW_PAGE_SIZE - 1)
    if (error) return { data: null, error }
    rows.push(...(data ?? []))
    if (!data || data.length < ROW_PAGE_SIZE) return { data: rows, error: null }
  }
}
