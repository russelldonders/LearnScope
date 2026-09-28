\set ON_ERROR_STOP on

begin;

do $$
begin
  if to_regclass('public.employers') is not null then
    raise exception 'the employers compatibility relation still exists';
  end if;

  if to_regprocedure('public.create_employer(text)') is not null then
    raise exception 'the create_employer compatibility function still exists';
  end if;

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
    raise exception 'a stored routine still reads the employers compatibility relation';
  end if;
end;
$$;

rollback;
