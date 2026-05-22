// api/check-offer-expiry.js
// Vercel cron — runs every 15 minutes (see vercel.json).
// Two jobs:
//   1. Expire offers older than 2 hours → set Status=Cancelled.
//   2. Auto-promote the first Waitlisted guest to Offered, but only for sessions
//      that genuinely have an open seat AND no one currently Offered.
//
// Secured: requires CRON_SECRET via either Vercel's bearer header
// (Authorization: Bearer <secret>) or the ?secret query string.

import { notion, DB_ID, flattenBooking, ACTIVITIES, getSessionsFor, updateBookingStatus, queryBookingsBySession } from "../lib/notion.js";

const OFFER_WINDOW_MS = 2 * 60 * 60 * 1000;

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // dev convenience — but always set CRON_SECRET in prod
  const bearer = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  return bearer === secret || req.query.secret === secret;
}

async function expireStaleOffers() {
  // Query rows with Status = Offered
  const offered = [];
  let cursor;
  do {
    const r = await notion.databases.query({
      database_id: DB_ID,
      filter: { property: "Status", select: { equals: "Offered" } },
      start_cursor: cursor,
      page_size: 100
    });
    for (const p of r.results) offered.push(flattenBooking(p));
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);

  const now = Date.now();
  const expired = [];
  for (const b of offered) {
    if (!b.offerSentAt) continue;
    const sent = new Date(b.offerSentAt).getTime();
    if (now - sent > OFFER_WINDOW_MS) {
      try {
        await updateBookingStatus(b.id, "Cancelled");
        expired.push({ id: b.id, guest: b.guestName, activity: b.activity, sessionDate: b.sessionDate });
      } catch (e) {
        console.error("expire failed for", b.id, e.message);
      }
    }
  }
  return expired;
}

async function autoPromoteWaitlist() {
  // For every (activity, sessionDate) that has waitlisted guests but
  // (a) at least one open seat and (b) no one currently Offered → promote the first.
  const promotions = [];

  for (const activityName of Object.keys(ACTIVITIES)) {
    const cfg = ACTIVITIES[activityName];
    const todayIsoStr = new Date().toISOString().slice(0, 10);
    const sessions = getSessionsFor(activityName).filter(iso => iso >= todayIsoStr);

    for (const iso of sessions) {
      let rows;
      try {
        rows = await queryBookingsBySession(activityName, iso);
      } catch (e) {
        console.error("session query failed", activityName, iso, e.message);
        continue;
      }

      const confirmed = rows.filter(r => r.status === "Confirmed").reduce((s, r) => s + r.partySize, 0);
      const spacesLeft = cfg.capacity - confirmed;
      const offered = rows.filter(r => r.status === "Offered");
      const waitlist = rows.filter(r => r.status === "Waitlisted")
        .sort((a, b) => (a.waitlistPosition ?? 999) - (b.waitlistPosition ?? 999));

      if (spacesLeft <= 0) continue;
      if (offered.length > 0) continue;
      if (waitlist.length === 0) continue;

      // Promote the smallest-party waitlist guest that fits the open seats.
      const fit = waitlist.find(w => w.partySize <= spacesLeft) || waitlist[0];
      try {
        await updateBookingStatus(fit.id, "Offered", { offerSentAt: new Date().toISOString() });
        promotions.push({ id: fit.id, guest: fit.guestName, activity: activityName, sessionDate: iso });
      } catch (e) {
        console.error("promote failed", fit.id, e.message);
      }
    }
  }
  return promotions;
}

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized" });

  try {
    const expired = await expireStaleOffers();
    const promoted = await autoPromoteWaitlist();
    return res.status(200).json({
      ok: true,
      ranAt: new Date().toISOString(),
      expired,
      promoted,
      summary: `expired=${expired.length}, promoted=${promoted.length}`
    });
  } catch (e) {
    console.error("cron failed:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
