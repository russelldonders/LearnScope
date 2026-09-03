# Profile ownership, sharing and portability

Status: proposed contract for the multi-context LMS programme.

## Ownership

A record has one authoritative owning profile. Personal records are controlled
by the learner. Organisation records are controlled by the organisation within
the employment context. A record may describe the same real-world activity as
another record without becoming jointly editable.

Every share or import must answer:

- who owns the source;
- which profile or organisation receives access;
- which fields or records are included;
- whether access is live or a dated snapshot;
- whether the recipient may only view or may respond; and
- when the permission expires or is revoked.

Unlinking never deletes the underlying source record.

## Personal to organisation

The learner can share an entire professional view, categories or selected
records. A live grant exposes the current selected data until revoked. A
snapshot captures what was supplied at a point in time and remains an auditable
historical submission after future access ends.

An organisation never receives edit access to the learner's personal source.
Related records are not implicitly exposed through joins; each included item
must be inside the grant's scope.

## Organisation to personal

Eligible work learning, credentials, achievements, role history and evidence
are offered to the learner for personal acceptance. Acceptance creates or links
a learner-owned record with immutable provenance. It is not a transfer of the
employer's source record.

Material source changes become proposed updates; they do not silently rewrite
the personal record. A personal copy can survive employment while retaining
issuer, source version, completion date and verification state.

Organisation records declare an export policy:

- `not_exportable`: remains inside the organisation context;
- `reference`: a personal record may retain a provenance reference;
- `snapshot`: a dated portable copy can be accepted;
- `verified`: a portable copy retains organisation verification; or
- `live`: continued validity depends on an active source relationship.

Course completion is evidence of completing defined learning. It does not by
itself verify practical skill proficiency.

## Revocation and offboarding

Revocation stops future live reads and updates. It does not erase legitimate
historical organisation records or learner-owned portable records already
accepted. Audit events retain who granted, accepted, revoked or imported data
without retaining more content than is necessary.

