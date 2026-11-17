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

## In progress

- Splitting the largest page files into focused files (started 2026-11-17).
  `SkillDetail.jsx`, `ExperienceDetail.jsx` and `PlanDetail.jsx` are done;
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
  - `src/pages/provider/CourseSections.jsx` (1,553 lines, no tests). Tests
    should cover: sections listed open with their content in position order,
    ungrouped content, collapsing a section, no editing controls when
    `canEdit` is false, the empty state, adding a section, keyboard reorder
    of sections and content, moving content to another section with the
    left/right arrows, and the order being restored with an error message
    when saving a reorder fails. Mock `lib/courseContent` and `lib/device`.
    A drag handle's accessible name is its label plus ". Drag to reorder, or
    use the arrow keys.". Then move `reorderById` to `src/lib/dragReorder.js`
    (update the import in `ProviderCourseEditor.test.jsx`), move
    `AddSectionModal`, `InlineSectionEditor`, `AddResourceModal` and
    `ItemPreviewBody`/`ItemPreviewPane` into their own files, and move the
    loading, reorder and drag state into a `useCourseOutline` hook.
  - `src/pages/employer/EmployerLearnersPanel.jsx` (1,487 lines, has tests).
    Not yet looked at; apply the same steps.
  - `SkillDetail.jsx` (now 1,138 lines): split the Knowledge, Application and
    Network tab panels and the block of dialogs into their own components.
  - Browser-check the experience and plan pages against Staging, and run
    `npm run test:e2e`; only the skill page was checked in a browser after
    its split.

- Possible bug found during the work above, not yet confirmed in a browser:
  in the course editor's outline, pressing the down arrow on a section's or a
  content item's drag handle appears to do nothing, while up, left and right
  work. `handleSectionKeyDown` and `handleOutlineItemKeyDown` in
  `CourseSections.jsx` call the reorder with the default side `'before'`;
  placing an item before the one directly below it leaves the order
  unchanged, so `reorderById` returns the same list. Confirm in the browser,
  then pass `'after'` for the down arrow and cover it with a test.

- Flaky test: `src/pages/ExperienceDetail.test.jsx` intermittently fails to
  load with "TypeError: React.createContext is not a function" raised inside
  react-router (about 1 run in 5 when run with one other test file, also on
  code from before the page split). The cause is not known. Reproduce with
  `npx vitest run src/pages/ExperienceDetail.test.jsx src/pages/Plans.test.jsx`
  in a loop.

## Done

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
