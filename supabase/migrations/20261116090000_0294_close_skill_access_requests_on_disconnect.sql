-- A "please share your skills" request (request_type 'skill_access', see
-- 20260907200000) only makes sense between connected people. When the two
-- disconnect (0293, or an account deletion), a request still waiting between
-- them is closed rather than left in the recipient's pending actions.
--
-- 'closed' is a new status, kept apart from 'declined' so the record doesn't
-- claim the recipient turned it down; decided_at records when. Nothing lists
-- requests other than pending ones, and respond_to_connection_request only
-- answers pending ones, so a closed request can't be accepted later. Staging
-- had no such requests waiting when this was written.
alter table public.connection_requests
  drop constraint connection_requests_status_check,
  add constraint connection_requests_status_check
    check (status in ('pending', 'accepted', 'declined', 'closed'));

create or replace function public.close_skill_access_requests_on_disconnect()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.connection_requests
  set status = 'closed', decided_at = now()
  where status = 'pending'
    and request_type = 'skill_access'
    and (
      (requester_id = old.user_a_id and recipient_id = old.user_b_id)
      or (requester_id = old.user_b_id and recipient_id = old.user_a_id)
    );
  return old;
end;
$$;

revoke all on function public.close_skill_access_requests_on_disconnect() from public, anon, authenticated;

create trigger connections_close_skill_access_requests
  after delete on public.connections
  for each row execute function public.close_skill_access_requests_on_disconnect();
