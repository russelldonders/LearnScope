# LTI skill provider: configuration and operation

The implementation is in `api/_lib/lti/`, `src/lib/lti/`, `src/pages/LtiSession.jsx`, and the provider LTI configuration panels. It supports manually registered LTI 1.3 launches, Deep Linking 2.0 resource selection, and AGS 2.0 proficiency scores. It has not yet been verified against a live LMS or certified by 1EdTech. Connections are disabled unless explicitly activated in deployment configuration.

## Provider setup

1. Open provider organisation settings → **LMS connections**. Save the LMS issuer, client ID, deployment IDs, authorization URL, public JWKS URL and OAuth token URL. Obtain these from the LMS administrator.
2. On an offered skill’s detail page, open **LTI objects**. Create an object with its title, optional description and target proficiency, grade-sharing option, and permitted LMS connections. One skill can have several objects and each object can be assigned to several connections.
3. Open **Registration details** on the connection. Register the displayed login-initiation, launch/redirect, JWKS and Deep Linking URLs in the LMS. The deployment must have its stable tool origin and signing key configured before these details are available.
4. The deployment administrator verifies the registration and places its ID/fingerprint entry in `LTI_ENABLED_CONNECTIONS`. Changes to issuer, client, deployments or endpoints invalidate that activation and existing sessions. Saved `draft` status means eligible configuration; runtime activation is independently controlled by the deployment allowlist. Archiving stops launches and grade delivery.
5. In the LMS, open its external-tool content picker and select an available skill. Enable its gradebook item/AGS score permission if proficiency passback is wanted. Deep Linking supplies a score maximum of 5. The first release requires an LMS-provided line item; it does not create one through the line-item management API.

## Deployment configuration

Use separate registrations, origins and keys for staging and production. Never put any private key or service credential in a `VITE_` variable.

| Server variable | Value |
| --- | --- |
| `LTI_TOOL_ORIGIN` | Stable HTTPS origin, no trailing slash or path; never a disposable preview URL |
| `LTI_PRIVATE_JWK` | Private RSA signing JWK with unique `kid`, at least 2048 bits; store as a deployment secret |
| `LTI_PREVIOUS_PUBLIC_JWKS` | Optional JSON array of previous public RSA keys during rotation; no private parameters |
| `LTI_ENABLED_CONNECTIONS` | JSON object mapping connection UUIDs to fingerprints from Registration details; default `{}` disables all connections |
| `LTI_FRAME_ORIGINS` | Comma-separated HTTPS LMS origins allowed to frame the wrapper, including all required ancestor origins |
| `LTI_SERVICE_ORIGINS` | Optional comma-separated HTTPS service origins when LMS grade/return endpoints differ from its issuer/authorization origin |
| `LTI_WORKER_SECRET` | Strong random secret for the delivery worker |
| Existing Supabase server variables | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, scoped to the correct environment |

Generate the signing JWK offline using a maintained JOSE library or your key-management system; save it directly into secret storage rather than terminal logs. For rotation, retain the previous public key while switching the private key to a new `kid`, then remove it after the LMS has refreshed its key cache and outstanding assertions have expired.

Apply `20260911130000_lti_configuration.sql`, then `20260911140000_lti_runtime.sql` through the normal migration workflow. The earlier draft configuration migration was never applied remotely and has been renumbered after current staging migrations. `stage_bootstrap_consolidated.sql` is for empty databases only.

The API reuses the existing admin dispatcher via `/api/lti/*`, keeping the existing serverless function count. The dispatcher branches into LTI before normal admin authentication; each LTI action enforces its own protocol/session/role/ownership checks. `/lti/*` serves the built SPA with a restricted `frame-ancestors` policy. `vercel.json` includes `dist/index.html` in this function. Confirm this packaging and all route rewrites in the staging deployment.

## Learner identity and ownership

LTI does not mint a Supabase login or grant LearnScope organisation roles. A learner signs in with the existing LearnScope flow, then explicitly confirms linking their LMS subject to that account. Email claims are never used to merge identities. The identity namespace includes the registered issuer/client; a different registration cannot inherit an existing identity accidentally.

The wrapper resolves only the signed-in learner’s own personal skill using its catalogue identity. If absent, **Add to my skills** requires an explicit click. It does not set a proficiency or overwrite an existing personal target. A same-name conflict asks the learner to review their existing skill. Normal onboarding and profile setup remain required before rendering the reusable skill detail component.

Grade sharing is a second, separate opt-in for each LMS resource. Only the current practical level is shared, never evidence, history, knowledge level or another learner’s data. Learners can also revoke links from Connected accounts → LMS accounts without access to the LMS or a valid launch. Disconnecting removes the account mapping and grade links and invalidates that identity’s sessions. In-flight requests cannot be recalled after the LMS receives them.

The browser-bound launch uses sessionStorage and a one-time random state. A verified session requires both a random capability and the initiating browser’s binding; neither raw launch JWTs nor capabilities are placed in URLs. The wrapper offers a new-window fallback. If the LMS/browser changes the storage partition between login and callback, reopen the activity in a new window from the LMS. Real iframe behavior still requires interoperability testing.

## Proficiency delivery

The server uses the skill page’s current practical selection: `skills.level`, falling back to the latest practical assessment by `assessed_at`. Levels are sent directly as 1–5 with `scoreMaximum: 5`; a target never changes the denominator. Unknown proficiency sends no score and does not clear an existing grade. The result may be self-assessed and does not certify proficiency.

Database triggers queue changes to skills and assessment history for consented resource links. The worker resolves the current result, skips unchanged levels, and sends updates including decreases. Revision checks and leases prevent ordinary concurrent deliveries; the stored event timestamp is retained across retries, as required for the LMS to reject stale results. An external network timeout can leave delivery uncertain, so retries may repeat the same score and timestamp. No exactly-once network delivery claim is made.

Schedule an authenticated **POST** to `/api/lti/worker` using `Authorization: Bearer <LTI_WORKER_SECRET>` in the hosting environment’s scheduler. Each call processes up to two eligible jobs, with exponential backoff capped at one hour and eight attempts per revision. Choose frequency/capacity for expected volume. The worker also removes expired launch transactions and sessions. No scheduler has been installed by this change. Learners can also use **Send current proficiency** to request/retry delivery while in the activity. They see pending, delivered, failed or unassessed status.

The OAuth client assertion is signed server-side. JWKS, token and grade HTTP requests use pinned public DNS results, reject private/reserved addresses, limit response size, enforce timeouts and reject redirects. JWT-supplied key URLs are not followed. Missing score scope or line item disables the sharing control.

## Verification and release gates

Automated checks cover signed launches, invalid JWT signatures/claims/roles, unknown keys, deployment mismatch, one-time state use, wrong-browser binding, cross-origin linking, cross-user identity access, registration/provider revocation, private-table access, trigger/queue behavior, separate grade consent, signed service assertions and score payloads. Browser tests cover the picker at desktop/mobile sizes, sign-in and expired-launch states using fixture API responses.

On 2026-09-11 the complete local Supabase migration replay and error-level schema lint passed after synchronization with staging. Both LTI migrations were then applied to staging project ussqcmfxbbtncjvepuyn; a follow-up dry run confirmed its database is up to date.

Before activation: verify staging API packaging and framing, install worker scheduling and secrets, and run end-to-end LMS sandbox tests with two learners and two course contexts. Confirm grade creation, updates/decreases, retry behavior, revocation, and third-party-storage restrictions. Test at least two independent LMS implementations before making broad compatibility claims.

Specifications: [LTI Core 1.3](https://www.imsglobal.org/spec/lti/v1p3/), [Deep Linking 2.0](https://www.imsglobal.org/spec/lti-dl/v2p0/), [Assignment and Grade Services 2.0](https://www.imsglobal.org/spec/lti-ags/v2p0/).

### Verification recorded for this implementation

- Full Vitest suite: 496 passed across 71 files with two workers. Earlier concurrent runs exposed intermittent failures in unchanged team/employer tests; these did not recur in the final run.
- Focused LTI suite after the additional account-switch regression: 97 passed across seven files.
- Isolated PostgreSQL: 29 configuration checks and 23 runtime/permission/queue checks passed.
- Browser suite: five checks passed, including fixture LMS views at desktop/mobile sizes.
- Full frontend build with local public placeholders passed; lint passed with existing warnings. The app shell returned HTTP 200 with its framing policy. A public JWKS request succeeded and a private-address request was rejected.
- Updated 2026-09-11: synchronized with staging 3822cc3, replayed the full local database successfully, passed database lint, and applied the two new LTI migrations to staging. Current isolated PostgreSQL checks: 31 configuration/deletion checks and 23 runtime checks. The refreshed full Vitest suite and frontend build passed. Live LMS interoperability remains a separate activation gate.
