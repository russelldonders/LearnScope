-- 20260928202323 rewrote these functions by find-and-replace (employers ->
-- organisations) inside a DO block, so their live definitions existed only in
-- the database. They're restated here exactly as they were live on Staging
-- (pg_get_functiondef), so the repo is their source of truth again.
--
-- Three of them lost a rule in that rewrite: the old employers relation only
-- contained organisations that employ people, and these list or look up
-- organisations by slug, so they now also returned providers and every other
-- organisation. The employs_people check is restored in:
--   * private.sharing_employer_directory (provider "share with an employer"
--     picker) -- also leaves out the provider itself;
--   * public.get_employer_login_context (employer login page branding);
--   * public.get_public_employer_catalogue_courses (public employer
--     catalogue).
-- Every other function below is unchanged. CREATE OR REPLACE keeps each
-- function's existing grants.

-- private.employer_catalogue_is_enabled
CREATE OR REPLACE FUNCTION private.employer_catalogue_is_enabled(p_employer uuid, p_catalogue uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.organisations employer
    join public.catalogues catalogue on catalogue.id = p_catalogue
    where employer.id = p_employer
      and not catalogue.is_global
      and (
        catalogue.organisation_id = employer.id
        or exists (
          select 1
          from public.employer_linked_providers link
          where link.employer_id = employer.id
            and link.provider_organisation_id = catalogue.organisation_id
            and link.status = 'accepted'
            and (
              (link.sharing ->> 'all')::boolean
              or exists (
                select 1
                from jsonb_array_elements(link.sharing -> 'catalogues') selection
                where (selection ->> 'id')::uuid = catalogue.id
              )
            )
        )
      )
      and exists (
        select 1
        from public.course_catalogue_publications publication
        where publication.catalogue_id = catalogue.id
          and publication.published_at is not null
          and public.employer_course_is_enabled(employer.id, publication.course_id)
      )
  )
$function$;

-- private.guard_employer_provider_sharing
CREATE OR REPLACE FUNCTION private.guard_employer_provider_sharing()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.employer_linked_providers;
  item jsonb;
  course jsonb;
  selection jsonb;
  actor uuid := auth.uid();
begin
  -- Foreign-key cascades may clear audit users or remove a deleted parent.
  if pg_trigger_depth() > 1 then
    if TG_OP = 'DELETE' and (
      not exists(select 1 from public.organisations where id=old.employer_id)
      or not exists(select 1 from public.organisations where id=old.provider_organisation_id)
    ) then return old; end if;
    if TG_OP = 'UPDATE'
      and (to_jsonb(new)-array['linked_by','decided_by']) = (to_jsonb(old)-array['linked_by','decided_by'])
      and (new.linked_by is null or new.linked_by is not distinct from old.linked_by)
      and (new.decided_by is null or new.decided_by is not distinct from old.decided_by)
    then return new; end if;
  end if;

  if TG_OP = 'DELETE' then v := old; else v := new; end if;
  if actor is null or not (public.is_employer_admin(v.employer_id,actor) or public.is_org_admin(v.provider_organisation_id,actor)) then
    raise exception 'Not authorized';
  end if;
  if exists(select 1 from public.organisations e where e.id=v.employer_id and e.id=v.provider_organisation_id) then
    raise exception 'The main provider connection is permanent';
  end if;
  if TG_OP = 'DELETE' then return old; end if;

  if TG_OP = 'INSERT' then
    if new.status <> 'pending' or new.linked_by is distinct from actor
      or new.decided_by is not null or new.decided_at is not null
      or new.pending_sharing is not null or new.pending_initiated_by is not null or new.pending_requested_at is not null then
      raise exception 'A connection must start as a pending request';
    end if;
    if not (case new.initiated_by when 'employer' then public.is_employer_admin(new.employer_id,actor) else public.is_org_admin(new.provider_organisation_id,actor) end) then
      raise exception 'Not authorized to send this request';
    end if;
    selection := new.sharing;
  else
    if new.employer_id is distinct from old.employer_id
      or new.provider_organisation_id is distinct from old.provider_organisation_id then
      raise exception 'Connection identities cannot change';
    end if;

    if old.status = 'pending' then
      if new.linked_by is distinct from old.linked_by then
        raise exception 'Connection identities cannot change';
      end if;
      if new.status = 'pending' then
        if (to_jsonb(new)-array['sharing']) is distinct from (to_jsonb(old)-array['sharing']) then
          raise exception 'Only the pending selection can be updated';
        end if;
        selection := new.sharing;
      elsif new.status in ('accepted','declined') then
        if (to_jsonb(new)-array['status','decided_at','decided_by']) is distinct from (to_jsonb(old)-array['status','decided_at','decided_by']) then
          raise exception 'Only the request decision can change';
        end if;
        if not (case old.initiated_by when 'employer' then public.is_org_admin(old.provider_organisation_id,actor) else public.is_employer_admin(old.employer_id,actor) end) then
          raise exception 'Only the receiving organisation can approve or decline';
        end if;
        new.decided_at := now();
        new.decided_by := actor;
        return new;
      else
        raise exception 'Invalid request status';
      end if;
    elsif old.status = 'accepted' then
      if new.linked_by is distinct from old.linked_by then
        raise exception 'Connection identities cannot change';
      end if;
      if old.pending_sharing is null then
        if to_jsonb(new) = to_jsonb(old) then
          raise exception 'This request has already been decided';
        end if;
        if new.pending_sharing is null
          or (to_jsonb(new)-array['pending_sharing','pending_initiated_by','pending_requested_at']) is distinct from (to_jsonb(old)-array['pending_sharing','pending_initiated_by','pending_requested_at']) then
          raise exception 'Accepted sharing changes require a new approval';
        end if;
        if not (case new.pending_initiated_by when 'employer' then public.is_employer_admin(new.employer_id,actor) else public.is_org_admin(new.provider_organisation_id,actor) end) then
          raise exception 'Not authorized to request this change';
        end if;
        new.pending_requested_at := now();
        selection := new.pending_sharing;
      elsif new.pending_sharing is not null then
        if (to_jsonb(new)-array['pending_sharing']) is distinct from (to_jsonb(old)-array['pending_sharing']) then
          raise exception 'Only the pending selection can be updated';
        end if;
        selection := new.pending_sharing;
      else
        if (to_jsonb(new)-array['sharing','pending_sharing','pending_initiated_by','pending_requested_at','decided_at','decided_by'])
          is distinct from (to_jsonb(old)-array['sharing','pending_sharing','pending_initiated_by','pending_requested_at','decided_at','decided_by'])
          or new.sharing not in (old.sharing, old.pending_sharing) then
          raise exception 'Invalid selection update decision';
        end if;
        if not (case old.pending_initiated_by when 'employer' then public.is_org_admin(old.provider_organisation_id,actor) else public.is_employer_admin(old.employer_id,actor) end) then
          raise exception 'Only the receiving organisation can approve or decline';
        end if;
        new.pending_initiated_by := null;
        new.pending_requested_at := null;
        new.decided_at := now();
        new.decided_by := actor;
        return new;
      end if;
    elsif old.status = 'declined' then
      if new.status <> 'pending'
        or new.pending_sharing is not null or new.pending_initiated_by is not null or new.pending_requested_at is not null
        or (to_jsonb(new)-array['status','sharing','initiated_by','linked_by','decided_at','decided_by'])
          is distinct from (to_jsonb(old)-array['status','sharing','initiated_by','linked_by','decided_at','decided_by']) then
        raise exception 'A declined request can only be sent again for approval';
      end if;
      if new.linked_by is distinct from actor
        or not (case new.initiated_by when 'employer' then public.is_employer_admin(new.employer_id,actor) else public.is_org_admin(new.provider_organisation_id,actor) end) then
        raise exception 'Not authorized to send this request';
      end if;
      new.decided_at := null;
      new.decided_by := null;
      selection := new.sharing;
    else
      raise exception 'Invalid request status';
    end if;
  end if;

  if jsonb_typeof(selection) is distinct from 'object'
    or jsonb_typeof(selection->'all') is distinct from 'boolean'
    or jsonb_typeof(selection->'catalogues') is distinct from 'array' then
    raise exception 'Invalid sharing selection';
  end if;
  if not (selection->>'all')::boolean and jsonb_array_length(selection->'catalogues')=0 then
    raise exception 'Select at least one catalogue';
  end if;
  for item in select value from jsonb_array_elements(selection->'catalogues') loop
    if not exists(
      select 1 from public.catalogues c
      where c.id=(item->>'id')::uuid and c.organisation_id=new.provider_organisation_id and not c.is_global
    ) then raise exception 'Select a catalogue owned by this provider'; end if;
    if jsonb_typeof(item->'all') is distinct from 'boolean' or jsonb_typeof(item->'courses') is distinct from 'array' then
      raise exception 'Invalid course selection';
    end if;
    if not (item->>'all')::boolean and jsonb_array_length(item->'courses')=0 then
      raise exception 'Select at least one course in each catalogue';
    end if;
    for course in select value from jsonb_array_elements(item->'courses') loop
      if not exists(
        select 1 from public.course_catalogue_publications p
        join public.course_catalogue cc on cc.id=p.course_id
        where p.catalogue_id=(item->>'id')::uuid and p.course_id=(course#>>'{}')::uuid
          and p.published_at is not null and cc.status='approved' and cc.is_current_published
      ) then raise exception 'Select a published course in this catalogue'; end if;
    end loop;
  end loop;
  return new;
end $function$;

-- private.sharing_employer_directory (employs_people rule restored)
CREATE OR REPLACE FUNCTION private.sharing_employer_directory(p_provider uuid)
 RETURNS TABLE(id uuid, name text, provider_organisation_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or not public.is_org_admin(p_provider,auth.uid()) then raise exception 'Not authorized'; end if;
  return query select e.id,e.name,e.id from public.organisations e
    where e.id <> p_provider and exists (
      select 1 from public.organisation_capabilities oc
      where oc.organisation_id = e.id and oc.capability = 'employs_people' and oc.status = 'active'
    )
    order by e.name;
end $function$;

-- public.assign_course_to_employer_members
CREATE OR REPLACE FUNCTION public.assign_course_to_employer_members(p_employer_id uuid, p_catalogue_course_id uuid, p_user_ids uuid[])
 RETURNS SETOF course_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := (select auth.uid());
  v_provider_organisation_id uuid;
begin
  if v_caller is null or not is_employer_admin(p_employer_id, v_caller) then
    raise exception 'Not authorized';
  end if;

  select id into v_provider_organisation_id
  from organisations
  where id = p_employer_id;

  if v_provider_organisation_id is null then
    raise exception 'Employer not found';
  end if;

  if not public.employer_course_is_enabled(p_employer_id, p_catalogue_course_id) then
    raise exception 'This course is not enabled by a confirmed sharing agreement';
  end if;

  return query
    insert into course_assignments (employer_id, catalogue_course_id, assigned_to, assigned_by)
    select p_employer_id, p_catalogue_course_id, uid.user_id, v_caller
    from unnest(p_user_ids) as uid(user_id)
    where exists (
      select 1 from employer_members
      where employer_id = p_employer_id
        and user_id = uid.user_id
        and status = 'active'
    )
    on conflict (employer_id, catalogue_course_id, assigned_to) do nothing
    returning *;
end;
$function$;

-- public.confirm_managed_employer_skill_level
CREATE OR REPLACE FUNCTION public.confirm_managed_employer_skill_level(p_employer_id uuid, p_employee_member_id uuid, p_skill_library_id uuid, p_level smallint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_employee_user_id uuid;
  v_confirmation_id uuid;
begin
  select member.user_id into v_employee_user_id
  from public.employer_members member
  where member.id = p_employee_member_id
    and member.employer_id = p_employer_id
    and member.status = 'active';

  if v_employee_user_id is null or not private.can_manage_employer_member(
    auth.uid(), p_employee_member_id, 'skill_management', true
  ) then
    raise exception 'Not authorised';
  end if;

  if p_level < 1 or p_level > 5 then
    raise exception 'Confirmed level must be between 1 and 5';
  end if;

  if not exists (
    select 1
    from public.organisations employer
    join public.organisation_offered_skills offered_skill
      on offered_skill.organisation_id = employer.id
    where employer.id = p_employer_id
      and offered_skill.skill_library_id = p_skill_library_id
  ) then
    raise exception 'This skill is not offered by this employer';
  end if;

  insert into public.employer_skill_confirmations
    (employer_id, user_id, library_skill_id, confirmed_level, confirmed_by)
  values
    (p_employer_id, v_employee_user_id, p_skill_library_id, p_level, auth.uid())
  returning id into v_confirmation_id;

  return v_confirmation_id;
end
$function$;

-- public.decide_employer_invite
CREATE OR REPLACE FUNCTION public.decide_employer_invite(p_member_id uuid, p_accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_member employer_members%rowtype;
  v_provider_organisation_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_member from employer_members where id = p_member_id for update;
  if not found then
    raise exception 'Invitation not found';
  end if;
  if v_member.user_id != auth.uid() then
    raise exception 'Not authorized';
  end if;
  if v_member.status != 'pending' then
    raise exception 'This invitation has already been decided.';
  end if;

  if p_accept then
    update employer_members set status = 'active' where id = p_member_id;

    if v_member.role = 'admin' then
      select id into v_provider_organisation_id
      from organisations where id = v_member.employer_id;

      -- Same on-conflict shape as addEmployerMember's own upsert (Phase 1):
      -- never downgrade an existing organisation_members row for this
      -- person -- admin is the top role there, so overwriting role/status
      -- to admin/active on conflict is always a promotion or a no-op, never
      -- a demotion.
      insert into organisation_members (organisation_id, user_id, role, status, invited_by)
      values (v_provider_organisation_id, v_member.user_id, 'admin', 'active', v_member.invited_by)
      on conflict (organisation_id, user_id) do update
        set role = 'admin', status = 'active', invited_by = excluded.invited_by;
    end if;
  else
    delete from employer_members where id = p_member_id;
  end if;
end;
$function$;

-- public.decide_employer_role_assignment
CREATE OR REPLACE FUNCTION public.decide_employer_role_assignment(p_assignment_id uuid, p_accept boolean, p_learner_experience_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid;
  v_role_profile_id uuid;
  v_assignment_start_date date;
  v_assignment_end_date date;
  v_role_name text;
  v_employer_name text;
  v_employer_url text;
  v_experience_id uuid;
  v_experience_end_date date;
  v_is_current_role boolean;
  v_req record;
  v_component record;
  v_skill_id uuid;
begin
  select em.user_id, a.role_profile_id, a.start_date, a.end_date
  into v_user_id, v_role_profile_id, v_assignment_start_date, v_assignment_end_date
  from public.employer_role_assignments a
  join public.employer_members em on em.id = a.employer_member_id
  where a.id = p_assignment_id and a.status = 'proposed';

  if v_user_id is distinct from auth.uid() then
    raise exception 'Pending role assignment not found';
  end if;

  if p_accept then
    if p_learner_experience_id is not null then
      select id, end_date into v_experience_id, v_experience_end_date
      from public.experience
      where id = p_learner_experience_id and user_id = auth.uid() and type = 'employment';
      if v_experience_id is null then
        raise exception 'Choose one of your own employment experiences';
      end if;

      if v_assignment_start_date is null and v_assignment_end_date is null then
        select e.name, o.url into v_employer_name, v_employer_url
        from public.employer_role_profiles rp
        join public.organisations e on e.id = rp.employer_id
        left join public.organisations o on o.id = e.id
        where rp.id = v_role_profile_id;

        if v_employer_url is not null then
          update public.experience set organization_url = v_employer_url where id = v_experience_id;
        end if;
      end if;
    else
      select rp.name, e.name, o.url
      into v_role_name, v_employer_name, v_employer_url
      from public.employer_role_profiles rp
      join public.organisations e on e.id = rp.employer_id
      left join public.organisations o on o.id = e.id
      where rp.id = v_role_profile_id;

      insert into public.experience (user_id, type, title, organization, organization_url, start_date, end_date)
      values (
        auth.uid(), 'employment', v_role_name, v_employer_name, v_employer_url,
        coalesce(v_assignment_start_date, current_date), v_assignment_end_date
      )
      returning id, end_date into v_experience_id, v_experience_end_date;
    end if;

    v_is_current_role := v_experience_end_date is null;

    for v_req in
      select rps.library_skill_id, sl.name as skill_name, sl.category as skill_category
      from public.employer_role_profile_skills rps
      join public.skill_library sl on sl.id = rps.library_skill_id
      where rps.role_profile_id = v_role_profile_id
    loop
      select id into v_skill_id
      from public.skills
      where user_id = auth.uid() and library_skill_id = v_req.library_skill_id;

      if v_skill_id is null then
        insert into public.skills (user_id, name, category, level, library_skill_id, source, is_current_role)
        values (auth.uid(), v_req.skill_name, v_req.skill_category, 1, v_req.library_skill_id, 'role_profile', v_is_current_role)
        returning id into v_skill_id;
      elsif v_is_current_role then
        update public.skills set is_current_role = true where id = v_skill_id and is_current_role is distinct from true;
      end if;

      insert into public.skill_experience_links (user_id, skill_id, experience_id)
      values (auth.uid(), v_skill_id, v_experience_id)
      on conflict (skill_id, experience_id) do nothing;

      for v_component in
        select cc.component_skill_id, csl.name as component_name, csl.category as component_category
        from public.skill_composite_definitions scd
        join public.skill_composite_components cc on cc.definition_id = scd.id
        join public.skill_library csl on csl.id = cc.component_skill_id
        where scd.parent_skill_id = v_req.library_skill_id and scd.status = 'published'
      loop
        select id into v_skill_id
        from public.skills
        where user_id = auth.uid() and library_skill_id = v_component.component_skill_id;

        if v_skill_id is null then
          insert into public.skills (user_id, name, category, level, library_skill_id, source, is_current_role)
          values (auth.uid(), v_component.component_name, v_component.component_category, 1, v_component.component_skill_id, 'role_profile', v_is_current_role)
          returning id into v_skill_id;
        elsif v_is_current_role then
          update public.skills set is_current_role = true where id = v_skill_id and is_current_role is distinct from true;
        end if;

        insert into public.skill_experience_links (user_id, skill_id, experience_id)
        values (auth.uid(), v_skill_id, v_experience_id)
        on conflict (skill_id, experience_id) do nothing;
      end loop;
    end loop;
  end if;

  update public.employer_role_assignments
  set status = case when p_accept then 'linked' else 'declined' end,
      learner_experience_id = case when p_accept then v_experience_id else null end,
      decided_at = now(), disconnected_at = null
  where id = p_assignment_id;
end
$function$;

-- public.employer_course_is_enabled
CREATE OR REPLACE FUNCTION public.employer_course_is_enabled(p_employer uuid, p_course uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
select exists (
 select 1 from public.course_catalogue_publications p
 join public.catalogues c on c.id=p.catalogue_id
 join public.course_catalogue cc on cc.id=p.course_id
 join public.organisations e on e.id=p_employer
 where p.course_id=p_course and p.published_at is not null and cc.status='approved' and cc.is_current_published
 and (c.organisation_id=e.id or exists (
  select 1 from public.employer_linked_providers l
  where l.employer_id=e.id and l.provider_organisation_id=c.organisation_id and l.status='accepted'
  and ((l.sharing->>'all')::boolean or exists (
   select 1 from jsonb_array_elements(l.sharing->'catalogues') s
   where (s->>'id')::uuid=c.id and ((s->>'all')::boolean or s->'courses' @> jsonb_build_array(p_course::text))
  ))
 ))
) $function$;

-- public.get_employer_login_context (employs_people rule restored)
CREATE OR REPLACE FUNCTION public.get_employer_login_context(p_slug text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select json_build_object('id', e.id, 'name', e.name)
  from organisations e
  join organisations o on o.id = e.id
  where o.slug = p_slug
    and exists (
      select 1 from organisation_capabilities oc
      where oc.organisation_id = e.id and oc.capability = 'employs_people' and oc.status = 'active'
    )
$function$;

-- public.get_my_account_ownership
CREATE OR REPLACE FUNCTION public.get_my_account_ownership()
 RETURNS TABLE(account_type text, origin_employer_name text, personal_ownership_claimed_at timestamp with time zone, active_employer_names text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    paa.account_type,
    oe.name as origin_employer_name,
    (
      select min(val.verified_at)
      from public.verified_account_links val
      where val.status = 'active'
        and (val.auth_account_a_id = auth.uid() or val.auth_account_b_id = auth.uid())
    ) as personal_ownership_claimed_at,
    coalesce(
      (select array_agg(distinct ae.name order by ae.name)
       from public.employer_members em
       join public.organisations ae on ae.id = em.employer_id
       where em.user_id = auth.uid() and em.status = 'active'),
      '{}'::text[]
    ) as active_employer_names
  from public.person_auth_accounts paa
  left join public.organisations oe on oe.id = paa.employer_id
  where paa.auth_user_id = auth.uid();
$function$;

-- public.get_public_employer_catalogue_courses (employs_people rule restored)
CREATE OR REPLACE FUNCTION public.get_public_employer_catalogue_courses(p_slug text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(private.employer_catalogue_courses_json(employer.id, null, true), '[]'::jsonb)
  from public.organisations employer
  join public.organisations organisation on organisation.id = employer.id
  where organisation.slug = p_slug
    and organisation.status = 'active'
    and organisation.public_profile_enabled = true
    and exists (
      select 1 from public.organisation_capabilities oc
      where oc.organisation_id = employer.id and oc.capability = 'employs_people' and oc.status = 'active'
    )
$function$;

-- public.list_manager_suggestible_skills
CREATE OR REPLACE FUNCTION public.list_manager_suggestible_skills(p_employer_id uuid, p_employee_member_id uuid)
 RETURNS TABLE(id uuid, name text, category text, description text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.can_manage_employer_member(
    auth.uid(), p_employee_member_id, 'skill_management', true
  ) or not exists (
    select 1 from public.employer_members member
    where member.id = p_employee_member_id
      and member.employer_id = p_employer_id
      and member.status = 'active'
  ) then
    raise exception 'Not authorised';
  end if;

  return query
  select library_skill.id, library_skill.name, library_skill.category,
    library_skill.description
  from public.organisations employer
  join public.organisation_offered_skills offered_skill
    on offered_skill.organisation_id = employer.id
  join public.skill_library library_skill
    on library_skill.id = offered_skill.skill_library_id
  where employer.id = p_employer_id
  order by library_skill.name, library_skill.id;
end
$function$;

-- public.list_my_employer_management_contexts
CREATE OR REPLACE FUNCTION public.list_my_employer_management_contexts()
 RETURNS TABLE(employer_id uuid, employer_name text, employer_slug text, manager_member_id uuid, direct_report_count bigint, indirect_report_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    employer.id,
    employer.name,
    organisation.slug,
    manager_member.id,
    count(*) filter (where report.report_depth = 1),
    count(*) filter (where report.report_depth > 1)
  from public.employer_members manager_member
  join public.organisations employer
    on employer.id = manager_member.employer_id
  join public.organisations organisation
    on organisation.id = employer.id
  cross join lateral public.list_manageable_employer_members(employer.id) report
  where manager_member.user_id = auth.uid()
    and manager_member.status = 'active'
  group by employer.id, employer.name, organisation.slug, manager_member.id
  order by employer.name, employer.id
$function$;

-- public.list_my_employer_skill_development_targets
CREATE OR REPLACE FUNCTION public.list_my_employer_skill_development_targets()
 RETURNS TABLE(id uuid, employer_id uuid, employer_name text, employer_member_id uuid, skill_library_id uuid, skill_name text, target_level smallint, target_date date, notes text, status text, created_at timestamp with time zone, closed_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select target.id, target.employer_id, employer.name,
    target.employer_member_id, target.skill_library_id, library_skill.name,
    target.target_level, target.target_date, target.notes, target.status,
    target.created_at, target.closed_at
  from public.employer_skill_development_targets target
  join public.employer_members member
    on member.id = target.employer_member_id
   and member.employer_id = target.employer_id
  join public.organisations employer on employer.id = target.employer_id
  join public.skill_library library_skill on library_skill.id = target.skill_library_id
  where member.user_id = auth.uid()
  order by (target.status = 'active') desc, target.target_date, target.created_at desc, target.id
$function$;

-- public.prevent_employer_admin_provider_removal
CREATE OR REPLACE FUNCTION public.prevent_employer_admin_provider_removal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if exists (select 1 from auth.users where id = old.user_id)
    and exists (
      select 1
      from employer_members em
      join organisations e on e.id = em.employer_id
      where em.user_id = old.user_id
        and em.role = 'admin'
        and em.status = 'active'
        and e.id = old.organisation_id
    )
  then
    raise exception 'This access is automatic while they are an admin of the linked employer. Remove their employer admin role instead.';
  end if;
  return old;
end;
$function$;

-- public.set_managed_employer_skill_development_target
CREATE OR REPLACE FUNCTION public.set_managed_employer_skill_development_target(p_employer_id uuid, p_employee_member_id uuid, p_skill_library_id uuid, p_target_level integer, p_target_date date, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_previous_id uuid;
  v_target_id uuid;
begin
  if not private.can_manage_employer_member(
    auth.uid(), p_employee_member_id, 'skill_management', true
  ) or not exists (
    select 1
    from public.employer_members member
    where member.id = p_employee_member_id
      and member.employer_id = p_employer_id
      and member.status = 'active'
  ) then
    raise exception 'Not authorised';
  end if;

  if p_target_level is null or p_target_level < 1 or p_target_level > 5 then
    raise exception 'Target level must be between 1 and 5';
  end if;

  if p_target_date is null or p_target_date < current_date then
    raise exception 'Target date cannot be in the past';
  end if;

  if not exists (
    select 1
    from public.organisations employer
    join public.organisation_offered_skills offered_skill
      on offered_skill.organisation_id = employer.id
    where employer.id = p_employer_id
      and offered_skill.skill_library_id = p_skill_library_id
  ) then
    raise exception 'This skill is not offered by this employer';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_employer_id::text || ':' || p_employee_member_id::text || ':' || p_skill_library_id::text,
      0
    )
  );

  select target.id into v_previous_id
  from public.employer_skill_development_targets target
  where target.employer_id = p_employer_id
    and target.employer_member_id = p_employee_member_id
    and target.skill_library_id = p_skill_library_id
    and target.status = 'active'
  for update;

  if v_previous_id is not null then
    update public.employer_skill_development_targets
    set status = 'superseded', closed_by = auth.uid(), closed_at = now()
    where id = v_previous_id;
  end if;

  insert into public.employer_skill_development_targets (
    employer_id, employer_member_id, skill_library_id, target_level,
    target_date, notes, replaces_target_id, created_by
  ) values (
    p_employer_id, p_employee_member_id, p_skill_library_id, p_target_level,
    p_target_date, nullif(trim(p_notes), ''), v_previous_id, auth.uid()
  )
  returning id into v_target_id;

  return v_target_id;
end
$function$;

-- public.suggest_skill_to_managed_employer_member
CREATE OR REPLACE FUNCTION public.suggest_skill_to_managed_employer_member(p_employer_id uuid, p_employee_member_id uuid, p_skill_library_id uuid, p_target_level integer DEFAULT NULL::integer, p_target_date date DEFAULT NULL::date, p_comments text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_employee_user_id uuid;
  v_skill_name text;
  v_suggestion_id uuid;
begin
  select member.user_id into v_employee_user_id
  from public.employer_members member
  where member.id = p_employee_member_id
    and member.employer_id = p_employer_id
    and member.status = 'active';

  if v_employee_user_id is null or not private.can_manage_employer_member(
    auth.uid(), p_employee_member_id, 'skill_management', true
  ) then
    raise exception 'Not authorised';
  end if;

  if p_target_level is not null and (p_target_level < 1 or p_target_level > 5) then
    raise exception 'Target level must be between 1 and 5';
  end if;

  select library_skill.name into v_skill_name
  from public.organisations employer
  join public.organisation_offered_skills offered_skill
    on offered_skill.organisation_id = employer.id
  join public.skill_library library_skill
    on library_skill.id = offered_skill.skill_library_id
  where employer.id = p_employer_id
    and library_skill.id = p_skill_library_id;

  if v_skill_name is null then
    raise exception 'This skill is not offered by this employer';
  end if;

  insert into public.employer_skill_suggestions
    (employer_id, learner_id, skill_library_id, skill_name,
     suggested_target_level, target_date, comments, assigned_by)
  values
    (p_employer_id, v_employee_user_id, p_skill_library_id, v_skill_name,
     p_target_level, p_target_date, nullif(trim(p_comments), ''), auth.uid())
  on conflict (employer_id, learner_id, skill_library_id) do update
    set status = 'suggested',
        suggested_target_level = excluded.suggested_target_level,
        target_date = excluded.target_date,
        comments = excluded.comments,
        assigned_by = excluded.assigned_by,
        created_at = now()
    where public.employer_skill_suggestions.status = 'dismissed'
  returning id into v_suggestion_id;

  if v_suggestion_id is null then
    raise exception 'This skill is already suggested or adopted';
  end if;

  return v_suggestion_id;
end
$function$;
