# Frontend service contracts

Status: initial integration contract. Field names describe application view
models, not final database column names.

UI features must consume service functions rather than querying ownership and
sharing tables directly. This keeps authorisation decisions in the domain/data
layer and prevents screens from inferring permissions from labels or hidden
buttons.

## Workspace model

```js
{
  id: 'uuid',
  kind: 'personal' | 'manager' | 'employer' | 'provider' | 'platform_admin',
  employerId: 'uuid' | null,
  providerOrganisationId: 'uuid' | null,
  name: 'My personal profile',
  role: 'owner' | 'employee' | 'manager' | 'lms_admin' | 'provider',
  status: 'active' | 'suspended' | 'ended',
  requiresReauthentication: false,
  allowedActions: ['workspace:enter'],
}
```

`allowedActions` is server-derived. It is a presentation aid, not a substitute
for database authorisation.

Required services:

```js
listAvailableWorkspaces()
getActiveWorkspace()
selectWorkspace(workspaceId)
```

Selecting a workspace can return `reauthentication_required` with the required
login kind and a safe post-authentication return location.

## Authentication-account summary

```js
{
  id: 'application-account-id',
  kind: 'personal' | 'work_sso' | 'work_managed',
  organisationId: 'uuid' | null,
  label: 'Personal email',
  maskedIdentifier: 'r***@example.com',
  status: 'active' | 'suspended' | 'disconnected',
  verifiedAt: 'timestamp',
  lastUsedAt: 'timestamp' | null,
}
```

Organisation-facing services must never return the personal identifier. They
may return only `personalContinuityConfigured: boolean`.

## Employee summary

```js
{
  id: 'work-profile-id',
  organisationId: 'uuid',
  displayName: 'Sam Taylor',
  employeeReference: 'EMP-1042',
  department: 'Operations',
  status: 'invited' | 'active' | 'suspended' | 'ended',
  roleAssignment: null | {
    id: 'uuid',
    title: 'Operations Manager',
    roleProfileId: 'uuid',
    effectiveFrom: 'date',
  },
  personalContinuityConfigured: true,
}
```

Required employer services:

```js
listOrganisationEmployees(organisationId, filters)
inviteOrganisationEmployee(organisationId, input)
getOrganisationEmployee(organisationId, workProfileId)
updateOrganisationEmployee(organisationId, workProfileId, input)
suspendOrganisationEmployee(organisationId, workProfileId, reason)
endOrganisationEmployment(organisationId, workProfileId, input)
```

The service validates the caller's active organisation workspace; callers do
not gain authority by passing `organisationId`.

## Role profile and alignment

```js
{
  id: 'role-profile-id',
  organisationId: 'uuid',
  name: 'Customer Success Manager',
  code: 'CSM-2',
  version: 3,
  status: 'draft' | 'active' | 'retired',
  skillRequirements: [],
  trainingRequirements: [],
}
```

```js
{
  id: 'alignment-id',
  personalRoleId: 'uuid',
  employeeRoleAssignmentId: 'uuid',
  status: 'pending' | 'active' | 'declined' | 'ended',
  requirements: [{
    id: 'requirement-id',
    kind: 'skill' | 'training',
    label: 'Stakeholder management',
    requirement: 'Level 3',
    responseStatus: 'not_shared' | 'acknowledged' | 'in_progress' |
      'awaiting_review' | 'satisfied' | 'waived' | 'expired',
    sharedRecordSummaries: [],
  }],
}
```

Role-alignment mutations act on associations and responses. They never accept
an arbitrary patch for the other party's source role.

## Manager team

```js
{
  id: 'team-id',
  workspaceId: 'manager-workspace-id',
  name: 'New managers cohort',
  ownership: 'independent' | 'affiliated' | 'organisation',
  organisationId: 'uuid' | null,
  memberCounts: { active: 6, pending: 2 },
  allowedActions: ['team:invite', 'activity:create'],
}
```

Team-member detail contains team-shared activity only. It must not embed the
member's general profile, course list or skill list.

Required services:

```js
listManagerTeams(workspaceId)
createManagerTeam(workspaceId, input)
inviteTeamMembers(teamId, connectionIds)
respondToTeamInvitation(invitationId, decision)
createTeamLearningActivity(teamId, input)
getTeamLearningActivity(teamId, activityId)
proposeTeamOrganisationTransition(teamId, input)
respondToTeamTransition(requestId, decision)
```

## Errors

Services return or throw stable domain codes that the UI may map to copy:

- `permission_denied`
- `workspace_inactive`
- `reauthentication_required`
- `link_conflict`
- `link_expired`
- `duplicate_assignment`
- `record_not_exportable`
- `consent_required`
- `stale_version`

Raw Postgres, PostgREST and identity-provider messages are not user-facing
contracts.
