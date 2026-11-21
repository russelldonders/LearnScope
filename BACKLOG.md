# Backlog

Running list of ideas, gaps, and improvements. Add new work under **Open**;
move active work to **In progress** and completed work to **Done**.

## Open

- Extend authenticated Playwright coverage beyond read-only learner smoke
  tests. Profile edits, course-progress changes, and video-editor journeys need
  isolated seeded records plus deterministic cleanup so parallel runs cannot
  change the shared synthetic learner or leave staging data behind.

- Translation scope note (learner-facing translation is complete): admin,
  provider and employer-admin consoles, TableControls' admin-only
  selection/bulk/column controls, staff page titles, level labels,
  experience-type labels, duplicate-skill messages, and generated AI content
  stay English unless that product decision changes.

- Organisation plans and workspace panels (0328-0332), follow-ups:
  - Browser-check the organisation console's Plans section (steps, sections,
    order and prerequisites, assigning, progress), a member starting an
    assigned plan from the workspace and from Actions, and the panels against
    Staging; only unit, pgTAP and the existing e2e suites cover them so far.

- Browser-check the employer People panel (`/organisation?section=users`)
  after its split: list, search, add staff, member details and the assign
  training/skill/role profile dialogs. `env.test` has no employer-admin
  account (its provider admin is redirected to the learner dashboard), so
  only `EmployerLearnersPanel.test.jsx` covers it so far.

- Splitting any further large page file: use the method below, one commit
  per step, with no change to what users see:
  1. Page tests first. Render the whole page against mocked data and pin down
     what it shows and what it saves (`SkillDetail.test.jsx` and
     `ExperienceDetail.page.test.jsx` are the models; `src/test/supabaseFake.js`
     is an in-memory supabase for pages that query tables directly).
  2. Move helper components and pure functions into their own files,
     unchanged. Pure functions go to `src/lib/` (this also clears the
     `only-export-components` lint warning), components next to the page.
  3. Move data loading and its state into a `use<Page>Data` hook next to the
     page, unchanged (`useSkillDetailData.js`, `useExperienceDetailData.js`
     and `usePlanDetail.js` are the models). Dialog and edit-mode state stays
     in the page.
  4. After each step run `npm run lint`, `npm run build`, `npm run test:run`,
     and `npx oxlint -D no-undef <changed files>` (the project lint does not
     flag a missing import in a moved file; ignore its `window`/`document`
     reports).

## In progress

- Flaky test: `src/pages/ExperienceDetail.test.jsx` intermittently fails to
  load with "TypeError: React.createContext is not a function" raised inside
  react-router (about 1 run in 5 when run with one other test file, also on
  code from before the page split). The cause is not known. Reproduce with
  `npx vitest run src/pages/ExperienceDetail.test.jsx src/pages/Plans.test.jsx`
  in a loop. Possibly related: on 2026-11-21 a full `npm run test:run` once
  failed to start the worker for
  `src/pages/account-linking/CreateLinkInvitationForm.test.jsx` ("source-map-js
  ... does not provide an export named 'SourceMapGenerator'"); the file passes
  on its own.

## Done

- Split the largest page files into focused files (2026-11-17 to
  2026-11-21): `SkillDetail.jsx` (now 865 lines, with
  `SkillKnowledgeTab`/`SkillApplicationTab`/`SkillNetworkTab`/
  `SkillDetailDialogs`), `ExperienceDetail.jsx`, `PlanDetail.jsx`,
  `provider/CourseSections.jsx` and `employer/EmployerLearnersPanel.jsx`
  (1,487 to 538 lines, with `AssignTrainingModal`, `AssignSkillModal`,
  `AssignRoleModal`, `employerLearnerColumns.jsx` and
  `useEmployerLearnersData.js`). Page tests were added first for each.
  `npm run test:e2e` passes, including the authenticated suites run
  against a local dev server on Staging data; the skill (all three tabs,
  settings and quick-log dialogs), experience and plan pages were checked
  in a browser with no console errors.

- Organisation plans follow-ups: assigned plans in the Actions inbox and
  notification bell; Plans panel set to particular plans; member names when
  assigning; team-manager goals and ratings from the organisation's teams in
  the Goals and Latest skills panels (0331); sections, order and
  prerequisites for organisation plans in the console (0332).

- Fixed the course outline's down arrow on a section's or content item's
  drag handle, which did nothing; covered by `CourseSections.test.jsx`.

- Added short-lived, read-only platform-admin user previews in a separate
  browser session, with database-enforced write blocking, start/end audit
  events, a required access reason, and privileged-account exclusion.

- Added optional authenticated Playwright infrastructure for a seeded staging
  learner. It reuses ignored storage state and covers dashboard, profile,
  connections, learning, and actions without mutating shared data.

- Completed the seven-language learner-interface pass across the main learner
  routes, shared learner components, token-link pages, connected accounts,
  course/catalogue/profile pages, and member-facing team sharing. Coverage is
  enforced by the i18n key and learner-interface tests.

- Extended translation to the team leader's panels (skills matrix, members,
  invites, rating/targets, learning, collaboration, member profile),
  `EvidenceFields`, TableControls' sorting/pagination, and the member's
  employer home including the role-alignment cluster.
