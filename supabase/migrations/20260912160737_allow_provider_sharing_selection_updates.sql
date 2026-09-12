-- Keep an accepted selection live while a later change waits for the other
-- organisation. Initial requests continue to use sharing/status=pending;
-- accepted links use these columns only for an unapproved delta.
alter table public.employer_linked_providers
  add column pending_sharing jsonb,
  add column pending_initiated_by text check (pending_initiated_by in ('employer', 'provider')),
  add column pending_requested_at timestamptz,
  add constraint employer_linked_providers_pending_selection_complete check (
    (pending_sharing is null and pending_initiated_by is null and pending_requested_at is null)
    or (pending_sharing is not null and pending_initiated_by is not null and pending_requested_at is not null)
  );

create or replace function private.guard_employer_provider_sharing()
returns trigger language plpgsql security definer set search_path = '' as $$
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
      not exists(select 1 from public.employers where id=old.employer_id)
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
  if exists(select 1 from public.employers e where e.id=v.employer_id and e.provider_organisation_id=v.provider_organisation_id) then
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
end $$;
