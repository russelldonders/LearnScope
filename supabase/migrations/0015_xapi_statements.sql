-- Day-to-day experience log, distinct from the `experience` table (work
-- history / education). Each row holds a full xAPI-shaped statement
-- (actor/verb/object/timestamp, optionally result/context) as jsonb so it
-- stays close to the real xAPI spec and could later be exported to an LRS.
-- recorded_at mirrors statement->>'timestamp' as a queryable/sortable
-- column; created_at is the separate audit trail of when the row was saved.
create table xapi_statements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  statement jsonb not null,
  recorded_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table xapi_statements enable row level security;

create policy "Users manage their own xapi statements"
  on xapi_statements for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index xapi_statements_user_id_idx on xapi_statements (user_id);
create index xapi_statements_recorded_at_idx on xapi_statements (recorded_at desc);
