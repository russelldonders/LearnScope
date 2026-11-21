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

- Organisation plans and workspace panels (0328/0329), follow-ups:
  - Browser-check the organisation console's Plans section and a member
    starting an assigned plan against Staging; only unit, pgTAP and the
    existing e2e suites cover them so far.
  - The Goals and Latest skills panels leave out goals and ratings set by a
    team manager: team rows carry no organisation, and members can't read
    their team's workspace. Showing them needs a definer function that
    resolves a team to its workspace's organisation.
  - Assigned plans don't appear in the /actions inbox the way assigned
    courses do, only in the organisation's workspace.
  - Organisation plans have no sections or prerequisites in the console yet,
    and the assign list shows members by email (the members API has no
    names).
  - The Plans panel shows all of the member's plans from the organisation;
    it can't yet be set to particular plans.

## In progress

- Splitting the largest page files into focused files (started 2026-11-17).
  `SkillDetail.jsx`, `ExperienceDetail.jsx`, `PlanDetail.jsx` and
  `provider/CourseSections.jsx` are done;
  the rest is listed below. The method for every page, one commit per step,
  with no change to what users see:
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

  Remaining work:
  - `src/pages/employer/EmployerLearnersPanel.jsx` (1,487 lines, has tests).
    Not yet looked at; apply the same steps.
  - `SkillDetail.jsx` (now 1,138 lines): split the Knowledge, Application and
    Network tab panels and the block of dialogs into their own components.
  - Browser-check the experience and plan pages against Staging, and run
    `npm run test:e2e`; only the skill page was checked in a browser after
    its split.

- Flaky test: `src/pages/ExperienceDetail.test.jsx` intermittently fails to
  load with "TypeError: React.createContext is not a function" raised inside
  react-router (about 1 run in 5 when run with one other test file, also on
  code from before the page split). The cause is not known. Reproduce with
  `npx vitest run src/pages/ExperienceDetail.test.jsx src/pages/Plans.test.jsx`
  in a loop.

## Done

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
