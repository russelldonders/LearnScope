-- 0073's "View own org's resources, or linked into an approved course" policy
-- on content_resources joins into course_content_links to check for an
-- approved-course link. Evaluating that join requires Postgres to also check
-- course_content_links' own policies -- including its "Org members manage
-- links for their own editable courses" ("for all") policy, which queries
-- back into content_resources directly. That closes the loop: content_resources
-- -> course_content_links -> content_resources -> ..., which Postgres reports
-- as "infinite recursion detected in policy for relation content_resources".
--
-- Same shape of bug as 0052/0059, fixed the same way: move the self-
-- referencing check into a SECURITY DEFINER function so it bypasses RLS
-- internally instead of re-entering content_resources' policies while
-- content_resources' own policy is still being evaluated.
create or replace function can_manage_content_resource(p_resource_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from content_resources cr
    where cr.id = p_resource_id
      and (is_platform_admin(p_user_id) or is_org_member(cr.organisation_id, p_user_id))
  )
$$;

grant execute on function can_manage_content_resource(uuid, uuid) to authenticated;

drop policy "Org members manage links for their own editable courses" on course_content_links;
create policy "Org members manage links for their own editable courses"
  on course_content_links for all
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_content_links.course_id
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
    and can_manage_content_resource(course_content_links.resource_id, auth.uid())
  )
  with check (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_content_links.course_id
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
    and can_manage_content_resource(course_content_links.resource_id, auth.uid())
  );
