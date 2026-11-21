# Google Meet attendance

LearnScope can create a Google Meet for a scheduled course cohort session,
record learner launches, and import participant join/leave sessions to calculate
attendance against the scheduled session window.

## Google Cloud setup

1. Create or select a Google Cloud project.
2. Enable the Google Meet REST API.
3. Configure the OAuth consent screen. The integration requests `openid`,
   `email`, `profile`, and
   `https://www.googleapis.com/auth/meetings.space.created`.
4. Create a Web application OAuth client.
5. Add the callback URLs for each environment, for example:
   - `http://localhost:5173/google-meet/callback`
   - `https://staging.example.com/google-meet/callback`
   - `https://example.com/google-meet/callback`
6. Set `VITE_GOOGLE_CLIENT_ID` in the client/build environment and
   `GOOGLE_CLIENT_SECRET` only in the serverless runtime environment.

The `meetings.space.created` scope is classified by Google as sensitive, so a
public production OAuth app may require Google verification.

## Behaviour

- A provider connects the Google account that will own the meeting space.
- Creating a Meet stores Google's stable `spaces/...` resource name and the
  join URI against the cohort session.
- A learner connects their Google identity once. LearnScope uses the stable
  Google account ID, not an email address, to match attendance.
- Clicking **Join Google Meet** writes a launch event before redirecting.
- After the scheduled end, opening the course attempts a throttled attendance
  refresh. Providers can also use **Refresh attendance**.
- Attendance is the union of the learner's participant sessions intersected
  with the scheduled start/end window. Overlapping devices are not
  double-counted and the result is capped at 100%.
- Anonymous and telephone attendees remain unresolved for provider review.

Google OAuth tokens are stored in `external_connections`, which has RLS enabled
without authenticated client policies. Token access is limited to the
server-side service-role connector.
