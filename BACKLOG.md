# Backlog

Running list of ideas, gaps, and improvements. Add new work under **Open**;
move active work to **In progress** and completed work to **Done**.

## Open

- Extend authenticated Playwright coverage beyond read-only learner smoke
  tests. Profile edits, course-progress changes, and video-editor journeys need
  isolated seeded records plus deterministic cleanup so parallel runs cannot
  change the shared synthetic learner or leave staging data behind.

- Finish the remaining learner-facing translation edge cases:
  - Decide whether the employer-linked role-alignment cluster
    (`LearnerRoleAlignment*`, `CurrentRoleCard`, `PendingAssignmentsPanel`,
    `RoleAlignmentSummary`) belongs in learner translation scope.
  - Translate `EvidenceFields.jsx` and `RouteTitle.jsx` without changing their
    staff-facing consumers.
  - Keep manager/admin/provider/employer consoles, level labels,
    experience-type labels, duplicate-skill messages, and generated AI content
    out of scope unless that product decision changes.

- If literal admin impersonation is still wanted, run a dedicated security
  design review first. A safe proposal must cover session scope and expiry,
  write blocking, audit logging, and exclusion of privileged accounts. The
  existing `AdminUserDetail.jsx` remains the supported read-only learner view.

## In progress

## Done

- Added optional authenticated Playwright infrastructure for a seeded staging
  learner. It reuses ignored storage state and covers dashboard, profile,
  connections, learning, and actions without mutating shared data.

- Completed the seven-language learner-interface pass across the main learner
  routes, shared learner components, token-link pages, connected accounts,
  course/catalogue/profile pages, and member-facing team sharing. Coverage is
  enforced by the i18n key and learner-interface tests.
