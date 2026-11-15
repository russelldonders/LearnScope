-- Lets a learner end a connection themselves. Until now a connection only
-- ended when an account was deleted.
--
-- Removing the connections row is all it takes: everything shared by virtue
-- of being connected checks is_connected() live (visible skills, activity,
-- profile details, rating each other's skills, resources shared with all or
-- chosen contacts), and the trigger from 0292 drops each person from the
-- other's chosen contacts. What happened while connected stays as it was:
-- ratings already given, team memberships (inviting someone needs a
-- connection, staying in a team doesn't) and history are untouched. Either
-- person can connect again later with a new request; a peer rating through a
-- share link also reconnects, as before (0058).
create or replace function public.disconnect_connection(p_other_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null then
    raise insufficient_privilege using message = 'Sign in to manage your connections';
  end if;
  if p_other_user_id is null or p_other_user_id = v_caller then
    raise exception 'Choose a connection to disconnect from';
  end if;

  delete from public.connections
  where user_a_id = least(v_caller, p_other_user_id)
    and user_b_id = greatest(v_caller, p_other_user_id);

  if not found then
    raise exception 'You are not connected to this person';
  end if;
end;
$$;

revoke all on function public.disconnect_connection(uuid) from public, anon;
grant execute on function public.disconnect_connection(uuid) to authenticated;
