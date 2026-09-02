-- Tags never got the admin-facing reference code every other shared
-- object has (ORG-00001/SKL-00001/CRS-00001/USR-00001/RES-00001/
-- EMP-00001, all via 0113_unique_reference_codes.sql and its later
-- extensions) -- AdminTags.jsx's "ID" column falls back to a raw UUID
-- slice instead. Mirrors 0113's set_organisation_code shape exactly:
-- one new sequence, a generate_*_code() function, a before-insert
-- trigger that only sets it if null, and a one-time backfill.

create sequence tag_code_seq;

create or replace function generate_tag_code()
returns text
language sql
as $$
  select 'TAG-' || lpad(nextval('tag_code_seq')::text, 5, '0')
$$;

alter table tags add column tag_code text;

create or replace function set_tag_code()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.tag_code is null then
    new.tag_code := generate_tag_code();
  end if;
  return new;
end;
$$;

create trigger set_tag_code_trigger
  before insert on tags
  for each row execute procedure set_tag_code();

update tags set tag_code = generate_tag_code() where tag_code is null;

alter table tags alter column tag_code set not null;

create unique index tags_tag_code_unique_idx on tags (tag_code);
