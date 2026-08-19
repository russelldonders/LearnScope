# src/data

Scaffolding for LearnScope's data-access boundary. See
`docs/data-architecture.md` for the full rationale.

- `getDataClient()` — use this instead of importing the `supabase` singleton
  directly in new code. It returns the same client today; it's the seam a
  future regional-routing mechanism would extend.
- Table-scoped repository modules belong here as they're introduced, following
  the pattern already used by `src/lib/connections.js` and similar. Existing
  direct `supabase.*` call sites elsewhere in the app are not being migrated
  as part of introducing this scaffolding -- that's an incremental follow-up,
  not a rewrite.
