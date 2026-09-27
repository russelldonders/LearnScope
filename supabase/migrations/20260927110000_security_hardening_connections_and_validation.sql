-- Security hardening from the 2026-09-27 review. No schema or data changes;
-- only who may call/update what.

-- 1. upsert_connection (0058) is SECURITY DEFINER with no caller check, and
-- Postgres grants EXECUTE to PUBLIC by default -- so any signed-in (or even
-- anonymous) caller could connect any two users without consent. Its only
-- legitimate callers are other SECURITY DEFINER functions owned by postgres
-- (respond_to_connection_request, sync_connection_from_peer_rating), which
-- keep EXECUTE as owner, so revoking direct access breaks nothing.
revoke execute on function public.upsert_connection(uuid, uuid, text) from public, anon, authenticated;

-- 2. The validator UPDATE policy (0041) only checked validator_id, so while a
-- request was pending a validator could repoint skill_id/requester_id at
-- another learner's skill -- gaining read access to it and its evidence, and
-- then overwriting its level via decide_validation_request. The app never
-- updates this table directly: decisions go through decide_validation_request
-- (SECURITY DEFINER, checks the caller is the validator and the request is
-- pending), so the direct UPDATE path is simply removed.
drop policy "Validators can decide on requests addressed to them" on public.skill_validation_requests;

-- 3. Evidence files are stored at {owner_user_id}/{skill_id}/..., but the
-- validator read policy only matched the skill folder. Also require the owner
-- folder to be the request's requester, so access is pinned to the actual
-- learner whose skill is being validated.
drop policy "Validators can view evidence files for skills they're validating" on storage.objects;

create policy "Validators can view evidence files for skills they're validating"
  on storage.objects for select
  using (
    bucket_id = 'skill-evidence'
    and exists (
      select 1 from public.skill_validation_requests svr
      where svr.validator_id = auth.uid()
        and svr.skill_id::text = (storage.foldername(name))[2]
        and svr.requester_id::text = (storage.foldername(name))[1]
    )
  );
