-- Two hardening changes from the 2026-11-07 review of skill goals. Neither
-- widens access; both narrow it.
--
-- 1. A validator's view of a learner's skill record froze nowhere. Every
--    "Validators can view ..." policy used is_skill_validator, which is true
--    for any request ever sent to that validator, pending or long decided. So
--    a validator who declined a request a year ago could still read every
--    assessment, target, rating, course link, activity (now including goal
--    tracker values) and evidence file added since.
--
--    Now: while a request is pending the validator sees the whole record, as
--    before. Once it's decided they keep exactly what existed at the moment
--    they decided, so their decision stays reviewable against the evidence it
--    was based on, and nothing added afterwards. "Existed" means when the row
--    was saved (created_at / rated_at), not the date it describes, so a
--    learner backdating a new entry doesn't reopen it to old validators.
--    The skill row itself (name, current level) stays visible so a past
--    decision still displays; is_skill_validator is unchanged for that.
--
--    The freeze is per row: a row saved before the decision stays visible
--    even if the learner edits it later (a corrected goal entry, an
--    assessment comment, a file re-uploaded to the same path). That's the
--    learner's own change, so it isn't a privacy gap, but a past decision
--    isn't a tamper-proof snapshot either.
--
-- 2. Learners could rewrite, re-file or delete records written on their
--    behalf through the REST API: the owner policy is FOR ALL, and the
--    existing trigger only checks that linked skills and experience are the
--    learner's own. A trigger now refuses, for direct writes by signed-in
--    users: editing a connection's rating, a diagnostic attempt, a synced
--    import or a course record in any way other than attaching evidence;
--    attaching a rating to their own skill (by insert, update or link);
--    moving a diagnostic to another skill; and deleting a rating or
--    diagnostic. Course records and synced imports can still be deleted,
--    because they are the learner's own data.
--
--    Limits: diagnostics and synced imports are still written by the
--    browser, so a learner can create a new one with any content. These
--    rules stop existing records being altered; they don't make those labels
--    proof of anything. Server-side functions and the service role (course
--    packages, rate_connection_skill, account deletion, transfers) and
--    foreign-key cascades are unaffected.
--
-- 3. A learner could create a validation request already marked as decided,
--    which shows their skill as confirmed by someone who never saw it. New
--    requests from signed-in users must now start pending and undecided.

-- ---------------------------------------------------------------------------
-- 1. Validator access frozen at the decision
-- ---------------------------------------------------------------------------

create or replace function public.is_skill_validator_for_record(
  p_skill_id uuid,
  p_user_id uuid,
  p_saved_at timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.skill_validation_requests svr
    where svr.skill_id = p_skill_id
      and svr.validator_id = p_user_id
      and (
        svr.status = 'pending'
        or (svr.decided_at is not null and p_saved_at <= svr.decided_at)
      )
  )
$$;

revoke all on function public.is_skill_validator_for_record(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.is_skill_validator_for_record(uuid, uuid, timestamptz) to authenticated;

alter policy "Validators can view assessments for skills they're validating" on public.skill_assessments
  using (public.is_skill_validator_for_record(skill_id, (select auth.uid()), created_at));

alter policy "Validators can view targets for skills they're validating" on public.skill_targets
  using (public.is_skill_validator_for_record(skill_id, (select auth.uid()), created_at));

alter policy "Validators can view peer ratings for skills they're validating" on public.skill_peer_ratings
  using (public.is_skill_validator_for_record(skill_id, (select auth.uid()), rated_at));

alter policy "Validators can view course links for skills they're validating" on public.skill_course_links
  using (public.is_skill_validator_for_record(skill_id, (select auth.uid()), created_at));

alter policy "Validators can view activity for skills they're validating" on public.xapi_statements
  using (skill_id is not null and public.is_skill_validator_for_record(skill_id, (select auth.uid()), created_at));

alter policy "Validators can view activity-skill links for skills they're val" on public.xapi_statement_skills
  using (public.is_skill_validator_for_record(skill_id, (select auth.uid()), created_at));

-- A course is visible through a course link the validator can still see.
create or replace function public.is_course_linked_to_validating_skill(p_course_id uuid, p_validator_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from skill_course_links scl
    join skill_validation_requests svr on svr.skill_id = scl.skill_id
    where scl.course_id = p_course_id
      and svr.validator_id = p_validator_id
      and (
        svr.status = 'pending'
        or (svr.decided_at is not null and scl.created_at <= svr.decided_at)
      )
  )
$$;

-- It has always been callable by anyone with any validator id; only signed-in
-- users need it, through the courses policy.
revoke all on function public.is_course_linked_to_validating_skill(uuid, uuid) from public, anon;
grant execute on function public.is_course_linked_to_validating_skill(uuid, uuid) to authenticated;

-- Evidence files, by when they were uploaded.
drop policy "Validators can view evidence files for skills they're validating" on storage.objects;

create policy "Validators can view evidence files for skills they're validating"
  on storage.objects for select
  using (
    bucket_id = 'skill-evidence'
    and exists (
      select 1 from public.skill_validation_requests svr
      where svr.validator_id = (select auth.uid())
        and svr.skill_id::text = (storage.foldername(name))[2]
        and svr.requester_id::text = (storage.foldername(name))[1]
        and (
          svr.status = 'pending'
          or (svr.decided_at is not null and storage.objects.created_at <= svr.decided_at)
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 2. System-generated activity records can't be rewritten by learners
-- ---------------------------------------------------------------------------

create or replace function private.guard_xapi_statement_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_peer_rating constant text := 'https://learnscope.app/xapi/extensions/peer-rating';
  v_diagnostic constant text := 'https://learnscope.app/xapi/extensions/diagnostic';
  v_provenance constant text := 'https://learnscope.app/xapi/extensions/provenance';
  v_skill constant text := 'https://learnscope.app/xapi/extensions/skill';
  v_old_is_system boolean;
  v_new_is_system boolean;
begin
  -- Only direct writes by a signed-in user through the API. Security definer
  -- functions, the service role and cascades run as another role.
  if current_user <> 'authenticated' then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    -- Course package statements only arrive through the xAPI endpoint.
    if new.resource_id is not null then
      raise exception 'Course activity can only be recorded by the course itself.'
        using errcode = '42501';
    end if;
    -- A rater's own copy of a rating has no skill attached. A rating on the
    -- learner's own skill is written only by rate_connection_skill.
    if coalesce(new.statement -> 'result' -> 'extensions' ? v_peer_rating, false)
       and (new.skill_id is not null or coalesce(new.statement -> 'context' -> 'extensions' ? v_skill, false)) then
      raise exception 'Ratings on your own skill are recorded by the person rating it.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.resource_id is distinct from old.resource_id then
      raise exception 'The course an activity came from cannot be changed.'
        using errcode = '42501';
    end if;
    v_old_is_system := old.resource_id is not null
      or coalesce(old.statement -> 'result' -> 'extensions' ? v_peer_rating, false)
      or coalesce(old.statement -> 'result' -> 'extensions' ? v_diagnostic, false)
      or coalesce(old.statement -> 'context' -> 'extensions' ? v_provenance, false);
    v_new_is_system := coalesce(new.statement -> 'result' -> 'extensions' ? v_peer_rating, false)
      or coalesce(new.statement -> 'result' -> 'extensions' ? v_diagnostic, false)
      or coalesce(new.statement -> 'context' -> 'extensions' ? v_provenance, false);
    -- A record written on the learner's behalf can only gain evidence: not a
    -- new skill, experience, course, date or content.
    if v_old_is_system
       and (to_jsonb(new) - array['evidence_url', 'evidence_paths'])
           is distinct from (to_jsonb(old) - array['evidence_url', 'evidence_paths']) then
      raise exception 'This activity was recorded automatically and cannot be edited.'
        using errcode = '42501';
    end if;
    -- And an ordinary activity can't be turned into one.
    if not v_old_is_system and v_new_is_system then
      raise exception 'This activity was recorded automatically and cannot be edited.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- DELETE. Course records and synced imports are the learner's own data and
  -- can still be removed; ratings and diagnostics cannot.
  if coalesce(old.statement -> 'result' -> 'extensions' ? v_peer_rating, false)
     or coalesce(old.statement -> 'result' -> 'extensions' ? v_diagnostic, false) then
    raise exception 'This activity was recorded automatically and cannot be deleted.'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

revoke all on function private.guard_xapi_statement_writes() from public;

create trigger guard_xapi_statement_writes
before insert or update or delete on public.xapi_statements
for each row execute function private.guard_xapi_statement_writes();

-- The same rules for the table that links an activity to further skills: a
-- rating can't be linked to a skill, and a diagnostic only to its own.
create or replace function private.guard_xapi_statement_skill_links()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_statement jsonb;
  v_skill_id uuid;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  select xs.statement, xs.skill_id into v_statement, v_skill_id
  from public.xapi_statements xs
  where xs.id = new.statement_id;

  if coalesce(v_statement -> 'result' -> 'extensions' ? 'https://learnscope.app/xapi/extensions/peer-rating', false) then
    raise exception 'Ratings on your own skill are recorded by the person rating it.'
      using errcode = '42501';
  end if;
  if coalesce(v_statement -> 'result' -> 'extensions' ? 'https://learnscope.app/xapi/extensions/diagnostic', false)
     and new.skill_id is distinct from v_skill_id then
    raise exception 'A check-in result belongs to the skill it was taken for.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_xapi_statement_skill_links() from public;

create trigger guard_xapi_statement_skill_links
before insert or update on public.xapi_statement_skills
for each row execute function private.guard_xapi_statement_skill_links();

-- ---------------------------------------------------------------------------
-- 3. Validation requests start undecided
-- ---------------------------------------------------------------------------

create or replace function private.guard_validation_request_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated'
     and (new.status <> 'pending' or new.decided_at is not null or new.decision_comments is not null) then
    raise exception 'A validation request is decided by the validator.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_validation_request_insert() from public;

create trigger guard_validation_request_insert
before insert on public.skill_validation_requests
for each row execute function private.guard_validation_request_insert();
