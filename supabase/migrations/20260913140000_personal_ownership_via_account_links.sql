-- Supersedes 20260913130000's claim_personal_account_ownership()/
-- personal_ownership_claimed_at approach: that modelled "add personal
-- ownership" as swapping this same account's email/password, which turned
-- out not to match what "two real accounts, unified by a person" actually
-- means here. LearnScope already has a full, tested two-account link +
-- consented transfer flow (verified_account_links/profile_transfer_plans,
-- 20260903190000 onward, surfaced at /profile/connected-accounts) -- that
-- IS the product's own answer to this, so "personal ownership" is now read
-- straight off it instead of a separate claim step: has this account ever
-- been verified-linked to another one at all. No new state to maintain.
drop function if exists public.claim_personal_account_ownership();

alter table public.person_auth_accounts
  drop column personal_ownership_claimed_at;

create or replace function public.get_my_account_ownership()
returns table (
  account_type text,
  origin_employer_name text,
  personal_ownership_claimed_at timestamptz,
  active_employer_names text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    paa.account_type,
    oe.name as origin_employer_name,
    (
      select min(val.verified_at)
      from public.verified_account_links val
      where val.status = 'active'
        and (val.auth_account_a_id = auth.uid() or val.auth_account_b_id = auth.uid())
    ) as personal_ownership_claimed_at,
    coalesce(
      (select array_agg(distinct ae.name order by ae.name)
       from public.employer_members em
       join public.employers ae on ae.id = em.employer_id
       where em.user_id = auth.uid() and em.status = 'active'),
      '{}'::text[]
    ) as active_employer_names
  from public.person_auth_accounts paa
  left join public.employers oe on oe.id = paa.employer_id
  where paa.auth_user_id = auth.uid();
$$;
