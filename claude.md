# LearnScope — Claude Code Instructions

## 1. Product Purpose

LearnScope is a learner-owned platform for recording, understanding, developing and demonstrating a person's skills/proficiency, learning and course history, employment and education, achievements and evidence, and professional development over time. The individual owns and controls their profile and records. It should feel like a personal development platform, not an employer-controlled LMS or CV builder.

## 2. Core Product Principles

* **Learner ownership** — the learner owns and controls their record. Employers, recruiters, training providers, coaches and other organisations must not receive access without an explicit permission path. Don't tie a learner's long-term record to a particular organisation unnecessarily.
* **Historical accuracy** — preserve when learning, skill development, proficiency or achievements actually occurred; distinguish effective/achievement dates from record creation dates. Users must be able to add and backdate historical records. Never substitute `created_at` for when something actually occurred.
* **Skills change over time** — don't model a skill as one mutable proficiency level. Preserve dated skill-level history so progression can be reconstructed; historical proficiency stays distinct from current proficiency.
* **Evidence over unsupported claims** — skills may be supported by courses, employment, education, projects, assessments, achievements, demonstrated experience or other evidence. Course completion does not itself prove proficiency. Don't imply a skill is verified unless appropriate evidence/verification exists.
* **User control** — don't silently infer, link, publish, share or materially update important learner information. Suggestions are fine; important changes stay under learner control.
* **Reusable records** — prefer relationships between records over duplicated data. An association must not duplicate the underlying source record. Unlinking a course/skill/achievement/evidence item must not delete the underlying record unless deletion is explicitly requested.
* **Privacy by design** — private data is scoped to the authenticated learner and any explicitly authorised relationships. Follow existing auth/ownership/RLS patterns. Never expose one learner's private information to another learner or organisation without an explicit permission path.

## 3. Core Domain Model

Concepts: learner profile; employment experiences; education/study experiences; courses and learning records; skills; skill proficiency history; skill achievements; evidence; relationships between these.

Employment and education entries are time-bounded chapters in the learner's development. An experience may be associated with courses completed during that period, skills first acquired/developed/applied, proficiency levels reached, dated achievements, and supporting evidence. Associations must not duplicate or overwrite their source records.

Actual names/structures in the codebase and schema take precedence over the conceptual terminology above.

## 4. Prevent Domain Duplication

Before creating a new database table, domain concept, evidence mechanism, proficiency mechanism, skill relationship, service, permission mechanism, authentication mechanism, or source of truth — search the existing implementation first and ask:

1. Does this concept already exist?
2. Can the existing concept be extended coherently?
3. Would this introduce another representation of the same information?
4. Would this create conflicting sources of truth?

Prefer extending a coherent existing model over parallel implementations. Don't create differently-named concepts that represent substantially the same business idea just because a new feature needs similar information.

## 5. Future Product Direction

Architecture should stay capable of supporting future use cases: career development, pre-boarding, recruitment/candidate profiles, workforce readiness, consent-based employer access, consent-based LMS import/export, portable learning/skills records, AI-assisted skill suggestions, verified skills/credentials, training providers, coaches/mentors, organisation experiences.

Don't implement these unless explicitly requested. Let future possibilities influence architecture only where doing so avoids an obvious dead end — no speculative complexity.

## 6. Architecture

React 19 + Vite 8, client-rendered SPA (`react-router-dom`). JavaScript/JSX — not TypeScript. Database: Supabase/Postgres, RLS on every table. Auth: Supabase Auth, email/password with confirmation. Hosting: Vercel. Backend: static app plus limited serverless functions under `api/`. Styling: Tailwind CSS v4 via `@theme` in `src/index.css`. Shared UI: lightweight shared components, no formal design-system package. Package manager: npm. No test framework configured. Migrations: sequential hand-written SQL in `supabase/migrations/`, applied manually by the project owner.

**Direction** — prefer a modular monolith unless there's a demonstrated technical, scaling, security or deployment reason to separate a capability. Different customer types alone don't justify microservices; learners, organisations, training providers, coaches and other experiences should reuse shared domain capabilities. Keep sensible module/domain boundaries so capabilities could be separated later if genuinely required. Prefer simple architecture over speculative abstraction.

## 7. Repository Map

* Routes: `src/App.jsx`
* Auth context: `src/context/AuthContext.jsx`
* Route protection: `src/components/ProtectedRoute.jsx`
* Feature/shared components: `src/components/`
* Shared constants/labels: `src/lib/`
* Migrations: `supabase/migrations/`
* Serverless functions: `api/`

Routes: `/`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/welcome`, `/rate/:code`, `/dashboard`, `/profile`, `/connections`.

No generated database types, no automated tests. Update this map only when implementation changes make it materially inaccurate.

## 8. Development Rules

* Read this file before implementation.
* Start with files explicitly named by the task; use targeted searches rather than reading entire directories; inspect further only when necessary.
* Understand existing behaviour before modifying it; follow established architecture, naming and component patterns; reuse existing components/utilities/forms/dialogs.
* Prefer the smallest coherent change that fully achieves the requested outcome.
* Don't refactor unrelated code, redesign unrelated pages, or implement adjacent/speculative features.
* Don't add dependencies unless the existing stack can't reasonably support the requirement, or change the database schema unless required.
* Preserve responsive behaviour and accessibility.
* Never place secrets, credentials or API keys in source code or this file.

## 9. Data Integrity

* Preserve `created_at`/`updated_at`; use effective/completion/achievement dates for historical events; never substitute `created_at` for when something occurred.
* Preserve dated proficiency history — historical proficiency must not be silently rewritten when current proficiency changes.
* Deleting an association must not delete its underlying record. Avoid duplicate skills/courses/achievements/evidence.
* Don't infer causation simply because dates overlap. Warn about inconsistent dates rather than silently modifying learner data.
* Respect existing ownership/access policies. Assume existing data matters — don't design migrations as though the database were empty.

## 10. Database Changes

Before modifying the schema: inspect relevant existing migrations/usage; determine whether an existing concept can support the requirement; consider existing data, historical integrity, RLS, backwards compatibility, and rollback.

Use the existing sequential SQL migration approach. Never manually modify production schema as part of implementation, and never weaken RLS simply to make functionality work.

For destructive/potentially destructive migrations, explicitly identify: affected tables, affected data, data-loss risk, migration approach, rollback strategy.

Production migration execution remains a human-controlled action unless explicitly changed by the project owner.

## 11. UI / UX

* Preserve the existing LearnScope visual language and navigation; reuse existing patterns before creating new ones.
* Keep historical records clearly distinguishable from current state.
* Use plain learner-centred terminology; avoid traditional LMS admin language where possible.
* Keep forms focused; require clear confirmation for destructive actions.
* Consider desktop and mobile; maintain keyboard accessibility and appropriate labels.
* Don't substantially redesign unrelated UI while implementing a feature.
* Expose the learner's development model, not unnecessary implementation/database terminology.

## 12. Implementation Method

**Investigate** — inspect only relevant routes, components, domain/data structures, migrations, auth/permissions, related utilities. Don't assume how existing functionality works.

**Plan** — before coding, provide up to five concise bullets: intended implementation, important affected components, database implications, security implications, meaningful risks. Ask a question only when the answer would materially change product behaviour or architecture.

**Implement** — make the smallest coherent change satisfying the requirement; stay within requested scope.

**Verify** — run `npm run lint` and `npm run build`, plus relevant automated tests when a framework exists. Never claim a command/check passed unless it actually ran. Where automated coverage doesn't exist, reason through and report affected user flows that remain manually verifiable.

**Report** — keep concise: what changed, files changed, database changes, verification performed, unresolved risks/deferred items.

## 13. Architectural Decision Rule

Routine implementation decisions may be made autonomously. Stop and explain the options before proceeding when a change would: introduce a major new domain concept; materially restructure the data model; introduce a new architectural pattern; introduce a major new dependency/external service; substantially change authentication or authorization; weaken or significantly restructure RLS; perform a destructive migration; create a competing source of truth; materially change learner ownership; materially change sharing/privacy behaviour; introduce a microservice or separately deployed application.

Don't stop for routine implementation choices — distinguish genuine architectural/product risk from stylistic preference.

## 14. Protected Areas

Extra caution before changing: authentication, authorization, RLS, ownership logic, database migrations, production configuration, secrets, production data, protected Git branches.

Never autonomously: delete production data, reset/drop production tables, weaken production security controls, expose secrets, force-push protected branches, or bypass established production safeguards.

If an action could reasonably cause production data loss or significant security impact, require explicit human approval.

## 15. Common Commands

* Install: `npm install`
* Development: `npm run dev`
* Lint: `npm run lint`
* Build: `npm run build`

Not available: type-check (JS project, n/a), automated tests (no framework configured), automated migrations (none — applied manually by the project owner via the next sequential SQL file in `supabase/migrations/`). Never invent a command.

## 16. Definition of Done

A task is complete only when: the requested outcome works; existing relevant functionality remains intact; learner ownership/privacy are preserved; historical information remains accurate; associations don't incorrectly duplicate/delete source records; security implications were considered; responsive/accessibility behaviour is preserved; relevant available checks were run; database implications were handled safely; no unnecessary domain duplication was introduced; unverified behaviour is reported honestly.

A feature appearing to work in the UI is not by itself sufficient evidence that it's complete.

## 17. Environments & Release Workflow

Two Supabase projects: **Staging** (local dev + Vercel Preview) and **Production** (Vercel Production only). Local `.env` always points at Staging, never Production; Vercel's Preview and Production env scopes must each point at their own project — never shared.

Two Git branches: `staging` (active dev; every push deploys a Vercel Preview build against Staging) and `master` (Vercel's Production branch; updated periodically by merging `staging` in once a batch is ready — not on every commit).

Release checklist when merging `staging` into `master`:

1. Diff `master..staging` for new files under `supabase/migrations/` — these ran against Staging but not yet Production.
2. Apply those migrations to the Production Supabase project's SQL editor, one at a time in order, before or alongside the release (human-run, per §10 — never automated).
3. Merge `staging` into `master` and push. Treat this as a deliberate release requiring explicit user confirmation each time, not a routine auto-push.

`supabase/migrations/stage_bootstrap_consolidated.sql` is a convenience bundle (every numbered migration concatenated in order) for bootstrapping a brand-new Staging project from empty. Regenerate it whenever a new migration is added. Never run it against a database that already has some of those migrations applied individually.

## Subagent Usage

Use the custom agents in `.claude/agents/` when their specialism matches the task. For substantial feature work: delegate codebase investigation where useful; use the test agent to assess test coverage/regression risk; use the security agent for auth, permissions, personal data, database policies, APIs, dependencies and deployment changes; integrate all findings in the main session; run required verification before declaring the task complete.

Don't spawn subagents for trivial changes where delegation adds no value.
