-- The canonical organisation cutover kept a short-lived public.employers
-- projection so the already-deployed workforce routines could continue to
-- resolve their old relation name. Rewrite those stored routines against the
-- canonical table, then remove both compatibility entry points.

drop function if exists public.create_employer(text);

do $$
declare
  routine record;
  definition text;
begin
  for routine in
    select procedure.oid
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('public', 'private')
      and (
        procedure.prosrc like '%public.employers%'
        or procedure.prosrc like '%from employers%'
        or procedure.prosrc like '%join employers%'
      )
  loop
    definition := pg_catalog.pg_get_functiondef(routine.oid);
    definition := replace(definition, 'public.employers', 'public.organisations');
    definition := replace(definition, 'from employers', 'from organisations');
    definition := replace(definition, 'join employers', 'join organisations');
    definition := replace(definition, 'employer.provider_organisation_id', 'employer.id');
    definition := replace(definition, 'e.provider_organisation_id', 'e.id');
    definition := replace(definition, 'select provider_organisation_id into', 'select id into');
    execute definition;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('public', 'private')
      and (
        procedure.prosrc like '%public.employers%'
        or procedure.prosrc like '%from employers%'
        or procedure.prosrc like '%join employers%'
      )
  ) then
    raise exception 'Stored routines still reference the employers compatibility view';
  end if;
end;
$$;

revoke all on public.employers from public, anon, authenticated;
drop view public.employers;
