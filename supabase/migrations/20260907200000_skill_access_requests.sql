-- "Request skill access" (item 5): lets a learner ask an existing
-- connection who hasn't shared any skills to consider sharing some, with a
-- short note attached.
--
-- Deliberately reuses connection_requests (0058/0060) rather than a new
-- table -- a targeted request with an optional message and a
-- pending/accepted/declined lifecycle is the same shape already used for
-- "wants to connect" requests, just distinguished by request_type. This
-- also means the existing pending-actions badge count and
-- respond_to_connection_request RPC cover it for free.
--
-- Accepting a skill_access request must NOT create/refresh a `connections`
-- row the way accepting a 'connect' request does -- the two people are
-- already connected (that's a precondition of sending one, enforced by the
-- insert policy below), and LearnScope has no per-connection skill-sharing
-- scope today (see docs in ProfilePrivacy.jsx) -- sharing stays a manual,
-- global, per-skill decision the recipient makes themselves. Accepting here
-- only means "acknowledged"; the actual sharing happens separately via the
-- existing visible_on_profile / skills_profile_visible toggles.
alter table connection_requests
  add column request_type text not null default 'connect'
  check (request_type in ('connect', 'skill_access'));

drop policy "Users can send a connection request" on connection_requests;
create policy "Users can send a connection or skill-access request"
  on connection_requests for insert
  with check (
    auth.uid() = requester_id and status = 'pending'
    and (
      request_type = 'connect'
      or (request_type = 'skill_access' and is_connected(requester_id, recipient_id))
    )
  );

create or replace function respond_to_connection_request(p_request_id uuid, p_accept boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_request connection_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_request from connection_requests where id = p_request_id for update;
  if not found then
    raise exception 'Request not found';
  end if;
  if v_request.recipient_id <> auth.uid() then
    raise exception 'Not authorized to respond to this request';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This request has already been decided.';
  end if;

  update connection_requests
  set status = case when p_accept then 'accepted' else 'declined' end,
      decided_at = now()
  where id = p_request_id;

  if p_accept and v_request.request_type = 'connect' then
    perform upsert_connection(v_request.requester_id, v_request.recipient_id, 'request');
  end if;
end;
$$;
