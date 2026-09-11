-- Configuration only. No active launch state or credentials are exposed here.
create table public.lti_connections (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  code_number bigint generated always as identity,
  code text generated always as ('LMS-' || lpad(code_number::text, greatest(5,length(code_number::text)), '0')) stored unique,
  name text not null check (length(btrim(name)) between 1 and 200),
  issuer text not null,
  client_id text not null check (length(btrim(client_id)) between 1 and 500),
  deployment_ids text[] not null check (cardinality(deployment_ids) between 1 and 100),
  authorization_url text not null,
  jwks_url text not null,
  token_url text not null,
  status text not null default 'draft' check (status in ('draft','archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id, organisation_id),
  unique(organisation_id, issuer, client_id)
);
create index lti_connections_organisation_idx on public.lti_connections(organisation_id);
create table public.lti_skill_objects (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  skill_library_id uuid not null references public.skill_library(id),
  code_number bigint generated always as identity,
  code text generated always as ('LTI-' || lpad(code_number::text, greatest(5,length(code_number::text)), '0')) stored unique,
  title text not null check (length(btrim(title)) between 1 and 200),
  description text not null default '' check (length(description) <= 2000),
  target_level integer check (target_level between 1 and 5),
  grade_passback boolean not null default true,
  grade_source text not null default 'proficiency' check (grade_source = 'proficiency'),
  score_maximum integer not null default 5 check (score_maximum = 5),
  status text not null default 'draft' check (status in ('draft','archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id, organisation_id)
);
create index lti_skill_objects_skill_idx on public.lti_skill_objects(skill_library_id);
create index lti_skill_objects_organisation_skill_idx on public.lti_skill_objects(organisation_id,skill_library_id);
create table public.lti_object_connections (
  object_id uuid not null,
  connection_id uuid not null,
  organisation_id uuid not null references public.organisations(id),
  primary key(object_id,connection_id),
  foreign key(object_id,organisation_id) references public.lti_skill_objects(id,organisation_id) on delete cascade,
  foreign key(connection_id,organisation_id) references public.lti_connections(id,organisation_id)
);
create index lti_object_connections_connection_idx on public.lti_object_connections(connection_id,organisation_id);
create index lti_object_connections_organisation_idx on public.lti_object_connections(organisation_id);

alter table public.lti_connections enable row level security;
alter table public.lti_skill_objects enable row level security;
alter table public.lti_object_connections enable row level security;
revoke all on public.lti_connections,public.lti_skill_objects,public.lti_object_connections from anon,authenticated;
grant select on public.lti_connections,public.lti_skill_objects,public.lti_object_connections to authenticated;
create policy "Provider staff view LTI connections" on public.lti_connections for select to authenticated using(public.is_org_member(organisation_id,(select auth.uid())));
create policy "Provider staff view LTI objects" on public.lti_skill_objects for select to authenticated using(public.is_org_member(organisation_id,(select auth.uid())));
create policy "Provider staff view LTI object connections" on public.lti_object_connections for select to authenticated using(public.is_org_member(organisation_id,(select auth.uid())));

create or replace function public.save_lti_connection(p_organisation_id uuid,p_id uuid,p_config jsonb)
returns public.lti_connections language plpgsql security definer set search_path = '' as $$
declare v_row public.lti_connections%rowtype; v_deployments text[]; v_url text;
begin
  if auth.uid() is null or not public.is_org_admin(p_organisation_id,auth.uid()) then raise exception 'Only an organisation admin can configure LMS connections.'; end if;
  if jsonb_typeof(p_config) is distinct from 'object' then raise exception 'Invalid configuration'; end if;
  foreach v_url in array array[p_config->>'issuer',p_config->>'authorization_url',p_config->>'jwks_url',p_config->>'token_url'] loop
    if v_url is null or length(v_url)>2048 or v_url !~ '^https://[^/@?#[:space:]]+([/?][^#[:space:]]*)?$' then raise exception 'Use HTTPS URLs without credentials or fragments.'; end if;
  end loop;
  if p_config->>'issuer' ~ '[?#]' then raise exception 'Issuer must not contain a query or fragment.'; end if;
  if jsonb_typeof(p_config->'deployment_ids') is distinct from 'array' then raise exception 'At least one deployment ID is required.'; end if;
  if exists(select 1 from jsonb_array_elements(p_config->'deployment_ids') d where jsonb_typeof(d) <> 'string') then raise exception 'Deployment IDs must be text.'; end if;
  select array_agg(distinct btrim(d)) into v_deployments from jsonb_array_elements_text(p_config->'deployment_ids') d;
  if v_deployments is null or exists(select 1 from unnest(v_deployments) d where d is null or length(d) not between 1 and 500) then raise exception 'Deployment IDs must not be blank.'; end if;
  if p_id is not null then
    select * into v_row from public.lti_connections where id=p_id and organisation_id=p_organisation_id for update;
    if not found then raise exception 'Connection not found'; end if;
    update public.lti_connections set name=btrim(p_config->>'name'),issuer=p_config->>'issuer',client_id=btrim(p_config->>'client_id'), deployment_ids=v_deployments,
      authorization_url=p_config->>'authorization_url',jwks_url=p_config->>'jwks_url',token_url=p_config->>'token_url',status=coalesce(p_config->>'status','draft'),updated_at=now()
      where id=p_id returning * into v_row;
  else
    insert into public.lti_connections(organisation_id,name,issuer,client_id,deployment_ids,authorization_url,jwks_url,token_url,created_by)
    values(p_organisation_id,btrim(p_config->>'name'),p_config->>'issuer',btrim(p_config->>'client_id'),v_deployments,p_config->>'authorization_url',p_config->>'jwks_url',p_config->>'token_url',auth.uid()) returning * into v_row;
  end if;
  return v_row;
end;
$$;
revoke all on function public.save_lti_connection(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_lti_connection(uuid,uuid,jsonb) to authenticated;

create or replace function public.save_lti_skill_object(p_organisation_id uuid,p_skill_id uuid,p_id uuid,p_config jsonb,p_connection_ids uuid[])
returns public.lti_skill_objects language plpgsql security definer set search_path = '' as $$
declare v_row public.lti_skill_objects%rowtype;
begin
  if auth.uid() is null or not public.is_org_admin(p_organisation_id,auth.uid()) then raise exception 'Only an organisation admin can configure LTI objects.'; end if;
  if jsonb_typeof(p_config) is distinct from 'object' then raise exception 'Invalid configuration'; end if;
  if not exists(select 1 from public.organisation_offered_skills where organisation_id=p_organisation_id and skill_library_id=p_skill_id) then raise exception 'This skill is not offered by your organisation.'; end if;
  if p_connection_ids is null or array_position(p_connection_ids,null) is not null then raise exception 'Invalid LMS selection'; end if;
  -- Lock selected connections while validating the complete set; reject cross-org IDs.
  perform 1 from public.lti_connections where id=any(p_connection_ids) for share;
  if exists(select 1 from unnest(p_connection_ids) cid where not exists(select 1 from public.lti_connections where id=cid and organisation_id=p_organisation_id and status='draft')) then raise exception 'Choose an available LMS connection from this organisation.'; end if;
  if p_id is not null then
    select * into v_row from public.lti_skill_objects where id=p_id and organisation_id=p_organisation_id and skill_library_id=p_skill_id for update;
    if not found then raise exception 'LTI object not found'; end if;
    update public.lti_skill_objects set title=btrim(p_config->>'title'),description=coalesce(p_config->>'description',''),target_level=(p_config->>'target_level')::integer,
      grade_passback=coalesce((p_config->>'grade_passback')::boolean,true),status=coalesce(p_config->>'status','draft'),updated_at=now() where id=p_id returning * into v_row;
  else
    insert into public.lti_skill_objects(organisation_id,skill_library_id,title,description,target_level,grade_passback,created_by)
    values(p_organisation_id,p_skill_id,btrim(p_config->>'title'),coalesce(p_config->>'description',''),(p_config->>'target_level')::integer,coalesce((p_config->>'grade_passback')::boolean,true),auth.uid()) returning * into v_row;
  end if;
  delete from public.lti_object_connections where object_id=v_row.id;
  insert into public.lti_object_connections(object_id,connection_id,organisation_id) select distinct v_row.id,cid,p_organisation_id from unnest(p_connection_ids) cid;
  return v_row;
end;
$$;
revoke all on function public.save_lti_skill_object(uuid,uuid,uuid,jsonb,uuid[]) from public,anon,authenticated;
grant execute on function public.save_lti_skill_object(uuid,uuid,uuid,jsonb,uuid[]) to authenticated;
