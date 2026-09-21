# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

LearnScope serves individual learners building a lifelong record of skills, learning, experience, evidence, achievements and development. It also serves explicitly authorised employers, managers, training providers and platform administrators through separate, scoped working contexts.

Managers use LearnScope inside a specific employer context to support people with whom they have an active management relationship. A person may work for several employers and may be a learner, employee and manager at the same time.

## Product Purpose

LearnScope gives each person a portable, historically accurate development record that remains under their control. Organisational workflows can assign, suggest, confirm or collaborate around employer-owned records without taking ownership of, or receiving general access to, the learner's personal profile.

## Positioning

LearnScope separates a learner-owned lifelong record from employer-managed development activity while allowing explicit, revocable sharing between them. Management access is contextual to an employer and relationship, never a global entitlement to the person's profile.

## Operating Context

Learners record skills, proficiency history, training, experience and evidence. Employers maintain their own staff membership, role profiles, assignments and skill-management records. Managers work with direct, indirect, matrix, project or delegated reports within one selected employer context. People may hold several simultaneous employer memberships.

## Capabilities and Constraints

- React 19, Vite 8 and Tailwind CSS v4 client-rendered web application.
- Supabase/Postgres with row-level security and caller-scoped RPCs is the security boundary.
- Staging and Production use separate Supabase projects; Production migrations remain human-controlled.
- Management relationships belong to employer memberships and may carry different access scopes.
- Employer A must not receive Employer B data through management, search, analytics, export or AI retrieval paths.
- A manager is not inherently an Employer Admin and does not receive staff-administration privileges.
- Learner-owned data is visible in an employer context only through an explicit, active sharing grant. Revocation removes access without deleting the learner's record.
- Historical proficiency, learning and experience dates must remain distinct from record-creation dates.

## Brand Commitments

The product name is LearnScope. Product language is plain, learner-centred and trust-first. Existing navigation, typography, colour tokens, dark mode and interaction conventions are the incumbent visual authority.

## Evidence on Hand

The repository contains the working application, sequential Supabase migrations, database security tests, Vitest component/service tests and Playwright configuration. No external customer claims, testimonials or performance claims should be invented.

## Product Principles

- Learners retain ownership and control of their personal development record.
- Privacy and employer separation are enforced in database responses, not only hidden in the interface.
- Organisational permissions are explicit, contextual, least-privilege and revocable.
- Ownership and permission boundaries are visible at the point of use: employer context, management relationship, granted scope, and employer-owned versus learner-shared data are clearly identified.
- Historical records preserve when development actually happened.
- Existing domain concepts are extended instead of duplicated.

## Accessibility & Inclusion

New interfaces must preserve keyboard access, visible focus, readable contrast, responsive behaviour, semantic labels and the application's light/dark themes.
