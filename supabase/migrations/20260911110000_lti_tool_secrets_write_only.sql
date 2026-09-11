-- 20260911100000's admin policy on lti_tool_secrets used `for all`, which
-- silently includes select -- contradicting that migration's own stated
-- intent (and ProviderLtiToolsSection.jsx's comment) that no one, not even
-- an org's own admins, can read a consumer secret back once set. Split into
-- explicit insert/update/delete policies with no select policy at all, so
-- RLS actually enforces "write-only" rather than just the app's UI
-- choosing not to ask.
drop policy "Org admins can manage their organisation's LTI tool secrets" on lti_tool_secrets;

create policy "Org admins can set their organisation's LTI tool secrets"
  on lti_tool_secrets for insert
  to authenticated
  with check (exists (select 1 from lti_tools t where t.id = tool_id and is_org_admin(t.organisation_id, auth.uid())));

create policy "Org admins can replace their organisation's LTI tool secrets"
  on lti_tool_secrets for update
  to authenticated
  using (exists (select 1 from lti_tools t where t.id = tool_id and is_org_admin(t.organisation_id, auth.uid())))
  with check (exists (select 1 from lti_tools t where t.id = tool_id and is_org_admin(t.organisation_id, auth.uid())));

create policy "Org admins can remove their organisation's LTI tool secrets"
  on lti_tool_secrets for delete
  to authenticated
  using (exists (select 1 from lti_tools t where t.id = tool_id and is_org_admin(t.organisation_id, auth.uid())));
