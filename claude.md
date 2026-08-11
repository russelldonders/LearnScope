# LearnScope — Claude Code Instructions

## Product purpose

LearnScope is a learner-owned platform for recording, understanding and demonstrating a person’s:

- skills and proficiency
- learning and course history
- employment and education
- achievements and evidence
- professional development over time

The individual owns and controls their profile and records.

LearnScope must feel like a personal development platform—not an employer-controlled LMS or a traditional CV builder.

## Product principles

All development decisions should follow these principles:

1. Learner ownership
   - The learner owns and controls their data.
   - Employers, recruiters and other organisations must not receive access without explicit learner permission.

2. Historical accuracy
   - Preserve when learning, skill development or achievements actually occurred.
   - Distinguish the effective or achievement date from the date a record was created.
   - Users must be able to add and backdate historical records.

3. Evidence over unsupported claims
   - Skills may be supported by courses, employment, education, projects, assessments, achievements or other evidence.
   - Do not imply that a skill is verified unless supporting evidence or verification exists.

4. Skills change over time
   - Do not model a skill as only one mutable proficiency level.
   - Preserve dated skill-level history so progression can be reconstructed.
   - Historical proficiency must remain distinct from current proficiency.

5. User control
   - Do not silently infer, link, publish, share or update important information.
   - Suggestions are useful, but the learner should confirm them.

6. Reusable records
   - Prefer relationships between records over duplicated data.
   - Unlinking a course, skill or achievement must not delete the underlying record.

7. Privacy by design
   - Scope private data to the authenticated learner.
   - Follow the existing authentication, ownership and row-level security patterns.
   - Never expose one learner’s information to another learner.

## Core product model

The intended conceptual model includes:

- Learner profile
- Employment experiences
- Education and study experiences
- Courses and learning records
- Skills
- Skill proficiency history
- Skill achievements
- Evidence
- Relationships between these records

Employment and education entries are time-bounded chapters in the learner’s development.

Each experience may be associated with:

- courses completed during that period
- skills first acquired
- skills developed
- skills applied or demonstrated
- proficiency levels reached
- dated achievements
- supporting evidence

Creating an association must not duplicate or overwrite the source record.

## Future product direction

The architecture should remain capable of supporting these future use cases, but they should not be implemented unless explicitly requested:

- career development
- pre-boarding
- recruitment and candidate profiles
- workforce readiness
- consent-based employer access
- consent-based LMS record import and export
- portable learning and skills records
- AI-assisted skill suggestions
- verified skills and credentials

Do not add speculative functionality merely because it appears in this section.

## Technical architecture

Claude should inspect the repository and complete this section using only verified information.

- Framework: React 19 + Vite 8, client-rendered SPA (react-router-dom for routing)
- Language: JavaScript (JSX) — no TypeScript, no generated types
- Database: Supabase (Postgres) with Row Level Security on every table
- Authentication: Supabase Auth (email/password, email confirmation required for new signups)
- Hosting: Vercel (static build + a couple of serverless functions under `api/`)
- Styling/UI system: Tailwind CSS v4 via `@theme` in `src/index.css` (no `tailwind.config.js`); small shared components (`GrowthRing`, `EvidenceFields`, etc.) rather than a formal design-system package
- Testing: none configured — no test runner, no test files
- Package manager: npm (`package-lock.json`)
- Database migration approach: hand-written, sequentially numbered SQL files in `supabase/migrations/` (`0001_...` through `0012_...`); no CLI/automation in-repo — applied manually against the Supabase project by the owner

Do not guess missing technical information.

## Repository map

Claude should update this section after inspecting the repository.

- Application routes: `src/App.jsx` — `/`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/welcome`, `/rate/:code` (public), `/dashboard`, `/profile`, `/connections` (last three behind `ProtectedRoute`)
- Shared components: `src/components/` — one feature area per file, e.g. `SkillsSection`/`SkillModal`/`SkillDetailModal`, `CoursesSection`/`CourseModal`/`CourseCard`, `ExperienceSection`/`ExperienceModal`/`TimelineItem`, plus small reusable pieces (`GrowthRing`, `EvidenceFields`, `TrackingReasonPicker`, `InviteRaterModal`). Small "constants + labels" pairs live in `src/lib/` (`levels.js`, `trackingReasons.js`, `skillSource.js`, `skillRelationships.js`).
- Database schema/migrations: `supabase/migrations/0001_init.sql` … `0012_experience_learning_links.sql` (read in order for full current schema; no single schema dump exists)
- Generated database types: none — plain JS, nothing generated from the schema
- Authentication logic: `src/context/AuthContext.jsx` (Supabase Auth wrapper exposing `user`/`session`/sign-in/up/out), `src/components/ProtectedRoute.jsx` (route guard)
- Tests: none present in the repository

Keep this map concise. Include only locations that will help future implementation tasks.

## Development rules

- Read this file before exploring the repository.
- Start with files explicitly named in the task.
- Use targeted searches instead of reading entire directories.
- Inspect additional files only when directly required.
- Follow the existing architecture, naming and component patterns.
- Reuse existing components, utilities, forms and dialogs.
- Prefer the smallest coherent change that achieves the requested outcome.
- Do not refactor unrelated code.
- Do not redesign unrelated pages.
- Do not implement adjacent or speculative features.
- Do not add dependencies unless the existing stack cannot reasonably support the requirement.
- Do not change the database schema unless the task requires it.
- Use the repository’s established migration process for database changes.
- Regenerate database types when required by the existing project conventions.
- Preserve responsive behaviour and accessibility.
- Never place secrets, credentials or API keys in source code or this file.

## Data integrity rules

- Preserve `created_at` and `updated_at` audit information.
- Use an effective, completion or achievement date for historically dated events.
- Do not substitute `created_at` for the date an event actually occurred.
- Historical proficiency records must not overwrite current proficiency automatically.
- Deleting an association must not delete its underlying record.
- Avoid duplicate skills, courses and achievements.
- Do not infer that a job or course caused a skill solely because their dates overlap.
- Warn about inconsistent dates rather than silently changing user data.
- Respect existing ownership rules and database access policies.

## UI conventions

- Preserve the existing LearnScope visual language and navigation.
- Make historical records clearly distinguishable from current status.
- Use plain, learner-centred terminology.
- Avoid traditional LMS administration language where possible.
- Give users clear confirmation before destructive actions.
- Keep forms focused and avoid unnecessary fields.
- Ensure important workflows work on desktop and mobile.
- Maintain keyboard accessibility and appropriate labels.

## How to approach implementation tasks

Before coding:

1. Read this file.
2. Inspect only the relevant routes, components, data models and tests.
3. Provide a concise plan of no more than five bullets.
4. Identify any database or security implications.
5. Ask a question only if the answer would materially change the implementation.

During implementation:

- Stay within the requested scope.
- Reuse existing patterns.
- Make database changes using the established approach.
- Do not leave partially connected UI or data-model changes.
- Do not claim that something works without verifying it.

After implementation:

- Run the relevant type-check, lint and tests.
- Fix failures caused by the changes.
- Check the stated acceptance criteria.
- Report only:
  - what changed
  - files changed
  - database changes
  - verification performed
  - unresolved risks or deferred items

Keep the completion report concise.

## Common commands

Claude should complete this section using commands verified from `package.json` and the repository configuration.

- Install: `npm install`
- Development server: `npm run dev`
- Type-check: not applicable (JavaScript project)
- Lint: `npm run lint` (oxlint)
- Test: not configured — no test command exists
- Build: `npm run build`
- Database migration: no in-repo command; the project owner runs the next `supabase/migrations/NNNN_*.sql` file manually against the Supabase project (e.g. via the SQL editor)

Never invent or assume a command.

## Protected areas

Before changing authentication, database access policies, ownership logic, migrations or production configuration:

- inspect the existing implementation
- preserve backwards compatibility where reasonably possible
- explain the security or migration impact
- avoid destructive database operations
- do not weaken access controls to make a feature work

## Definition of done

A task is complete only when:

- the requested user outcome works
- existing relevant functionality still works
- data ownership and privacy are preserved
- historical dates and associations remain accurate
- responsive and accessible behaviour is maintained
- relevant checks have been run
- any unverified behaviour is reported honestly