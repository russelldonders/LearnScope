-- Support the new "Find skill" / "Create skill" split: searching the shared
-- library now only surfaces public entries plus the searcher's own private
-- ones. Defaults to public (false) so every existing library entry stays
-- visible exactly as before.
alter table skill_library add column is_private boolean not null default false;

drop policy "Authenticated users can view the skill library" on skill_library;

create policy "Authenticated users can view public or their own private skill library entries"
  on skill_library for select
  to authenticated
  using (not is_private or created_by = auth.uid());

-- The old global unique-on-name index doesn't work once private entries
-- exist: a private entry invisible to everyone else would silently block
-- any other user from ever creating a public (or their own private) entry
-- with that same name, with no way for them to see why. Split it: public
-- names stay globally unique (that's the whole point of the shared
-- catalog); private names only need to be unique per creator.
drop index skill_library_name_lower_idx;

create unique index skill_library_public_name_lower_idx
  on skill_library (lower(name))
  where not is_private;

create unique index skill_library_private_name_lower_idx
  on skill_library (created_by, lower(name))
  where is_private;
