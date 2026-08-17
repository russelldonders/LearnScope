-- auth.users.email is varchar(255), not text, so the function declared in
-- 0041 failed at call time with "structure of query does not match function
-- result type". Cast explicitly to match the declared return type.
create or replace function get_validation_request_contact(p_request_id uuid)
returns table (email text, full_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request skill_validation_requests%rowtype;
begin
  select * into v_request from skill_validation_requests where id = p_request_id;
  if not found then
    raise exception 'Request not found';
  end if;
  if v_request.requester_id != auth.uid() then
    raise exception 'Not authorized';
  end if;
  return query
    select u.email::text, p.full_name
    from auth.users u
    left join profiles p on p.id = u.id
    where u.id = v_request.validator_id;
end;
$$;
