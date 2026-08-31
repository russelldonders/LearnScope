-- Replace free-text duration entry with a queryable number and fixed unit.
-- Keep the old text column as a legacy fallback so any duration entered
-- between the preceding deployment and this one is not discarded.

alter table public.experience
  add column study_duration_value integer,
  add column study_duration_unit text;

update public.experience e
set study_duration_value = parsed.duration_value,
    study_duration_unit = parsed.duration_unit,
    study_duration = null
from (
  select id,
         parts[1]::integer as duration_value,
         case
           when lower(parts[2]) like 'day%' then 'days'
           when lower(parts[2]) like 'month%' then 'months'
           else 'years'
         end as duration_unit
  from public.experience
  cross join lateral regexp_match(study_duration, '^\s*([0-9]+)\s*(day|days|month|months|year|years)\s*$', 'i') as parsed_match(parts)
  where type = 'subject'
) parsed
where e.id = parsed.id;

alter table public.experience drop constraint experience_subject_timing_check;

alter table public.experience
  add constraint experience_subject_timing_check check (
    (
      type = 'subject'
      and (
        start_date is not null
        or (study_duration_value is not null and study_duration_unit is not null)
        or length(trim(study_duration)) > 0
      )
      and (end_date is null or start_date is not null)
      and (study_duration_value is null or study_duration_value > 0)
      and (study_duration_unit is null or study_duration_unit in ('days', 'months', 'years'))
      and ((study_duration_value is null) = (study_duration_unit is null))
    )
    or (
      type <> 'subject'
      and start_date is not null
      and study_duration is null
      and study_duration_value is null
      and study_duration_unit is null
    )
  );

-- Institution details are owned by the parent education row. Copy them on
-- every subject write so direct API calls cannot create conflicting values.
create or replace function public.validate_experience_parent_type()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  parent_type text;
  parent_user_id uuid;
  parent_organization text;
  parent_organization_url text;
begin
  if new.parent_experience_id is null then
    if new.type = 'subject' then
      raise exception 'A subject must belong to an education experience';
    end if;
    return new;
  end if;

  if new.parent_experience_id = new.id then
    raise exception 'An experience cannot be its own parent';
  end if;

  select type, user_id, organization, organization_url
    into parent_type, parent_user_id, parent_organization, parent_organization_url
  from public.experience
  where id = new.parent_experience_id;

  if not found then raise exception 'Parent experience not found'; end if;
  if parent_user_id <> new.user_id then raise exception 'Parent and child experiences must belong to the same user'; end if;
  if parent_type = 'education' and new.type <> 'subject' then raise exception 'Education experiences can only contain subjects'; end if;
  if new.type = 'subject' and parent_type <> 'education' then raise exception 'Subjects can only belong to education experiences'; end if;
  if parent_type in ('employment', 'volunteer') and new.type not in ('project', 'course', 'other') then raise exception 'This experience type cannot be added to a job or volunteer position'; end if;
  if parent_type not in ('education', 'employment', 'volunteer') then raise exception 'This experience type cannot contain sub-experiences'; end if;

  if new.type = 'subject' then
    new.organization := parent_organization;
    new.organization_url := parent_organization_url;
  end if;

  return new;
end;
$$;

drop trigger validate_experience_parent_type_before_write on public.experience;
create trigger validate_experience_parent_type_before_write
before insert or update of type, parent_experience_id, user_id, organization, organization_url
on public.experience
for each row execute function public.validate_experience_parent_type();

create or replace function public.sync_subject_organization_from_parent()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.type = 'education'
     and (new.organization is distinct from old.organization
          or new.organization_url is distinct from old.organization_url) then
    update public.experience
    set organization = new.organization,
        organization_url = new.organization_url
    where parent_experience_id = new.id
      and type = 'subject';
  end if;

  return new;
end;
$$;

revoke all on function public.sync_subject_organization_from_parent() from public;

create trigger sync_subject_organization_after_parent_update
after update of organization, organization_url
on public.experience
for each row execute function public.sync_subject_organization_from_parent();
