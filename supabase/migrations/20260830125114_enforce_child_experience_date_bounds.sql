-- Keep nested experiences within their parent's period at the database
-- boundary, including writes made outside the web client.

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
  parent_start_date date;
  parent_end_date date;
begin
  if new.parent_experience_id is null then
    if new.type = 'subject' then
      raise exception 'A subject must belong to an education experience';
    end if;

    if tg_op = 'UPDATE'
       and (new.start_date is distinct from old.start_date
            or new.end_date is distinct from old.end_date)
       and exists (
         select 1
         from public.experience child
         where child.parent_experience_id = new.id
           and (
             child.start_date < new.start_date
             or child.end_date < new.start_date
             or (new.end_date is not null and child.start_date > new.end_date)
             or (new.end_date is not null and child.end_date > new.end_date)
           )
       ) then
      raise exception 'Parent dates cannot exclude an existing sub-experience';
    end if;

    return new;
  end if;

  if new.parent_experience_id = new.id then
    raise exception 'An experience cannot be its own parent';
  end if;

  select type, user_id, organization, organization_url, start_date, end_date
    into parent_type, parent_user_id, parent_organization, parent_organization_url,
         parent_start_date, parent_end_date
  from public.experience
  where id = new.parent_experience_id;

  if not found then raise exception 'Parent experience not found'; end if;
  if parent_user_id <> new.user_id then raise exception 'Parent and child experiences must belong to the same user'; end if;
  if parent_type = 'education' and new.type <> 'subject' then raise exception 'Education experiences can only contain subjects'; end if;
  if new.type = 'subject' and parent_type <> 'education' then raise exception 'Subjects can only belong to education experiences'; end if;
  if parent_type in ('employment', 'volunteer') and new.type not in ('project', 'course', 'other') then raise exception 'This experience type cannot be added to a job or volunteer position'; end if;
  if parent_type not in ('education', 'employment', 'volunteer') then raise exception 'This experience type cannot contain sub-experiences'; end if;

  if new.start_date < parent_start_date or new.end_date < parent_start_date then
    raise exception 'Sub-experience dates cannot be before the parent start date';
  end if;
  if parent_end_date is not null
     and (new.start_date > parent_end_date or new.end_date > parent_end_date) then
    raise exception 'Sub-experience dates cannot be after the parent end date';
  end if;
  if new.start_date is not null and new.end_date < new.start_date then
    raise exception 'Sub-experience end date cannot be before its start date';
  end if;

  if new.type = 'subject' then
    new.organization := parent_organization;
    new.organization_url := parent_organization_url;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_experience_parent_type() from public;

drop trigger validate_experience_parent_type_before_write on public.experience;
create trigger validate_experience_parent_type_before_write
before insert or update of type, parent_experience_id, user_id, organization,
  organization_url, start_date, end_date
on public.experience
for each row execute function public.validate_experience_parent_type();
