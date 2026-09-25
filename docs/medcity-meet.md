# Live classes on Medcity Meet

Medcity Meet (meet.medcitylms.in) is our own class platform. It replaces Zoom for live classes because it has no limit on how many classes run at the same time.

## Connect it (once per academy)

1. In Meet: Integrations → Create key (name it after this academy) → copy the `mk_live_...` key.
2. In Meet: Integrations → Add endpoint → `https://<this academy's LMS domain>/api/webhooks/meet` → copy the `whsec_...` secret.
3. Here: Admin → Settings → Integrations → Medcity Meet → paste both → Save → Test.

Or set `MEET_API_KEY` and `MEET_WEBHOOK_SECRET` (and optionally `MEET_API_URL`) in the environment.

## What happens then

- New classes without a link typed in by hand get a Meet room: straight away for a few, and a fortnight ahead of the class for a term (the same scheduled job that made Zoom meetings). The class's `provider` becomes `MEET`, `providerMeetingId` holds the Meet code.
- The class's join link is `/live/<session id>/join`. Opening it (or pressing Join, or the app's join call) takes attendance as before, then sends the person into Meet with a link made for them: learners by name with no second login, staff as host. A forwarded link signs nobody else in, and the Meet room refuses anyone who did not come from here.
- Moving or cancelling a class moves or cancels the Meet room.
- When a class ends, Meet posts attendance: first join, last leave, minutes in the room. Learners are matched by id; a teacher's register mark stands, except an absence, which a join corrects.
- A recording appears on the class a few minutes later. The file stays in Meet's storage; `/api/assets/<id>` asks Meet for a fresh link after the usual permission check.
- Classes that already have a Zoom meeting stay on Zoom. With Meet not connected, everything works exactly as before.

## Code

- `src/lib/medcity-meet.ts`: API client, join links, webhook signature, recording asset keys
- `src/lib/zoom-sessions.ts`: `provisionMeetings` picks Meet when connected, else Zoom; move and cancel follow the class's provider
- `src/lib/live-join.ts` and `src/app/live/[id]/join`: the personal join link
- `src/app/api/webhooks/meet/route.ts`: started, ended, attendance, recording
- Meet's API: https://github.com/sreejith-medcity/meet/blob/main/deploy/LMS-API.md
