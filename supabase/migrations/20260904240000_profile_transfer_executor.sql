-- The guarded transactional executor (docs/claude-account-portability-
-- handoff.md item 3, rules from docs/profile-transfer-execution-rules.md).
-- Scoped to skills/courses/experience only, per Decision 3 of that
-- document -- connections/xAPI/employer/manager sharing have no plan-item
-- preview coverage yet and are explicitly out of scope for this executor
-- until that exists. This migration adds no visibility to any table; it
-- only lets an already-mutually-approved plan actually move data.
--
-- Durable audit trail: one row per plan item processed, recording the
-- source record, what it became (its own id if moved/became canonical, the
-- durable record's id if it was the one retained), and the action taken.
create table public.profile_transfer_execution_records (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.profile_transfer_plans(id) on delete restrict,
  item_id uuid not null references public.profile_transfer_plan_items(id) on delete restrict,
  domain text not null,
  source_record_id uuid not null,
  canonical_record_id uuid not null,
  action text not null,
  created_at timestamptz not null default now()
);

create index profile_transfer_execution_records_plan_idx
  on public.profile_transfer_execution_records (plan_id);

alter table public.profile_transfer_execution_records enable row level security;
revoke all on public.profile_transfer_execution_records from anon, authenticated;
grant select on public.profile_transfer_execution_records to authenticated;

create policy "Linked accounts can view their transfer execution records"
  on public.profile_transfer_execution_records for select to authenticated
  using (exists (
    select 1 from public.profile_transfer_plans plan
    where plan.id = profile_transfer_execution_records.plan_id
      and private.current_link_account(plan.verified_account_link_id) is not null
  ));

-- Idempotency: a retried call with the same key against an already-executed
-- plan returns the prior result instead of erroring or re-running. A call
-- with no key, or a different key, against an already-executed plan is
-- treated as a genuinely separate attempt and rejected -- it does not
-- re-execute (that would double-process a plan) and does not silently
-- succeed (the caller needs to know nothing happened this time).
alter table public.profile_transfer_plans
  add column execution_idempotency_key uuid;

create or replace function public.execute_profile_transfer_plan(
  p_plan_id uuid,
  p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.profile_transfer_plans;
  v_account_id uuid;
  v_source_user_id uuid;
  v_durable_user_id uuid;
  v_item record;
  v_current_fingerprint text;
  v_canonical_id uuid;
  v_result jsonb;
begin
  if p_idempotency_key is null then raise exception 'An idempotency key is required'; end if;

  select * into v_plan from public.profile_transfer_plans where id = p_plan_id for update;
  if v_plan.id is null then raise exception 'Transfer plan not found'; end if;

  if v_plan.status = 'executed' then
    if v_plan.execution_idempotency_key = p_idempotency_key then
      -- Safe retry: return the already-recorded result instead of
      -- re-running any mutation.
      select jsonb_build_object(
        'planId', v_plan.id, 'executedAt', v_plan.executed_at,
        'records', coalesce(jsonb_agg(jsonb_build_object(
          'domain', r.domain, 'sourceRecordId', r.source_record_id,
          'canonicalRecordId', r.canonical_record_id, 'action', r.action
        )), '[]'::jsonb)
      ) into v_result
      from public.profile_transfer_execution_records r where r.plan_id = p_plan_id;
      return v_result;
    end if;
    raise exception 'This plan has already been executed';
  end if;

  v_account_id := private.current_link_account(v_plan.verified_account_link_id);
  if v_account_id is null then raise exception 'Active verified account link not found'; end if;
  if v_plan.status <> 'approved' or v_plan.expires_at <= now() then
    raise exception 'Approved, unexpired transfer plan not found';
  end if;
  -- Re-verify the plan is still the exact approved version with two live
  -- approvals -- defense in depth alongside approve_profile_transfer_plan's
  -- own checks, since time has passed and this is the point of no return.
  if private.profile_transfer_plan_hash(p_plan_id) is distinct from v_plan.version_hash then
    raise exception 'Transfer plan version has changed since approval';
  end if;
  if (select count(*) from public.profile_transfer_plan_approvals
      where plan_id = p_plan_id and version_hash = v_plan.version_hash) <> 2 then
    raise exception 'This plan version does not have two current approvals';
  end if;

  select legacy_user_id into v_source_user_id from public.learning_profiles where id = v_plan.source_profile_id;
  select legacy_user_id into v_durable_user_id from public.learning_profiles where id = v_plan.durable_profile_id;

  -- Fingerprint staleness check: recompute each item's source/durable
  -- fingerprint from the current row (locked FOR UPDATE so nothing else
  -- can change it under us) and compare against what was recorded when the
  -- plan was created. Any mismatch means the underlying record changed
  -- after the plan was built -- abort the whole plan rather than execute
  -- against data neither party actually approved.
  for v_item in
    select * from public.profile_transfer_plan_items where plan_id = p_plan_id order by domain, source_record_id
  loop
    if v_item.domain = 'skills' then
      select encode(extensions.digest(convert_to(to_jsonb(s)::text, 'utf8'), 'sha256'), 'hex')
        into v_current_fingerprint from public.skills s where s.id = v_item.source_record_id for update;
    elsif v_item.domain = 'courses' then
      select encode(extensions.digest(convert_to(to_jsonb(c)::text, 'utf8'), 'sha256'), 'hex')
        into v_current_fingerprint from public.courses c where c.id = v_item.source_record_id for update;
    elsif v_item.domain = 'experience' then
      select encode(extensions.digest(convert_to(to_jsonb(e)::text, 'utf8'), 'sha256'), 'hex')
        into v_current_fingerprint from public.experience e where e.id = v_item.source_record_id for update;
    else
      raise exception 'Unsupported plan item domain: %', v_item.domain;
    end if;
    if v_current_fingerprint is null or v_current_fingerprint is distinct from (v_item.metadata ->> 'sourceFingerprint') then
      raise exception 'Source record for item % has changed since this plan was approved', v_item.id;
    end if;

    if v_item.durable_record_id is not null then
      if v_item.domain = 'skills' then
        select encode(extensions.digest(convert_to(to_jsonb(s)::text, 'utf8'), 'sha256'), 'hex')
          into v_current_fingerprint from public.skills s where s.id = v_item.durable_record_id for update;
      elsif v_item.domain = 'courses' then
        select encode(extensions.digest(convert_to(to_jsonb(c)::text, 'utf8'), 'sha256'), 'hex')
          into v_current_fingerprint from public.courses c where c.id = v_item.durable_record_id for update;
      elsif v_item.domain = 'experience' then
        select encode(extensions.digest(convert_to(to_jsonb(e)::text, 'utf8'), 'sha256'), 'hex')
          into v_current_fingerprint from public.experience e where e.id = v_item.durable_record_id for update;
      end if;
      if v_current_fingerprint is null or v_current_fingerprint is distinct from (v_item.metadata ->> 'durableFingerprint') then
        raise exception 'Durable record for item % has changed since this plan was approved', v_item.id;
      end if;
    end if;

    -- Decision 2, re-verified defensively: the losing side of any
    -- keep_durable/use_source item must still have no exclusive
    -- dependents. resolve_profile_transfer_plan_item already enforces
    -- this at resolution time; this is the guarded executor's own
    -- independent check, not a trust of that earlier check.
    if v_item.action = 'keep_durable' and v_item.domain = 'skills' and private.skill_has_exclusive_dependents(v_item.source_record_id) then
      raise exception 'Item % cannot keep the durable record: the source record has evidence or history attached', v_item.id;
    elsif v_item.action = 'keep_durable' and v_item.domain = 'courses' and private.course_has_exclusive_dependents(v_item.source_record_id) then
      raise exception 'Item % cannot keep the durable record: the source record has links attached', v_item.id;
    elsif v_item.action = 'keep_durable' and v_item.domain = 'experience' and private.experience_has_exclusive_dependents(v_item.source_record_id) then
      raise exception 'Item % cannot keep the durable record: the source record has links attached', v_item.id;
    elsif v_item.action = 'use_source' and v_item.domain = 'skills' and private.skill_has_exclusive_dependents(v_item.durable_record_id) then
      raise exception 'Item % cannot use the source record: the durable record has evidence or history attached', v_item.id;
    elsif v_item.action = 'use_source' and v_item.domain = 'courses' and private.course_has_exclusive_dependents(v_item.durable_record_id) then
      raise exception 'Item % cannot use the source record: the durable record has links attached', v_item.id;
    elsif v_item.action = 'use_source' and v_item.domain = 'experience' and private.experience_has_exclusive_dependents(v_item.durable_record_id) then
      raise exception 'Item % cannot use the source record: the durable record has links attached', v_item.id;
    end if;
  end loop;

  -- Decision 1: a parent experience and every child pointing at it must
  -- share the exact same action -- never allowed to diverge across
  -- profiles. Checked as its own pass since it spans two plan items.
  if exists (
    select 1
    from public.profile_transfer_plan_items parent_item
    join public.experience child on child.parent_experience_id = parent_item.source_record_id
    join public.profile_transfer_plan_items child_item
      on child_item.plan_id = p_plan_id and child_item.domain = 'experience' and child_item.source_record_id = child.id
    where parent_item.plan_id = p_plan_id and parent_item.domain = 'experience'
      and child_item.action is distinct from parent_item.action
  ) then
    raise exception 'A parent experience and its child experiences must share the same resolution -- resolve them together before approving';
  end if;

  -- Apply every item's action to its root table. Order within a domain
  -- doesn't matter (each item is independent), but retirements must not
  -- be starved by a still-open row lock from the fingerprint pass above --
  -- they're the same locked rows, so this is safe within one transaction.
  for v_item in select * from public.profile_transfer_plan_items where plan_id = p_plan_id loop
    if v_item.action = 'move' then
      v_canonical_id := v_item.source_record_id;
      if v_item.domain = 'skills' then
        update public.skills set user_id = v_durable_user_id where id = v_item.source_record_id;
      elsif v_item.domain = 'courses' then
        update public.courses set user_id = v_durable_user_id where id = v_item.source_record_id;
      elsif v_item.domain = 'experience' then
        update public.experience set user_id = v_durable_user_id where id = v_item.source_record_id;
      end if;
    elsif v_item.action = 'keep_durable' then
      v_canonical_id := v_item.durable_record_id;
      if v_item.domain = 'skills' then
        delete from public.skills where id = v_item.source_record_id;
      elsif v_item.domain = 'courses' then
        delete from public.courses where id = v_item.source_record_id;
      elsif v_item.domain = 'experience' then
        delete from public.experience where id = v_item.source_record_id;
      end if;
    elsif v_item.action = 'use_source' then
      v_canonical_id := v_item.source_record_id;
      if v_item.domain = 'skills' then
        delete from public.skills where id = v_item.durable_record_id;
        update public.skills set user_id = v_durable_user_id where id = v_item.source_record_id;
      elsif v_item.domain = 'courses' then
        delete from public.courses where id = v_item.durable_record_id;
        update public.courses set user_id = v_durable_user_id where id = v_item.source_record_id;
      elsif v_item.domain = 'experience' then
        delete from public.experience where id = v_item.durable_record_id;
        update public.experience set user_id = v_durable_user_id where id = v_item.source_record_id;
      end if;
    else
      raise exception 'Item % has no resolved action', v_item.id;
    end if;

    insert into public.profile_transfer_execution_records
      (plan_id, item_id, domain, source_record_id, canonical_record_id, action)
    values (p_plan_id, v_item.id, v_item.domain, v_item.source_record_id, v_canonical_id, v_item.action);
  end loop;

  -- Every dependent table's own denormalized ownership column, reassigned
  -- next. A security review of this migration caught a real gap in an
  -- earlier version: these were reassigned by plain identity (`where
  -- user_id = v_source_user_id`) on the theory that every surviving row
  -- naming the source login already belongs to a moved/use_source root.
  -- That's only true for dependents that existed when the plan was
  -- created. profile_transfer_plans.expires_at allows up to 7 days between
  -- plan creation and execution -- if the source learner adds a *new*
  -- skill (with its own target/tag/assessment/etc.) during that window,
  -- that skill is correctly never captured in profile_transfer_plan_items
  -- and correctly stays with the source login, but a plain identity match
  -- would still sweep its dependents to the durable login, leaving them
  -- pointing at a skill/course/experience the durable login doesn't own --
  -- and, for tables whose RLS is unconditional on that denormalized column
  -- alone (skill_targets, skill_tags, etc.: `using (auth.uid() = user_id)`,
  -- no join back to the skill's own ownership), that's a real unintended
  -- access grant, not just an inconsistency.
  --
  -- Fixed by scoping every skill/course/experience-keyed dependent to the
  -- specific ids this execution actually processed (profile_transfer_
  -- execution_records, populated by the loop above), not by identity
  -- alone. rater_id/validator_id on skill_peer_ratings/skill_validation_
  -- requests are the one deliberate exception, unchanged: those describe
  -- the transferring learner's own action on *someone else's* skill (never
  -- a row this plan's skill items could scope against), matching
  -- principle 1 of docs/profile-transfer-execution-rules.md, and neither
  -- column drives that table's RLS on its own (ownership there is gated on
  -- skill_owner_id/requester_id, both of which -- unlike rater_id/
  -- validator_id -- are handled by the scoped updates below since they
  -- describe the transferring learner's *own* skill by construction, per
  -- each table's insert-time check). profile_share_links has no skill/
  -- course/experience column at all -- single-owner content in its own
  -- right, same as skills itself -- so it keeps its identity-only update.
  update public.skill_assessments set user_id = v_durable_user_id
  where user_id = v_source_user_id and skill_id in (
    select r.canonical_record_id from public.profile_transfer_execution_records r
    where r.plan_id = p_plan_id and r.domain = 'skills' and r.action in ('move', 'use_source')
  );
  update public.skill_baseline_quizzes set user_id = v_durable_user_id
  where user_id = v_source_user_id and skill_id in (
    select r.canonical_record_id from public.profile_transfer_execution_records r
    where r.plan_id = p_plan_id and r.domain = 'skills' and r.action in ('move', 'use_source')
  );
  update public.skill_tags set user_id = v_durable_user_id
  where user_id = v_source_user_id and skill_id in (
    select r.canonical_record_id from public.profile_transfer_execution_records r
    where r.plan_id = p_plan_id and r.domain = 'skills' and r.action in ('move', 'use_source')
  );
  update public.skill_targets set user_id = v_durable_user_id
  where user_id = v_source_user_id and skill_id in (
    select r.canonical_record_id from public.profile_transfer_execution_records r
    where r.plan_id = p_plan_id and r.domain = 'skills' and r.action in ('move', 'use_source')
  );
  update public.skill_course_links set user_id = v_durable_user_id
  where user_id = v_source_user_id and (
    skill_id in (
      select r.canonical_record_id from public.profile_transfer_execution_records r
      where r.plan_id = p_plan_id and r.domain = 'skills' and r.action in ('move', 'use_source')
    )
    or course_id in (
      select r.canonical_record_id from public.profile_transfer_execution_records r
      where r.plan_id = p_plan_id and r.domain = 'courses' and r.action in ('move', 'use_source')
    )
  );
  update public.skill_experience_links set user_id = v_durable_user_id
  where user_id = v_source_user_id and (
    skill_id in (
      select r.canonical_record_id from public.profile_transfer_execution_records r
      where r.plan_id = p_plan_id and r.domain = 'skills' and r.action in ('move', 'use_source')
    )
    or experience_id in (
      select r.canonical_record_id from public.profile_transfer_execution_records r
      where r.plan_id = p_plan_id and r.domain = 'experience' and r.action in ('move', 'use_source')
    )
  );
  update public.course_experience_links set user_id = v_durable_user_id
  where user_id = v_source_user_id and (
    course_id in (
      select r.canonical_record_id from public.profile_transfer_execution_records r
      where r.plan_id = p_plan_id and r.domain = 'courses' and r.action in ('move', 'use_source')
    )
    or experience_id in (
      select r.canonical_record_id from public.profile_transfer_execution_records r
      where r.plan_id = p_plan_id and r.domain = 'experience' and r.action in ('move', 'use_source')
    )
  );
  update public.xapi_statement_skills set user_id = v_durable_user_id
  where user_id = v_source_user_id and skill_id in (
    select r.canonical_record_id from public.profile_transfer_execution_records r
    where r.plan_id = p_plan_id and r.domain = 'skills' and r.action in ('move', 'use_source')
  );
  -- course_content_progress has no FK to the personal courses table at all
  -- -- it's keyed to content_resources (an organisation's content library,
  -- 0073_content_resource_library.sql), linked to a specific catalogue
  -- course only via course_content_links(course_id, resource_id). A moved
  -- personal course's completion evidence is found by joining
  -- content_item_id -> course_content_links.resource_id ->
  -- course_content_links.course_id -> courses.catalogue_course_id, the
  -- same join course_content_progress's own "Provider admins can view
  -- participant progress" policy already uses. Named explicitly in
  -- docs/profile-transfer-execution-rules.md's move rule for courses; a
  -- security review of an earlier version of this migration caught that it
  -- had been omitted entirely, silently orphaning SCORM/xAPI completion
  -- evidence for any moved course that came from the catalogue.
  update public.course_content_progress set user_id = v_durable_user_id
  where user_id = v_source_user_id and content_item_id in (
    select ccl.resource_id
    from public.course_content_links ccl
    join public.courses c on c.catalogue_course_id = ccl.course_id
    where c.id in (
      select r.canonical_record_id from public.profile_transfer_execution_records r
      where r.plan_id = p_plan_id and r.domain = 'courses' and r.action in ('move', 'use_source')
    )
  );
  update public.profile_searchable_skills set profile_id = v_durable_user_id
  where profile_id = v_source_user_id and skill_id in (
    select r.canonical_record_id from public.profile_transfer_execution_records r
    where r.plan_id = p_plan_id and r.domain = 'skills' and r.action in ('move', 'use_source')
  );
  update public.connection_invites set inviter_id = v_durable_user_id
  where inviter_id = v_source_user_id and skill_id in (
    select r.canonical_record_id from public.profile_transfer_execution_records r
    where r.plan_id = p_plan_id and r.domain = 'skills' and r.action in ('move', 'use_source')
  );
  update public.skill_peer_ratings set skill_owner_id = v_durable_user_id
  where skill_owner_id = v_source_user_id and skill_id in (
    select r.canonical_record_id from public.profile_transfer_execution_records r
    where r.plan_id = p_plan_id and r.domain = 'skills' and r.action in ('move', 'use_source')
  );
  update public.skill_peer_ratings set rater_id = v_durable_user_id where rater_id = v_source_user_id;
  update public.skill_validation_requests set requester_id = v_durable_user_id
  where requester_id = v_source_user_id and skill_id in (
    select r.canonical_record_id from public.profile_transfer_execution_records r
    where r.plan_id = p_plan_id and r.domain = 'skills' and r.action in ('move', 'use_source')
  );
  update public.skill_validation_requests set validator_id = v_durable_user_id where validator_id = v_source_user_id;
  update public.profile_share_links set user_id = v_durable_user_id where user_id = v_source_user_id;

  -- Postcondition: every move/use_source item's canonical record must now
  -- actually belong to the durable login, and every keep_durable/use_source
  -- item's retired record must actually be gone. Mark execution complete
  -- only once this holds -- if it doesn't, something above didn't do what
  -- it claimed, and the transaction must not commit as 'executed'.
  if exists (
    select 1 from public.profile_transfer_execution_records r
    where r.plan_id = p_plan_id and r.action in ('move', 'use_source')
      and (
        (r.domain = 'skills' and not exists (select 1 from public.skills s where s.id = r.canonical_record_id and s.user_id = v_durable_user_id))
        or (r.domain = 'courses' and not exists (select 1 from public.courses c where c.id = r.canonical_record_id and c.user_id = v_durable_user_id))
        or (r.domain = 'experience' and not exists (select 1 from public.experience e where e.id = r.canonical_record_id and e.user_id = v_durable_user_id))
      )
  ) then
    raise exception 'Postcondition failed: not every moved record resolved to the durable login';
  end if;
  if exists (
    select 1 from public.profile_transfer_execution_records r
    where r.plan_id = p_plan_id and r.action = 'keep_durable'
      and (
        (r.domain = 'skills' and exists (select 1 from public.skills s where s.id = r.source_record_id))
        or (r.domain = 'courses' and exists (select 1 from public.courses c where c.id = r.source_record_id))
        or (r.domain = 'experience' and exists (select 1 from public.experience e where e.id = r.source_record_id))
      )
  ) then
    raise exception 'Postcondition failed: a retired source record still exists';
  end if;
  if exists (
    select 1 from public.profile_transfer_execution_records r
    where r.plan_id = p_plan_id and r.action = 'use_source'
      and (
        (r.domain = 'skills' and exists (select 1 from public.skills s where s.id = (select durable_record_id from public.profile_transfer_plan_items where id = r.item_id)))
        or (r.domain = 'courses' and exists (select 1 from public.courses c where c.id = (select durable_record_id from public.profile_transfer_plan_items where id = r.item_id)))
        or (r.domain = 'experience' and exists (select 1 from public.experience e where e.id = (select durable_record_id from public.profile_transfer_plan_items where id = r.item_id)))
      )
  ) then
    raise exception 'Postcondition failed: a retired durable record still exists';
  end if;

  update public.profile_transfer_plans
  set status = 'executed', executed_at = now(), execution_idempotency_key = p_idempotency_key, updated_at = now()
  where id = p_plan_id;
  insert into public.profile_transfer_plan_events (plan_id, actor_auth_account_id, event_type, details)
  values (p_plan_id, v_account_id, 'executed', jsonb_build_object('idempotencyKey', p_idempotency_key));

  select jsonb_build_object(
    'planId', p_plan_id, 'executedAt', now(),
    'records', coalesce(jsonb_agg(jsonb_build_object(
      'domain', r.domain, 'sourceRecordId', r.source_record_id,
      'canonicalRecordId', r.canonical_record_id, 'action', r.action
    )), '[]'::jsonb)
  ) into v_result
  from public.profile_transfer_execution_records r where r.plan_id = p_plan_id;
  return v_result;
end
$$;

revoke all on function public.execute_profile_transfer_plan(uuid, uuid) from public, anon;
grant execute on function public.execute_profile_transfer_plan(uuid, uuid) to authenticated;
