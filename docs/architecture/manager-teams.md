# Independent manager workspaces and teams

Status: proposed contract for the multi-context LMS programme.

## Independent manager mode

Manager is a workspace capability, not a permanent global account type. A
personal user may create an independent manager workspace and teams without an
employer. Membership is invitation- and consent-based.

An independent manager can create collaborative learning activities and skill
focuses, invite connections, participate as a learner, and see only activity
intentionally shared in that team. They cannot see a member's wider skills,
training, employer assignments or private evidence.

## Team ownership

A team has one of three modes:

- `independent`: owned through the manager workspace;
- `affiliated`: still independently owned, with explicitly selected activity
  visible to a linked organisation; or
- `organisation`: owned and administered by an organisation.

Linking a manager to an organisation does not transfer their teams. Affiliation
or transfer is a separate proposal with an explicit description of the changed
visibility and ownership.

Members who joined an independent team are not silently enrolled into an
organisation. Each member can accept the organisation relationship, remain in
the independent team or leave. Accepted transitions preserve membership dates,
learning activity, provenance, original ownership and transfer events.

## Collaborative learning

A team learning activity is distinct from an organisation assignment. It owns
the invitation, target date and team visibility. Each participant links their
own course record to the activity. Removing the association does not delete the
course.


## Manager actions across contexts (decided 2026-10-01)

Two management relationships exist and stay separate, because they are
different things: an independent team the learner chose to join, and an
organisation reporting line (`employer_management_relationships`, dated, with
indirect reports and an access scope). The organisation mode of teams
described above was not built; reporting lines took its place.

What a manager does is the same in both, so each action has one table that
records its context (`context_type` = `team` or `organisation`):

- `manager_skill_suggestions` — skills suggested to a learner;
- `manager_skill_ratings` — a manager's rating of a learner's skill;
- `manager_skill_targets` — targets set by someone else. These belong to
  their context and are separate from the learner's own `skill_targets`.

When a team or organisation link ends, its suggestions, ratings and targets
stay with the learner as dated history (context links are `ON DELETE SET
NULL`, with a name snapshot). Consent is unchanged: a team manager still sees
only skills a member shared with the team; an organisation manager only
organisation records plus what the learner shared with that employer.

Rollout (complete): phase 1 (`20261001110000`) added the tables, backfilled
them and mirrored the old `manager_team_*` / `employer_skill_*` tables by
trigger. Phase 2 moved readers and writers to the new tables; phase 3
(`20261002110000`) dropped the old tables and deleted the manager-set rows
from `skill_targets`. Phase 3 aborts without changing anything if any old
row lacks its copy, so the four migrations are safe to apply to Production
together, in order. `skill_targets.set_by_manager` is kept (always null)
until the app code that still filters on it has been released, then can be
dropped.

Phase 2 is complete. Learner screens read the new tables (2a suggestions,
2b targets), manager and organisation-admin screens do too (2c,
`20261002090000`), and every writer writes them directly (2d,
`20261002100000`): the mirror triggers are gone, and a team target is stored in `manager_skill_targets` with its
team rather than in the learner's `skill_targets`. The unified tables have no
delete path, so a suggestion or target can't be removed behind the
learner's back.

The profile export (`ProfileExport.jsx`) deliberately leaves out targets
others set, suggestions and ratings: it covers what the learner has
actually achieved (decided 2026-10-02).

Open follow-ups, not yet decided:

- A learner can't close or remove a target someone else set (previously a
  team-set target was an editable row of their own). This follows decision
  B, but a "not working towards this" option may be wanted.
- Records from an earlier membership of the same team stay visible to that
  team's current leader (decision C keeps them as history).
