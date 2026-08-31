-- Prefixed sequential reference codes (CRS-00001, ORG-00001, USR-00001,
-- SKL-00001) for courses, providers, users and shared-library skills --
-- admin-facing identifiers for support/reference conversations, distinct
-- from organisations.slug (0090, learner/public-facing, used in URLs).
-- Follows the same auto-generate-on-insert-if-null + one-time-backfill
-- shape 0090 already established for slugs.

create sequence course_code_seq;
create sequence organisation_code_seq;
create sequence user_code_seq;
create sequence skill_code_seq;

create or replace function generate_course_code()
returns text
language sql
as $$
  select 'CRS-' || lpad(nextval('course_code_seq')::text, 5, '0')
$$;

create or replace function generate_organisation_code()
returns text
language sql
as $$
  select 'ORG-' || lpad(nextval('organisation_code_seq')::text, 5, '0')
$$;

create or replace function generate_user_code()
returns text
language sql
as $$
  select 'USR-' || lpad(nextval('user_code_seq')::text, 5, '0')
$$;

create or replace function generate_skill_code()
returns text
language sql
as $$
  select 'SKL-' || lpad(nextval('skill_code_seq')::text, 5, '0')
$$;

-- Courses -- course_code (0107) already exists as a plain nullable text
-- column with no generation or uniqueness. A course is versioned
-- (version_group_id/version_number, 0107): every version of the same
-- course shares one code (create_course_draft_version already copies it
-- forward), so uniqueness is enforced against each version_group's v1 row
-- only, not every row -- a plain unique index on the column would reject
-- v2+ rows carrying their v1's own code.
create or replace function set_course_code()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.course_code is null then
    new.course_code := generate_course_code();
  end if;
  return new;
end;
$$;

create trigger set_course_code_trigger
  before insert on course_catalogue
  for each row execute procedure set_course_code();

-- Backfill: one code per version_group, reusing an existing non-null code
-- already present anywhere in that group (defensive) before generating a
-- fresh one, then propagated to every row in the group.
do $$
declare
  r record;
  v_code text;
begin
  for r in
    select distinct version_group_id
    from course_catalogue
    where version_group_id in (
      select version_group_id from course_catalogue where course_code is null
    )
    order by version_group_id
  loop
    select course_code into v_code
    from course_catalogue
    where version_group_id = r.version_group_id and course_code is not null
    limit 1;

    if v_code is null then
      v_code := generate_course_code();
    end if;

    update course_catalogue
    set course_code = v_code
    where version_group_id = r.version_group_id and course_code is null;
  end loop;
end $$;

create unique index course_catalogue_code_unique_idx
  on course_catalogue (course_code)
  where version_number = 1;

-- Providers -- new admin-only reference code, alongside (not replacing)
-- the existing public-facing slug.
alter table organisations add column org_code text;

create or replace function set_organisation_code()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.org_code is null then
    new.org_code := generate_organisation_code();
  end if;
  return new;
end;
$$;

create trigger set_organisation_code_trigger
  before insert on organisations
  for each row execute procedure set_organisation_code();

update organisations set org_code = generate_organisation_code() where org_code is null;

alter table organisations alter column org_code set not null;
create unique index organisations_org_code_unique_idx on organisations (org_code);

-- Users
alter table profiles add column user_code text;

create or replace function set_user_code()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.user_code is null then
    new.user_code := generate_user_code();
  end if;
  return new;
end;
$$;

create trigger set_user_code_trigger
  before insert on profiles
  for each row execute procedure set_user_code();

update profiles set user_code = generate_user_code() where user_code is null;

alter table profiles alter column user_code set not null;
create unique index profiles_user_code_unique_idx on profiles (user_code);

-- Skills -- the shared skill_library catalogue only (personal per-user
-- tracked skills, the `skills` table, are a different concept and were
-- explicitly out of scope for this).
alter table skill_library add column skill_code text;

create or replace function set_skill_code()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.skill_code is null then
    new.skill_code := generate_skill_code();
  end if;
  return new;
end;
$$;

create trigger set_skill_code_trigger
  before insert on skill_library
  for each row execute procedure set_skill_code();

update skill_library set skill_code = generate_skill_code() where skill_code is null;

alter table skill_library alter column skill_code set not null;
create unique index skill_library_skill_code_unique_idx on skill_library (skill_code);
