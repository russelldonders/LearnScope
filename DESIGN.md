# LearnScope Interface System

## Visual Character

LearnScope is calm, editorial and trust-first. It favours scanable information, clear ownership, generous whitespace and hairline structure over decorative dashboard chrome. Existing authenticated pages use a restrained `max-w-4xl` content frame and low elevation; shadows are reserved for overlays or editing surfaces.

## Foundations

- Surfaces: `paper` is the page background and `card` is the quiet raised surface.
- Text: `ink` is primary copy and `secondary` is supporting copy.
- Semantics: `moss` is the primary/action and confirmed state, `slate` distinguishes validated or indirect states, and `gold` is meaningful emphasis and the global focus indicator.
- Boundaries: `hairline` is the standard control and section divider, with sufficient non-text contrast.
- Themes: use the CSS variables in `src/index.css`; never hard-code light-only colours. The `.dark` mappings are part of the same system.
- Typography: Fraunces is the display face for page and section headings. IBM Plex Sans is the interface and body face. IBM Plex Mono is for codes and technical identifiers.

## Components and Layout

- Prefer whitespace, dividers and typographic hierarchy to nested cards.
- Use rounded pills for compact status, relationship and scope labels; colour conveys meaning but labels remain explicit.
- Use circular initial/avatar treatments for people.
- Inputs and buttons use modest radii, visible hairline borders and the shared gold focus ring.
- Primary actions use moss with paper text. Secondary actions remain outlined or quiet.
- Responsive layouts stack naturally; preserve reading order, labels and action context rather than compressing desktop grids.
- When personal and organisation-owned records appear together, label ownership on every row with text-backed semantic pills rather than colour alone. Personal rows may link to personal editing surfaces; employer-owned rows stay read-only in the learner context and name the owning employer. Reinforce the boundary in nearby explanatory copy.

## My Team Surface Brief

- Optimise for operational scanability, not dashboard decoration.
- Always show the active employer context when more than one is available.
- Put relationship type and granted access scope before manager actions.
- Distinguish employer-owned records and actions from information explicitly shared by the learner.
- Keep privacy reassurance close to sensitive information and never link a manager to the learner's unrestricted profile.
- Functional, project, delegated and indirect relationships must read as scoped relationships, not implied administrative authority.
- Loading, empty, denied and error states should remain useful and quiet, with a clear retry or return path.
