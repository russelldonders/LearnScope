-- Subjects are experience records nested beneath an Education experience.
-- Reusing the existing parent relationship means they automatically appear
-- in the education timeline and can carry their own dates, description and
-- linked skills without introducing a parallel content model.

alter table public.experience drop constraint experience_type_check;

alter table public.experience add constraint experience_type_check
  check (type in ('education', 'employment', 'project', 'volunteer', 'other', 'course', 'subject'));

create or replace function public.validate_experience_parent_type()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  parent_type text;
  parent_user_id uuid;
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

  select type, user_id
    into parent_type, parent_user_id
  from public.experience
  where id = new.parent_experience_id;

  if not found then
    raise exception 'Parent experience not found';
  end if;

  if parent_user_id <> new.user_id then
    raise exception 'Parent and child experiences must belong to the same user';
  end if;

  if parent_type = 'education' and new.type <> 'subject' then
    raise exception 'Education experiences can only contain subjects';
  end if;

  if new.type = 'subject' and parent_type <> 'education' then
    raise exception 'Subjects can only belong to education experiences';
  end if;

  if parent_type in ('employment', 'volunteer') and new.type not in ('project', 'course', 'other') then
    raise exception 'This experience type cannot be added to a job or volunteer position';
  end if;

  if parent_type not in ('education', 'employment', 'volunteer') then
    raise exception 'This experience type cannot contain sub-experiences';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_experience_parent_type() from public;

create trigger validate_experience_parent_type_before_write
before insert or update of type, parent_experience_id, user_id
on public.experience
for each row execute function public.validate_experience_parent_type();
