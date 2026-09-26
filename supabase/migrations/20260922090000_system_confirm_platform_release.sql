-- Machine-driven counterpart to confirm_platform_release (0913150000),
-- for the GitHub Action that bundles a platform release automatically on
-- every push to master (see .github/workflows/release-platform-version.yml).
-- confirm_platform_release itself stays human-only (it checks
-- is_platform_admin(auth.uid()), which is meaningless for an unattended
-- service-role caller -- auth.uid() is null outside a user JWT), so this is
-- a distinct function rather than a relaxed version of that one, scoped
-- entirely by GRANT: revoked from anon/authenticated, granted only to
-- service_role, which the Action authenticates as via each Supabase
-- project's service-role key (never exposed to the browser bundle).
--
-- Two shapes, matching how each environment's entries come to exist:
--   * p_entry_summaries omitted/null -- bundles this database's own
--     currently-pending entries into the new release (Staging's case: the
--     entries were already added there one at a time during development,
--     per CLAUDE.md's "Staging changelog discipline").
--   * p_entry_summaries given -- creates each summary as a new entry
--     already attached to the release (Production's case: Production never
--     accumulates a local pending backlog under this workflow, so its
--     entries for this version are born already-released, copied verbatim
--     from whatever Staging just bundled).
create or replace function public.system_confirm_platform_release(
  p_version integer,
  p_notes text default null,
  p_entry_summaries text[] default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release_id uuid;
begin
  insert into public.platform_releases (version, notes)
  values (p_version, p_notes)
  returning id into v_release_id;

  if p_entry_summaries is null or array_length(p_entry_summaries, 1) is null then
    update public.platform_changelog_entries
    set release_id = v_release_id
    where release_id is null;
  else
    insert into public.platform_changelog_entries (summary, release_id)
    select trim(summary), v_release_id
    from unnest(p_entry_summaries) as summary;
  end if;

  return v_release_id;
end
$$;

revoke all on function public.system_confirm_platform_release(integer, text, text[]) from public, anon, authenticated;
grant execute on function public.system_confirm_platform_release(integer, text, text[]) to service_role;
