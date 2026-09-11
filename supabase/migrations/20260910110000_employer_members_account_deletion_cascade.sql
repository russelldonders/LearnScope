-- Fixes admin deleteUser failing with an FK violation for any user who was
-- ever added as an employer member. 0064_account_deletion_cascades.sql gave
-- every FK to auth.users(id) that existed at the time an explicit ON DELETE
-- action so auth.admin.deleteUser() wouldn't be blocked -- employers/
-- employer_members (20260902090000) were added after that migration and
-- were missed, so their user_id/created_by/invited_by columns still have no
-- ON DELETE action (the default NO ACTION), which is exactly what
-- api/admin/actions.js's deleteUser handler already documents as a known
-- gap. Same two categories 0064 used:
--   - employer_members.user_id: CASCADE. A membership row has no meaning
--     once the member no longer exists (mirrors organisation_members.user_id
--     on delete cascade, 0065).
--   - employers.created_by / employer_members.invited_by: SET NULL
--     (already nullable). Pure attribution -- the employer/membership itself
--     stays meaningful without it, same treatment as tags.created_by and
--     skill_library.created_by in 0064.

alter table employer_members drop constraint employer_members_user_id_fkey,
  add constraint employer_members_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table employer_members drop constraint employer_members_invited_by_fkey,
  add constraint employer_members_invited_by_fkey foreign key (invited_by) references auth.users(id) on delete set null;

alter table employers drop constraint employers_created_by_fkey,
  add constraint employers_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
