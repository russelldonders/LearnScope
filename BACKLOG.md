# Backlog

Running list of ideas, gaps, and improvements to pick up later. Add items under
"Open" as plain bullets (any detail is fine, doesn't need to be polished).
When picked up, move the item to "In progress"; when done, move it to "Done"
or just delete it.

## Open

- Expand Playwright e2e coverage — `e2e/auth.spec.ts` now covers signup/
  forgot-password forms and unauthenticated redirects for dashboard/profile/
  connections/actions, on top of the original landing-page/login test. Still
  no coverage of any *authenticated* flow (dashboard content, profile edits,
  connections, the video editor, course-progress) — that needs a seeded test
  backend/session, which the current Playwright setup deliberately avoids
  (see playwright.config.ts's placeholder-credentials comment).

- general
1. Multi-language: now 7 languages (en, es, fr, de, it, nl, zh) across
   AppHeader nav/menu, Login/Signup/ForgotPassword, the learner area's
   page-level shell text (headings, subheadings, primary buttons, empty
   states, tab/section labels) on Dashboard, Skills, Connections, Learning,
   Actions, Activity, Experience, and now all of SkillDetail.jsx — its
   overview panels (Knowledge/Application, Learn/Verify/Demonstrate/
   Validate, Skill Network, Upcoming), the settings dialog (details,
   schedule, delete/drop, visibility/validation settings), and the History
   tab's full timeline UI (activities, peer ratings, training, relationship
   links, validation decisions, and their detail modals) — plus the 12
   modal/section components SkillDetail.jsx opens (PeopleWithSkillModal,
   InviteRaterModal, RecommendSkillModal, RecordActivityModal,
   AssessBaselineModal, SetTargetModal, ValidateSkillModal,
   RequestValidationModal, ConfirmingBaselineQuizModal, InterviewModal,
   CurrentRoleSelectModal, SelfAssessSection), which are also reused from
   Dashboard/Actions/ExperienceDetail — plus 10 more confirmed
   learner-facing components: CourseModal (opened from CourseLearn),
   ResumeImportReviewModal (onboarding/profile import), FindSkillModal
   (Dashboard/ExperienceDetail/SkillsSection), StravaActivityReviewModal
   (ConnectedAccounts), ExperienceModal (Experience timeline),
   SkillPickerModal (inside RecordActivityModal), ShareSkillsModal
   (ProfilePrivacy), CohortPickerModal (Actions/CourseCatalogue and the
   public /providers/:slug page), EmployerDataAccessConsentDialog (shown to
   the learner despite the name — it's their own Actions page asking for
   their consent), and ConfirmDialog (the small shared confirm/cancel
   dialog used throughout learner flows — its default confirmLabel now
   resolves via t() instead of a hardcoded default, so any other page
   rendering it needed a LanguageProvider in its own tests too; fixed
   incidentally in employer/manager/role-alignment/account-linking test
   files that render it without changing what those pages do). Deliberately
   NOT translated (staff-only tooling, left alone per explicit instruction):
   admin/provider/employer/manager consoles, and their modals
   (PageBuilderModal, VideoEditorModal, ScreenRecorderModal,
   OrganisationSettingsModal, BulkAssignToCatalogueDialog,
   BulkPublishCourseDialog, SkillTestQuestionsModal,
   EmployerMemberFieldsModal, EmployerMemberDetailModal, and everything
   under src/pages/employer/). Still open on the learner side: a handful of
   other modals/secondary dialogs not yet audited, and deeply dynamic/
   AI-generated content (level guides, diagnostic questions, quiz/interview
   content, and the auto-generated audit strings some diagnostic flows save
   into skill_assessments.comments) — still a meaningful amount of ongoing
   work, not something to treat as finished. `t()` now supports
   string-interpolation (`t(key, { param })` replaces `{param}` placeholders
   in the translated string); spots needing genuine singular/plural
   phrasing still use a count-driven key pair rather than one templated
   string.
2. "Proxy as another user" — deliberately NOT built as literal session
   impersonation. The only way to make RLS-scoped queries genuinely return
   another learner's data is to hold a real, fully-privileged session as
   them (e.g. via a minted magic-link/OTP session) -- that's an
   account-takeover-capable primitive (a valid session can write, not just
   read), and building it unsupervised, with no interactive human security
   review available in this session, isn't a call to make alone. Instead,
   AdminUserDetail.jsx already covered most of the underlying need (a
   platform admin's full read-only view of one learner's profile, skills,
   courses, experience, connections) before this session started -- I added
   a GrowthRing to each skill row there so it reads more like the learner's
   own view rather than a bare data table. If true "become this user in
   their own session" impersonation is still wanted, it needs a deliberate
   security design pass (session scope/expiry, write-blocking, audit
   logging, exclusion of other platform admins as targets) with a human in
   the loop -- not something to pick up as a routine backlog item.

## In progress

## Done
