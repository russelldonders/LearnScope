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
   under src/pages/employer/). Audited 2026-09-21 for what's still
   hardcoded on the learner side (importer-checked, not just filename
   guesses); the high blast-radius shared components from that audit
   (ErrorBoundary, ProtectedRoute, GrowthRing, GoogleSignInButton,
   StravaConnectButton, plus the one hardcoded "Reconnect Strava" call
   site in ConnectedAccounts.jsx) are now translated too, under a new
   `common` namespace for cross-cutting strings not tied to one page.
   ErrorBoundary sits outside LanguageProvider in App.jsx on purpose (a
   crash inside the provider tree must still show a fallback), so it
   can't call useLanguage() — it reads localStorage directly instead,
   duplicating a small slice of LanguageContext's own resolution logic
   rather than risking the app's last line of defence on that context
   being intact. GrowthRing needing useLanguage() rippled into several
   manager-console test files the same way ConfirmDialog's fix did
   before — fixed their test scaffolding (LanguageProvider wrapper),
   no behavior change to those staff-only pages. Still open from the
   audit:
   - Large standalone learner pages, untouched: ExperienceDetail.jsx
     (1499 lines), ProfilePrivacy.jsx (892), the whole ConnectedAccounts.jsx
     flow (669 lines plus ~15 account-linking/transfer-plan sub-panels
     under src/pages/account-linking/), CourseLearn.jsx, SkillsProfile.jsx,
     CourseCatalogue.jsx, ProviderProfile.jsx (public route), Onboarding.jsx
     + SkillsToLearnStep.jsx, Help.jsx, ProfileExport.jsx/ProfileImport.jsx,
     Welcome.jsx, Landing.jsx, ResetPassword.jsx, LtiSession.jsx.
   - Public token-link pages: Rate.jsx, Recommend.jsx, ValidateRequest.jsx,
     SharedProfile.jsx — no login required, worth polishing.
   - Shared components reused across the now-translated Skills/Experience
     pages: SkillCard, TagsField, CompositeSkillProgress, TimelineItem,
     ChildExperienceEntry, RoleProfileAlignmentDetail, PendingRoleTimelineCard,
     KnowledgeLevelBar, OrganizationUrlField, OrganizationLogo,
     EvidenceAttachmentLink, TrackingReasonIcon/Picker, FilterRow,
     AddExperienceButton, CourseThumbnail, PersonAvatar.
   - Dashboard/Connections inline sections: ConnectionsTeams.jsx (698
     lines, largest single component found), RecordActivitySection,
     ConnectionsActivityFeed, ConnectionTeamInviteControl, ActivityRow,
     ImportProfileDataButton, ProfilePhoto.
   - The employer-linked "role alignment" cluster shown to ordinary
     employer-linked learners via EmployerHome.jsx (LearnerRoleAlignment*,
     CurrentRoleCard, PendingAssignmentsPanel, RoleAlignmentSummary) —
     technically under src/pages/employer/ or src/pages/roles/, but
     confirmed learner-facing (reached via EmployerMemberRoute, not the
     admin EmployerAdminRoute); needs a scope decision before picking up.
   - EvidenceFields.jsx and RouteTitle.jsx are shared with one staff
     surface each (ManagerTeamPanel.jsx; a mixed learner+staff title
     array) but are safe to translate without touching staff code.
   - MyTeam.jsx sits directly under src/pages/ but is manager/team-lead
     tooling (behind ManagerRoute) — treat as out of scope like the rest
     of the manager console, despite the file location.
   Separately, deeply dynamic/AI-generated content (level guides,
   diagnostic questions, quiz/interview content, and the auto-generated
   audit strings some diagnostic flows save into skill_assessments.comments)
   stays out of scope by design, not an oversight. `t()` now supports
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
