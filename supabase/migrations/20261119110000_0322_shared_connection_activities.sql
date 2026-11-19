-- Activities logged in a connection's context: either something the two of
-- you did together ("joint"), or something you saw them do ("observed").
-- A rating you give someone is tagged with them too ("rated") so it shows on
-- their page for both of you; it's already on their record (as the rating
-- itself), so it's never offered to them as a suggestion.
--
-- Either way the row is the logger's own xapi_statements row, tagged with
-- the other person (with_user_id). Both of you can see it on each other's
-- connection page while you're connected (list_shared_activities). The other
-- person is also offered it as a suggestion (with_status = 'suggested'):
-- nothing lands on their record unless they choose to add it, which saves
-- their own copy (source_statement_id points back at the original) through
-- respond_to_shared_activity. Dismissing just marks the suggestion.
--
-- Additive only: three nullable columns, a guard trigger and four functions.
-- Existing rows are untouched (all new columns null). Rollback: drop the
-- functions, the trigger and its function, then the four columns.

alter table public.xapi_statements
  add column with_user_id uuid references auth.users(id) on delete set null,
  add column with_kind text check (with_kind in ('joint', 'observed', 'rated')),
  add column with_status text check (with_status in ('suggested', 'added', 'dismissed')),
  add column source_statement_id uuid references public.xapi_statements(id) on delete set null;

-- A tagged row says how it relates to that person. (with_user_id can later
-- become null when their account is deleted; the kind then simply stays.)
alter table public.xapi_statements
  add constraint xapi_statements_with_kind_needs_person
  check (with_user_id is null or with_kind is not null);

create index xapi_statements_with_user_id_idx
  on public.xapi_statements (with_user_id)
  where with_user_id is not null;

-- Learners write their own rows directly (the "Users manage their own xapi
-- statements" policy). These columns carry another person and a decision
-- that person makes, so from a learner's own session:
--   * the person tagged must be one of their connections, and not themselves;
--   * a new tagged row always starts as a suggestion to that person;
--   * the suggestion status, and the link back from a copy, are only ever
--     set by respond_to_shared_activity (which runs as the table owner), never
--     written directly;
--   * once tagged, a row can't be re-pointed at someone else.
create or replace function private.guard_xapi_statement_sharing()
returns trigger
language plpgsql
-- public, not '': is_connected() names its table without a schema.
set search_path = public
as $$
begin
  -- Only direct writes by a signed-in user through the API; security definer
  -- functions (respond_to_shared_activity) run as another role.
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.source_statement_id is not null then
      raise exception 'A copy of a shared activity can only be added from the suggestion.'
        using errcode = '42501';
    end if;
    if new.with_user_id is null then
      new.with_kind := null;
      new.with_status := null;
      return new;
    end if;
    if new.with_user_id = new.user_id or not public.is_connected(new.user_id, new.with_user_id) then
      raise exception 'You can only log an activity with one of your connections.'
        using errcode = '42501';
    end if;
    if new.with_kind is null then
      raise exception 'Say whether you did this together or saw them do it.'
        using errcode = '23514';
    end if;
    -- A rating you gave is only tagged with the person you rated.
    if new.with_kind = 'rated'
       and not coalesce(new.statement -> 'result' -> 'extensions' ? 'https://learnscope.app/xapi/extensions/peer-rating', false) then
      raise exception 'Only a rating can be tagged as one.'
        using errcode = '42501';
    end if;
    new.with_status := case when new.with_kind = 'rated' then null else 'suggested' end;
    return new;
  end if;

  -- UPDATE by the row's owner: everything else about the activity stays
  -- theirs to edit, but not who it's shared with or what that person decided.
  if new.with_user_id is distinct from old.with_user_id
    or new.with_kind is distinct from old.with_kind
    or new.with_status is distinct from old.with_status
    or new.source_statement_id is distinct from old.source_statement_id then
    raise exception 'Who an activity is shared with can''t be changed.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_xapi_statement_sharing() from public;

create trigger guard_xapi_statement_sharing
  before insert or update on public.xapi_statements
  for each row execute function private.guard_xapi_statement_sharing();

-- What either of you logged with or about the other, newest first, for a
-- connection's page. Only the fields that page shows: never the statement
-- itself, which carries the logger's email address. Empty unless the two of
-- you are connected, so disconnecting hides it again (each row stays on its
-- owner's own record). Copies added from a suggestion are left out: the
-- original already stands for the same thing.
create or replace function public.list_shared_activities(p_user_id uuid)
returns table (
  id uuid,
  logged_by uuid,
  about_user_id uuid,
  kind text,
  status text,
  happened_at timestamptz,
  title text,
  note text,
  duration text,
  level integer,
  skills jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    x.id,
    x.user_id,
    x.with_user_id,
    x.with_kind,
    x.with_status,
    x.recorded_at,
    x.statement #>> '{object,definition,name,en-US}',
    x.statement #>> '{object,definition,description,en-US}',
    x.statement #>> '{result,duration}',
    -- A tagged rating's level, 1-5; null for anything else or anything
    -- malformed, so one odd row can't break the list for both people.
    case when x.with_kind = 'rated'
      and (x.statement #>> '{result,extensions,https://learnscope.app/xapi/extensions/peer-rating,level}') ~ '^[1-5]$'
      then (x.statement #>> '{result,extensions,https://learnscope.app/xapi/extensions/peer-rating,level}')::int end,
    case when jsonb_typeof(x.statement #> '{context,extensions,https://learnscope.app/xapi/extensions/shared-with,skills}') = 'array'
      then x.statement #> '{context,extensions,https://learnscope.app/xapi/extensions/shared-with,skills}'
      else '[]'::jsonb end
  from xapi_statements x
  where p_user_id is not null
    and p_user_id <> auth.uid()
    and is_connected(auth.uid(), p_user_id)
    and x.source_statement_id is null
    and (
      (x.user_id = auth.uid() and x.with_user_id = p_user_id)
      or (x.user_id = p_user_id and x.with_user_id = auth.uid())
    )
  order by x.recorded_at desc
  limit 100
$$;

-- Suggestions waiting on the caller: activities connections logged with or
-- about them that they haven't added or dismissed yet, for the bell.
create or replace function public.list_shared_activity_suggestions()
returns table (
  id uuid,
  logged_by uuid,
  logged_by_name text,
  kind text,
  happened_at timestamptz,
  title text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    x.id,
    x.user_id,
    p.full_name,
    x.with_kind,
    x.recorded_at,
    x.statement #>> '{object,definition,name,en-US}'
  from xapi_statements x
  join profiles p on p.id = x.user_id
  where x.with_user_id = auth.uid()
    and x.with_status = 'suggested'
    and x.source_statement_id is null
    and is_connected(auth.uid(), x.user_id)
  order by x.recorded_at desc
  limit 50
$$;

-- The caller's answer to a suggestion. Dismiss marks it. Add saves the
-- caller's own copy -- p_statement is built by the app for the caller, as for
-- any activity they log, and p_skill_ids must be the caller's own skills --
-- linked back to the original, then marks the suggestion added. Returns the
-- new copy's id when adding.
create or replace function public.respond_to_shared_activity(
  p_statement_id uuid,
  p_add boolean,
  p_statement jsonb default null,
  p_skill_ids uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_original xapi_statements%rowtype;
  v_copy_id uuid;
  v_skill_ids uuid[];
begin
  if v_me is null then
    raise exception 'Sign in to respond to this.';
  end if;

  -- Only rows shared with the caller are looked at (and locked).
  select * into v_original
  from xapi_statements
  where id = p_statement_id
    and with_user_id = v_me
  for update;

  if not found
    or v_original.with_user_id is distinct from v_me
    or v_original.source_statement_id is not null
    or not is_connected(v_me, v_original.user_id) then
    raise exception 'This activity isn''t shared with you.';
  end if;
  if v_original.with_kind not in ('joint', 'observed') or v_original.with_status is distinct from 'suggested' then
    raise exception 'You''ve already answered this.';
  end if;

  if not p_add then
    update xapi_statements set with_status = 'dismissed' where id = v_original.id;
    return null;
  end if;

  if p_statement is null or jsonb_typeof(p_statement) <> 'object' then
    raise exception 'Nothing to add.';
  end if;
  -- This runs past the guard on direct writes (guard_xapi_statement_writes),
  -- so it applies the same rule itself: the copy is an ordinary activity,
  -- never a rating, check-in, import or course record, and not too large.
  if pg_column_size(p_statement) > 32768
    or coalesce(p_statement -> 'result' -> 'extensions' ? 'https://learnscope.app/xapi/extensions/peer-rating', false)
    or coalesce(p_statement -> 'result' -> 'extensions' ? 'https://learnscope.app/xapi/extensions/diagnostic', false)
    or coalesce(p_statement -> 'context' -> 'extensions' ? 'https://learnscope.app/xapi/extensions/provenance', false)
    or coalesce(p_statement -> 'context' -> 'extensions' ? 'https://learnscope.app/xapi/extensions/package-session', false) then
    raise exception 'This can''t be added as an activity.'
      using errcode = '42501';
  end if;

  -- Only the caller's own skills, once each, primary first.
  select coalesce(array_agg(s.id order by array_position(p_skill_ids, s.id)), '{}')
  into v_skill_ids
  from skills s
  where s.id = any(coalesce(p_skill_ids, '{}'))
    and s.user_id = v_me;

  -- And the skills it names in its own context are the caller's, as linked.
  if exists (
    select 1
    from jsonb_array_elements(
      case when jsonb_typeof(p_statement #> '{context,extensions,https://learnscope.app/xapi/extensions/skill}') = 'array'
        then p_statement #> '{context,extensions,https://learnscope.app/xapi/extensions/skill}'
        else '[]'::jsonb end
    ) as named(skill)
    where not ((named.skill ->> 'id') = any(v_skill_ids::text[]))
  ) or (p_statement #> '{context,extensions}' ? 'https://learnscope.app/xapi/extensions/skill'
        and jsonb_typeof(p_statement #> '{context,extensions,https://learnscope.app/xapi/extensions/skill}') <> 'array') then
    raise exception 'An added activity can only name your own skills.'
      using errcode = '42501';
  end if;

  insert into xapi_statements (
    user_id, statement, recorded_at, skill_id,
    with_user_id, with_kind, source_statement_id
  ) values (
    v_me, p_statement, v_original.recorded_at, v_skill_ids[1],
    v_original.user_id, v_original.with_kind, v_original.id
  )
  returning id into v_copy_id;

  insert into xapi_statement_skills (statement_id, skill_id, user_id)
  select v_copy_id, skill_id, v_me
  from unnest(v_skill_ids) as skill_id;

  update xapi_statements set with_status = 'added' where id = v_original.id;
  return v_copy_id;
end;
$$;

revoke all on function public.list_shared_activities(uuid) from public, anon;
revoke all on function public.list_shared_activity_suggestions() from public, anon;
revoke all on function public.respond_to_shared_activity(uuid, boolean, jsonb, uuid[]) from public, anon;
grant execute on function public.list_shared_activities(uuid) to authenticated;
grant execute on function public.list_shared_activity_suggestions() to authenticated;
grant execute on function public.respond_to_shared_activity(uuid, boolean, jsonb, uuid[]) to authenticated;
