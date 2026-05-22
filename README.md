# Boardwalk Slow Summer Booking Engine

Next-day-style booking engine for Slow Summer wellness activities — same architecture as the palapa engine, just pointed at the Slow Summer Bookings Notion database.

**Activity in this build:** Floating Ocean Sound Bath (Thursdays 6pm, June–August 2026, 6 floating beds per session).

## Architecture at a glance

| Piece | Purpose |
|---|---|
| `public/sound-bath.html` | Static guest booking page. Calls `/api/availability` and `/api/book`. |
| `api/availability.js` | GET — returns confirmed-party-size per session date. |
| `api/book.js` | POST — validates + writes booking. Server decides Confirmed vs Waitlisted. |
| `api/confirm-offer.js` | GET — link in the waitlist offer message. Flips Offered → Confirmed if still within 2hr window. |
| `api/check-offer-expiry.js` | Vercel cron, every 15 min — expires offers older than 2hr, auto-promotes next on waitlist when a seat opens. |
| `lib/notion.js` | Shared Notion client, schema knowledge, capacity math. |

The Cowork dashboard (`slow-summer-dashboard.html` from earlier in our session) handles all team-facing actions — book on behalf, cancel, mark-as-sent, view the daily Duve message queue. It reads/writes the same Notion DB. No team-side Teams notification needed.

## Environment variables (set in Vercel project settings)

| Variable | Value |
|---|---|
| `NOTION_TOKEN` | Same internal-integration token used by the palapa engine, as long as the integration has been shared with the Slow Summer Bookings database. |
| `NOTION_DB_ID` | `838290cd-d4c0-4345-9f4f-e9a95b450df2` (the Slow Summer Bookings database) |
| `CRON_SECRET` | Random long string. Required to invoke the cron endpoint externally. Vercel's built-in cron invocation passes this via the `Authorization: Bearer` header. |

To make sure your Notion integration can see the database, open the database in Notion → ••• menu → Connections → add the integration you used for the palapa engine.

## GitHub upload (web editor, because Chrome MCP can't push from disk)

Create a new repo `boardwalk-slow-summer-booking`. For each file in this folder, use **Add file → Create new file** in GitHub's web UI and **paste the entire file path including subfolders** into the filename field. Examples:

- `package.json`
- `vercel.json`
- `.gitignore`
- `README.md`
- `lib/notion.js`
- `api/availability.js`
- `api/book.js`
- `api/confirm-offer.js`
- `api/check-offer-expiry.js`
- `public/sound-bath.html`

Type the slash-separated path into the filename input — GitHub creates the subfolder for you. (Drag-and-drop strips the path, which is why this matters.)

## Vercel project

1. New project → import the GitHub repo.
2. Framework preset: "Other" (no build step needed).
3. Output directory: leave blank — Vercel auto-detects `public/` for static and `api/` for serverless.
4. Set the three env vars above.
5. Deploy.
6. After first deploy, hit `https://<your-vercel-url>/api/check-offer-expiry?secret=<your CRON_SECRET>` once in a browser to confirm the cron endpoint responds with a JSON summary.

The cron is configured in `vercel.json` (`*/15 * * * *` — every 15 minutes UTC). Vercel calls it automatically once the project is on a paid plan, or you can manually trigger via the dashboard.

## Notion database connection

The database already exists: [Slow Summer Bookings](https://www.notion.so/838290cdd4c043459f4fe9a95b450df2). It lives under **Slow Summer 2026 HQ**.

Schema (already created — listed here so you know what the code expects):

| Property | Type | Notes |
|---|---|---|
| Booking | Title | Auto-formatted "Guest — Activity — Date" |
| Booking ID | Unique ID (BK1, BK2…) | Auto |
| Guest Name | Text | |
| Room Number | Text | |
| Number of People | Number | |
| Activity | Select | Floating Ocean Sound Bath / Golden Hour / Hammock Cocooning / Garden Tour |
| Session Date | Date | |
| Session Time | Text | |
| Status | Select | Confirmed / Waitlisted / Offered / Cancelled / Attended / No Show |
| Waiver Confirmed | Checkbox | |
| Waitlist Position | Number | Only set when Status=Waitlisted (1 = next up) |
| Offer Sent At | Date+time | Timestamp the offer went out (2hr countdown starts here) |
| Contact Method | Select | WhatsApp / SMS / In-app chat / Email / Front desk |
| Contact Detail | Text | Phone, email, or app handle |
| Reminder Sent | Checkbox | Tracking flag for the dashboard |
| Feedback Sent | Checkbox | Tracking flag for the dashboard |
| Source | Select | Guest app / Front desk / Phone-in |
| Notes | Text | |
| Booking Submitted | Created time | Auto |
| Last Updated | Last edited time | Auto |

## How the flow runs end-to-end

1. **Guest opens** the booking page from the Duve app link (or front desk shares the URL).
2. **Browser** fetches `/api/availability` → renders Thursdays with live capacity badges.
3. **Guest picks a date**, reads description + waiver, ticks the consent box, fills name/room/contact, taps Reserve.
4. **`/api/book`** validates everything server-side, recomputes capacity from Notion (never trusts the client), then either:
   - Creates a `Confirmed` row, or
   - Creates a `Waitlisted` row with the correct position
5. **Guest sees** the matching confirmation screen.
6. **Cancellations + waitlist** happen via the team's Cowork dashboard. When a Confirmed row moves to Cancelled, the cron picks it up within 15 min and promotes the first Waitlisted guest to Offered (or the team can do it instantly from the dashboard).
7. **The offer message** (sent through Duve) includes a confirmation link of the shape `https://<vercel-url>/api/confirm-offer?id=<page-id>`. The guest taps it → `/api/confirm-offer` confirms the spot (if still within the 2hr window) and shows them a Boardwalk-branded "you're in" page.
8. **Every 15 min**, `/api/check-offer-expiry` sweeps for offers older than 2hrs and flips them to Cancelled, then re-runs the auto-promote pass so the next person on the waitlist gets offered.

## Brand reference

Brandbook v3.2 — September 2024.

| Color | Hex | Used for |
|---|---|---|
| Sand | `#f2ebe2` | Page background |
| Beige | `#e9dace` | Low-availability pill, hero gradient bottom |
| Palapa brown | `#ccb2a8` | Disabled button state |
| Seafoam | `#dbeced` | Selected-session ring, callouts |
| Boardwalk blue | `#00b3c2` | Focus rings, accent type |
| Dark teal | `#155864` | Primary type, button fill |

Fonts: Noto Serif Display (headings), Karla light (body), Playfair Display Italic (accents).

Tone: warm Caribbean, "barefoot luxury", short phrases.

## What to clone next once Sound Bath proves out

| Activity | Day | Time | Cap | Active |
|---|---|---|---|---|
| Golden Hour — Movement, Sound & Breath | Sun | 6pm | 8 | June only |
| Hammock Cocooning | Sun | 7pm | 6 | July + August |
| Garden Tour | Wed | 9am | 10 | June–August |

For each, clone `public/sound-bath.html` → `public/golden-hour.html` (etc.), swap activity name, waiver text, capacity, day-of-week, and active months in the `ACTIVITY` constants. No new API code needed — `lib/notion.js` already knows about all four activities, so `/api/availability?activity=Golden+Hour` returns the right schedule the moment the new page is deployed.

## Known constraints (carry-overs from the palapa build)

- Cowork sandbox can't reach external webhook hosts — that's why the Cowork dashboard handles team actions via the Notion MCP instead of calling out.
- Microsoft 365 connector is read-only for Teams (not used here, since we aren't messaging Teams).
- Notion API can't change colors on existing select options — set the Status colors manually in the Notion UI if you want to tweak them. The current ones are: Confirmed green, Waitlisted yellow, Offered orange, Cancelled red, Attended blue, No Show gray.
- GitHub web upload doesn't preserve nested folder paths — use the path-as-filename trick when pasting (above).
