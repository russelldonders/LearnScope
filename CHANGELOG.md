# Changelog

## 2026-11-15

- Hardened AI skill-course series builds for mobile by moving long AI calls into durable background jobs with short status polling, and added an always-visible Abort build control that preserves completed courses while cancelling the remainder; a finished course can no longer be saved once its build is aborted.
- Added privacy-safe AI usage metering across every Anthropic-powered feature, including token counts, latency, provider errors and request-time cost estimates.
- Added a platform-admin AI usage dashboard with feature, model and organisation breakdowns; prompts and generated content are never stored in the usage ledger.
- Added a bulk platform-admin course-series builder that turns selected skills into editable courses for each knowledge-matrix level, with optional immediate Global catalogue publication.

## 2026-11-14

- Added an AI-assisted provider workflow that generates complete draft courses as native, editable Page Builder content.
- Added transactional course creation with organisation-scoped access controls and database integration tests.
- Routed course generation through the existing serverless dispatcher to stay within Vercel Hobby's 12-function deployment limit.
