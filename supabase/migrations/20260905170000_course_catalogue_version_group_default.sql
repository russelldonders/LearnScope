-- course_catalogue.version_group_id (0107) was made not-null but never got
-- an insert-time default -- every existing row was backfilled at the time
-- (version_group_id = id), but createProviderCourse/createPlatformCourse
-- (src/lib/admin/catalogue.js) never set it themselves, so creating a new
-- course fails with "null value in column version_group_id violates
-- not-null constraint". content_resources hit the identical gap during its
-- own versioning migration (20260831130759) and fixed it with a BEFORE
-- INSERT trigger defaulting version_group_id to the row's own id -- this
-- mirrors that.
create or replace function initialise_course_version_group()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.version_group_id := coalesce(new.version_group_id, new.id);
  return new;
end;
$$;

create trigger initialise_course_version_group_trigger
  before insert on course_catalogue
  for each row execute procedure initialise_course_version_group();
