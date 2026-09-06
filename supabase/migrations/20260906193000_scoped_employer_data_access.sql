-- Requested scope is separate from consent. Existing grants remain skills-only.
alter table public.employer_data_access_requests
  add column requested_data text[] not null default array['skills']::text[],
  add column requested_skill_library_ids uuid[] not null default array[]::uuid[],
  add column requested_skill_names text[] not null default array[]::text[],
  add column request_comment text,
  add column approved_data text[] not null default array['skills']::text[],
  add constraint employer_access_requested_data_check check (
    cardinality(requested_data) > 0 and requested_data <@ array['skills','training','experience']::text[]
    and array_position(requested_data, null) is null),
  add constraint employer_access_approved_data_check check (
    approved_data <@ array['skills','training','experience']::text[] and array_position(approved_data, null) is null),
  add constraint employer_access_comment_length check (char_length(request_comment) <= 2000);

create or replace function public.request_scoped_employer_data_access(
  p_employer_id uuid, p_learner_id uuid, p_requested_data text[],
  p_skill_library_ids uuid[] default array[]::uuid[], p_comment text default null
) returns public.employer_data_access_requests
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.employer_data_access_requests%rowtype;
  v_names text[];
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_employer_admin(p_employer_id, auth.uid()) then raise exception 'Not authorized'; end if;
  -- Serialize requests against the membership, including the first request.
  perform 1 from public.employer_members where employer_id = p_employer_id
    and user_id = p_learner_id and status = 'active' for update;
  if not found then raise exception 'This person is not an active member of this employer.'; end if;
  if p_requested_data is null or cardinality(p_requested_data) = 0
    or not p_requested_data <@ array['skills','training','experience']::text[]
    or array_position(p_requested_data, null) is not null then
    raise exception 'Choose skills, training or experience.';
  end if;
  if p_skill_library_ids is null or array_position(p_skill_library_ids, null) is not null
    or cardinality(p_skill_library_ids) > 500 then raise exception 'Invalid skill selection.'; end if;
  if cardinality(p_skill_library_ids) > 0 and not 'skills' = any(p_requested_data) then
    raise exception 'Specific skills require a skills request.';
  end if;
  if char_length(p_comment) > 2000 then raise exception 'Comment must be 2000 characters or fewer.'; end if;
  -- Only public catalogue identities; never inspect a learner's private skills.
  if exists (select 1 from unnest(p_skill_library_ids) sid where not exists (
    select 1 from public.skill_library s where s.id = sid and not s.is_private and s.status = 'active'
  )) then raise exception 'Choose active public catalogue skills.'; end if;
  select coalesce(array_agg(s.name order by s.name), array[]::text[]) into v_names
    from public.skill_library s where s.id = any(p_skill_library_ids);
  select * into v_row from public.employer_data_access_requests
    where employer_id = p_employer_id and learner_id = p_learner_id for update;
  if found and v_row.status in ('pending', 'approved') then
    raise exception 'This user already has a pending request or approved access.';
  end if;
  insert into public.employer_data_access_requests
    (employer_id, learner_id, requested_by, status, requested_data, requested_skill_library_ids, requested_skill_names, request_comment, approved_data)
  values (p_employer_id, p_learner_id, auth.uid(), 'pending', p_requested_data, p_skill_library_ids, v_names, nullif(btrim(p_comment), ''), array[]::text[])
  on conflict (employer_id, learner_id) do update set
    requested_by = auth.uid(), status = 'pending', requested_data = excluded.requested_data,
    requested_skill_library_ids = excluded.requested_skill_library_ids, requested_skill_names = excluded.requested_skill_names,
    request_comment = excluded.request_comment, approved_data = array[]::text[], created_at = now(), decided_at = null
  returning * into v_row;
  delete from public.employer_data_access_shared_skills where request_id = v_row.id;
  return v_row;
end;
$$;
revoke all on function public.request_scoped_employer_data_access(uuid, uuid, text[], uuid[], text) from public, anon, authenticated;
grant execute on function public.request_scoped_employer_data_access(uuid, uuid, text[], uuid[], text) to authenticated;

create or replace function public.decide_scoped_employer_data_access(
  p_request_id uuid, p_accept boolean, p_skill_ids uuid[], p_approved_data text[]
) returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.employer_data_access_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into v_row from public.employer_data_access_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_row.learner_id <> auth.uid() then raise exception 'Not authorized'; end if;
  if v_row.status <> 'pending' then raise exception 'This request has already been decided.'; end if;
  if p_accept is null then raise exception 'Choose accept or decline.'; end if;
  if p_accept then
    if not public.is_employer_member(v_row.employer_id, v_row.learner_id) then raise exception 'Employer membership is no longer active.'; end if;
    if p_approved_data is null or cardinality(p_approved_data) = 0
      or not p_approved_data <@ v_row.requested_data or array_position(p_approved_data, null) is not null then
      raise exception 'Approve only the data requested.';
    end if;
    if p_skill_ids is null or array_position(p_skill_ids, null) is not null then raise exception 'Invalid skill selection.'; end if;
    if not 'skills' = any(p_approved_data) and cardinality(p_skill_ids) > 0 then raise exception 'Skills were not approved.'; end if;
    if 'skills' = any(p_approved_data) and cardinality(p_skill_ids) = 0 then raise exception 'Choose at least one skill to share.'; end if;
    if exists (select 1 from unnest(p_skill_ids) sid where not exists (
      select 1 from public.skills s where s.id = sid and s.user_id = auth.uid()
        and (cardinality(v_row.requested_skill_library_ids) = 0 or s.library_skill_id = any(v_row.requested_skill_library_ids))
    )) then raise exception 'Choose only your own requested skills.'; end if;
    perform public.set_employer_data_access_shared_skills(p_request_id, p_skill_ids);
  end if;
  update public.employer_data_access_requests set status = case when p_accept then 'approved' else 'declined' end,
    approved_data = case when p_accept then p_approved_data else array[]::text[] end, decided_at = now() where id = p_request_id;
end;
$$;
revoke all on function public.decide_scoped_employer_data_access(uuid, boolean, uuid[], text[]) from public, anon, authenticated;
grant execute on function public.decide_scoped_employer_data_access(uuid, boolean, uuid[], text[]) to authenticated;

-- Old clients can only consent to skills, never silently consent to new categories.
create or replace function public.decide_employer_data_access_request(p_request_id uuid, p_accept boolean, p_skill_ids uuid[] default array[]::uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.decide_scoped_employer_data_access(p_request_id, p_accept, p_skill_ids,
    case when p_accept then array['skills']::text[] else array[]::text[] end);
end;
$$;

create or replace function public.has_employer_category_access(p_learner_id uuid, p_category text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.employer_data_access_requests r
    where r.learner_id = p_learner_id and r.status = 'approved' and p_category = any(r.approved_data)
      and public.is_employer_admin(r.employer_id, auth.uid())
      and public.is_employer_member(r.employer_id, r.learner_id));
$$;
revoke all on function public.has_employer_category_access(uuid, text) from public, anon, authenticated;
grant execute on function public.has_employer_category_access(uuid, text) to authenticated;
create policy "Employers can view consented training" on public.courses for select to authenticated
  using (public.has_employer_category_access(user_id, 'training'));
create policy "Employers can view consented experience" on public.experience for select to authenticated
  using (public.has_employer_category_access(user_id, 'experience'));
grant select on public.experience to authenticated;

-- A later proactive skills share must not revive previously approved categories.
create or replace function public.share_data_with_employer(p_employer_id uuid, p_skill_ids uuid[] default array[]::uuid[])
returns public.employer_data_access_requests language plpgsql security definer set search_path = '' as $$
declare v_row public.employer_data_access_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_employer_member(p_employer_id, auth.uid()) then raise exception 'You are not an active member of this employer.'; end if;
  insert into public.employer_data_access_requests (employer_id, learner_id, requested_by, status, decided_at, requested_data, approved_data)
  values (p_employer_id, auth.uid(), null, 'approved', now(), array['skills']::text[], array['skills']::text[])
  on conflict (employer_id, learner_id) do update set status = 'approved', requested_by = null, decided_at = now(),
    requested_data = array['skills']::text[], approved_data = array['skills']::text[],
    requested_skill_library_ids = array[]::uuid[], requested_skill_names = array[]::text[], request_comment = null
  returning * into v_row;
  perform public.set_employer_data_access_shared_skills(v_row.id, p_skill_ids);
  return v_row;
end;
$$;

revoke all on function public.decide_employer_data_access_request(uuid, boolean, uuid[]) from public, anon, authenticated;
grant execute on function public.decide_employer_data_access_request(uuid, boolean, uuid[]) to authenticated;
revoke all on function public.share_data_with_employer(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.share_data_with_employer(uuid, uuid[]) to authenticated;
