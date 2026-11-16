// A small in-memory stand-in for the supabase client, for page-level tests
// that read several tables. Reads return the fixture rows for the table,
// narrowed by eq / in / is filters; embedded selects (`courses(name)`) are
// expected to already be nested in the fixture rows. Writes are recorded in
// `calls` and resolve without changing the fixtures.
//
//   const db = vi.hoisted(() => ({ tables: {}, calls: [] }))
//   vi.mock('../lib/supabaseClient', async () => {
//     const { createSupabaseFake } = await import('../test/supabaseFake')
//     return { supabase: createSupabaseFake(db) }
//   })
export function createSupabaseFake(db) {
  function query(table) {
    const filters = []
    let write = null
    const rows = () => {
      if (write) return write.returning
      return (db.tables[table] ?? []).filter((row) => filters.every((matches) => matches(row)))
    }
    const builder = {
      select() { return builder },
      order() { return builder },
      limit() { return builder },
      range() { return builder },
      eq(column, value) { if (!write) filters.push((row) => row[column] === value); return builder },
      neq(column, value) { if (!write) filters.push((row) => row[column] !== value); return builder },
      in(column, values) { if (!write) filters.push((row) => values.includes(row[column])); return builder },
      is(column, value) { if (!write) filters.push((row) => (row[column] ?? null) === value); return builder },
      insert(values) { return record('insert', values) },
      update(values) { return record('update', values) },
      upsert(values) { return record('upsert', values) },
      delete() { return record('delete') },
      single() { return Promise.resolve({ data: rows()[0] ?? null, error: null }) },
      maybeSingle() { return Promise.resolve({ data: rows()[0] ?? null, error: null }) },
      then(resolve, reject) { return Promise.resolve({ data: rows(), error: null }).then(resolve, reject) },
    }
    function record(action, values) {
      const returning = [values].flat().filter(Boolean).map((row, index) => ({ id: `${table}-new-${index + 1}`, ...row }))
      write = { returning }
      db.calls?.push({ table, action, values })
      return builder
    }
    return builder
  }
  return {
    from: query,
    rpc(name, args) {
      db.calls?.push({ rpc: name, args })
      const data = db.rpcs?.[name] ?? null
      const result = Promise.resolve({ data, error: null })
      return Object.assign(result, {
        select: () => result,
        single: () => result,
        maybeSingle: () => result,
      })
    },
    storage: {
      from: () => ({
        createSignedUrl: () => Promise.resolve({ data: null, error: null }),
        upload: () => Promise.resolve({ data: null, error: null }),
        remove: () => Promise.resolve({ data: null, error: null }),
      }),
    },
  }
}
