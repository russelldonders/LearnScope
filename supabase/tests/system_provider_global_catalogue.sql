begin;

do $$
declare
  v_system_id uuid;
  v_global_owner_id uuid;
begin
  select id into v_system_id
  from public.organisations
  where org_code = 'ORG-00001' and is_system;

  if v_system_id is null then
    raise exception 'ORG-00001 was not marked as the system provider';
  end if;

  select organisation_id into v_global_owner_id
  from public.catalogues
  where is_global;

  if v_global_owner_id is distinct from v_system_id then
    raise exception 'Global catalogue is not owned by ORG-00001';
  end if;

  begin
    update public.organisations set status = 'inactive' where id = v_system_id;
    raise exception 'System provider was allowed to become inactive';
  exception
    when raise_exception then
      if sqlerrm not like '%system provider identity%' then raise; end if;
  end;

  begin
    delete from public.organisations where id = v_system_id;
    raise exception 'System provider was allowed to be deleted';
  exception
    when raise_exception then
      if sqlerrm not like '%system provider cannot be deleted%' then raise; end if;
  end;

  begin
    delete from public.catalogues where is_global;
    raise exception 'Global catalogue was allowed to be deleted';
  exception
    when raise_exception then
      if sqlerrm not like '%Global catalogue cannot be deleted%' then raise; end if;
  end;
end
$$;

rollback;
