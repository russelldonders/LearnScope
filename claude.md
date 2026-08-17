# LearnScope — Claude Code Instructions

## 1. Product Purpose

LearnScope is a learner-owned platform for recording, understanding, developing and demonstrating a person's:

* skills and proficiency
* learning and course history
* employment and education
* achievements and evidence
* professional development over time

The individual owns and controls their profile and records.

LearnScope should feel like a personal development platform, not an employer-controlled LMS or traditional CV builder.

---

## 2. Core Product Principles

### Learner ownership

The learner owns and controls their personal development record.

Employers, recruiters, training providers, coaches and other organisations must not receive access without an explicit permission path.

Do not design functionality that unnecessarily ties a learner's long-term record to a particular organisation.

### Historical accuracy

LearnScope represents development over time.

Preserve when learning, skill development, proficiency or achievements actually occurred.

Distinguish effective/achievement dates from record creation dates.

Users must be able to add and backdate historical records.

Never substitute `created_at` for when something actually occurred.

### Skills change over time

Do not model a skill as only one mutable proficiency level.

Preserve dated skill-level history so progression can be reconstructed.

Historical proficiency must remain distinct from current proficiency.

### Evidence over unsupported claims

Skills may be supported by:

* courses
* employment
* education
* projects
* assessments
* achievements
* demonstrated experience
* other evidence

Course completion does not automatically prove skill proficiency.

Do not imply that a skill is verified unless appropriate evidence or verification exists.

### User control

Do not silently infer, link, publish, share or materially update important learner information.

Suggestions may be offered, but important changes should remain under learner control.

### Reusable records

Prefer relationships between records over duplicated data.

Creating an association must not duplicate the underlying source record.

Unlinking a course, skill, achievement or evidence item must not delete the underlying record unless deletion itself is explicitly requested.

### Privacy by design

Private data must be scoped to the authenticated learner and any explicitly authorised relationships.

Follow existing authentication, ownership and RLS patterns.

Never expose one learner's private information to another learner or organisation without an explicit permission path.

---

## 3. Core Domain Model

Important existing/conceptual domain concepts include:

* Learner profile
* Employment experiences
* Education and study experiences
* Courses and learning records
* Skills
* Skill proficiency history
* Skill achievements
* Evidence
* Relationships between these records

Employment and education entries represent time-bounded chapters in the learner's development.

An experience may be associated with:

* courses completed during that period
* skills first acquired
* skills developed
* skills applied or demonstrated
* proficiency levels reached
* dated achievements
* supporting evidence

Associations must not duplicate or overwrite their source records.

Actual names and structures in the existing codebase and schema take precedence over conceptual terminology in this document.

---

## 4. Prevent Domain Duplication

Before creating a new:

* database table
* domain concept
* evidence mechanism
* proficiency mechanism
* skill relationship
* service
* permission mechanism
* authentication mechanism
* source of truth

search the existing implementation first.

Determine:

1. Does this concept already exist?
2. Can the existing concept be extended coherently?
3. Would this introduce another representation of the same information?
4. Would this create conflicting sources of truth?

Prefer extending a coherent existing model over creating parallel implementations.

Do not create differently named concepts that represent substantially the same business idea merely because a new feature requires similar information.

---

## 5. Future Product Direction

The architecture should remain capable of supporting future use cases including:

* career development
* pre-boarding
* recruitment and candidate profiles
* workforce readiness
* consent-based employer access
* consent-based LMS record import/export
* portable learning and skills records
* AI-assisted skill suggestions
* verified skills and credentials
* training providers
* coaches and mentors
* organisation experiences

Do not implement these capabilities unless explicitly requested.

Future possibilities should influence architecture only where doing so avoids an obvious dead end. Do not introduce speculative complexity.

---

## 6. Architecture

Current verified architecture:

* Framework: React 19 + Vite 8
* Application: client-rendered SPA using `react-router-dom`
* Language: JavaScript / JSX — not TypeScript
* Database: Supabase/Postgres
* Security: Row Level Security on every table
* Authentication: Supabase Auth
* Signup: email/password with email confirmation
* Hosting: Vercel
* Backend: static application plus limited serverless functions under `api/`
* Styling: Tailwind CSS v4 using `@theme` in `src/index.css`
* Shared UI: lightweight shared components rather than a formal design-system package
* Package manager: npm
* Tests: no test framework currently configured
* Database migrations: sequential hand-written SQL in `supabase/migrations/`, currently applied manually by the project owner

### Architectural direction

Prefer a modular monolith unless there is a demonstrated technical, scaling, security or deployment reason to separate a capability.

Different customer types do not by themselves justify microservices.

Learners, organisations, training providers, coaches and other customer experiences should reuse shared domain capabilities where appropriate.

Maintain sensible module/domain boundaries so capabilities could be separated later if genuinely required.

Prefer simple architecture over speculative abstraction.

---

## 7. Repository Map

Important current locations:

* Routes: `src/App.jsx`
* Authentication context: `src/context/AuthContext.jsx`
* Route protection: `src/components/ProtectedRoute.jsx`
* Feature/shared components: `src/components/`
* Shared constants/labels: `src/lib/`
* Database migrations: `supabase/migrations/`
* Serverless functions: `api/`

Routes currently include:

* `/`
* `/login`
* `/signup`
* `/forgot-password`
* `/reset-password`
* `/welcome`
* `/rate/:code`
* `/dashboard`
* `/profile`
* `/connections`

There are currently no generated database types and no automated tests.

Update this map only when implementation changes make it materially inaccurate.

---

## 8. Development Rules

* Read this file before implementation.
* Start with files explicitly named by the task.
* Use targeted searches rather than reading entire directories.
* Inspect additional files only when necessary.
* Understand existing behaviour before modifying it.
* Follow established architecture, naming and component patterns.
* Reuse existing components, utilities, forms and dialogs.
* Prefer the smallest coherent change that fully achieves the requested outcome.
* Do not refactor unrelated code.
* Do not redesign unrelated pages.
* Do not implement adjacent or speculative features.
* Do not add dependencies unless the existing stack cannot reasonably support the requirement.
* Do not change the database schema unless required.
* Preserve responsive behaviour and accessibility.
* Never place secrets, credentials or API keys in source code or this file.

---

## 9. Data Integrity

* Preserve `created_at` and `updated_at`.
* Use effective/completion/achievement dates for historical events.
* Do not substitute `created_at` for the date something occurred.
* Preserve dated proficiency history.
* Historical proficiency must not be silently rewritten when current proficiency changes.
* Deleting an association must not delete its underlying record.
* Avoid duplicate skills, courses, achievements and evidence.
* Do not infer causation simply because dates overlap.
* Warn about inconsistent dates rather than silently modifying learner data.
* Respect existing ownership and access policies.
* Assume existing data matters; do not design migrations as though the database were empty.

---

## 10. Database Changes

Before modifying the schema:

1. Inspect relevant existing migrations and usage.
2. Determine whether an existing concept can support the requirement.
3. Consider existing data.
4. Consider historical integrity.
5. Consider RLS.
6. Consider backwards compatibility.
7. Consider rollback.

Use the existing sequential SQL migration approach.

Do not manually modify production schema as part of implementation.

Never weaken RLS simply to make functionality work.

For destructive or potentially destructive migrations, explicitly identify:

* affected tables
* affected data
* data-loss risk
* migration approach
* rollback strategy

Production migration execution remains a human-controlled action unless explicitly changed by the project owner.

---

## 11. UI / UX

* Preserve the existing LearnScope visual language and navigation.
* Reuse existing patterns before creating new ones.
* Keep historical records clearly distinguishable from current state.
* Use plain learner-centred terminology.
* Avoid traditional LMS administration language where possible.
* Keep forms focused.
* Require clear confirmation for destructive actions.
* Consider desktop and mobile.
* Maintain keyboard accessibility and appropriate labels.
* Do not substantially redesign unrelated UI while implementing a feature.

The interface should expose the learner's development model, not unnecessary implementation/database terminology.

---

## 12. Implementation Method

For non-trivial tasks:

### Investigate

Inspect only relevant:

* routes
* components
* domain/data structures
* migrations
* authentication/permissions
* related utilities

Do not assume how existing functionality works.

### Plan

Before coding, provide no more than five concise bullets covering:

* intended implementation
* important affected components
* database implications
* security implications
* meaningful risks

Ask a question only when the answer would materially change product behaviour or architecture.

### Implement

Make the smallest coherent change satisfying the requirement.

Stay within requested scope.

### Verify

Run:

`npm run lint`

and:

`npm run build`

Run relevant automated tests when a testing framework exists.

Never claim a command or check passed unless it was actually run.

Where automated coverage does not exist, reason through and report affected user flows that remain manually verifiable.

### Report

Keep completion reports concise and include only:

* what changed
* files changed
* database changes
* verification performed
* unresolved risks/deferred items

---

## 13. Architectural Decision Rule

Routine implementation decisions may be made autonomously.

Stop and explain the options before proceeding when a change would:

* introduce a major new domain concept
* materially restructure the data model
* introduce a new architectural pattern
* introduce a major new dependency or external service
* substantially change authentication or authorization
* weaken or significantly restructure RLS
* perform a destructive migration
* create a competing source of truth
* materially change learner ownership
* materially change sharing/privacy behaviour
* introduce a microservice or separately deployed application

Do not stop for routine implementation choices.

Distinguish genuine architectural/product risk from stylistic preference.

---

## 14. Protected Areas

Exercise additional caution before changing:

* authentication
* authorization
* RLS
* ownership logic
* database migrations
* production configuration
* secrets
* production data
* protected Git branches

Never autonomously:

* delete production data
* reset a production database
* drop production tables
* weaken production security controls
* expose secrets
* force-push protected branches
* bypass established production safeguards

If an action could reasonably cause production data loss or significant security impact, require explicit human approval.

---

## 15. Common Commands

Verified current commands:

* Install: `npm install`
* Development: `npm run dev`
* Lint: `npm run lint`
* Build: `npm run build`

Not currently available:

* Type-check: not applicable; JavaScript project
* Automated tests: no test framework currently configured
* Automated database migration command: none

Database migrations are currently applied manually by the project owner using the next sequential SQL migration in `supabase/migrations/`.

Never invent a command.

---

## 16. Definition of Done

A task is complete only when:

* the requested outcome works
* existing relevant functionality remains intact
* learner ownership/privacy are preserved
* historical information remains accurate
* associations do not incorrectly duplicate/delete source records
* relevant security implications were considered
* responsive/accessibility behaviour is preserved
* relevant available checks were run
* database implications were handled safely
* no unnecessary domain duplication was introduced
* unverified behaviour is reported honestly

A feature appearing to work in the UI is not by itself sufficient evidence that the feature is complete.

## Subagent usage

Use the custom agents in `.claude/agents/` when their specialism matches the task.

For substantial feature work:

1. Delegate codebase investigation where useful.
2. Use the test agent to assess test coverage and regression risk.
3. Use the security agent for authentication, permissions, personal data, database policies, APIs, dependencies, and deployment changes.
4. Integrate all findings in the main session.
5. Run the required verification before declaring the task complete.

Do not spawn subagents for trivial changes where delegation adds no value.
