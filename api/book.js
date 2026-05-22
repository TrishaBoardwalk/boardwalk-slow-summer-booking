// api/book.js
// POST /api/book
// Body: { activity, sessionDate, guestName, roomNumber, partySize, contactMethod, waiverConfirmed }
//
// Validates the request, recomputes availability server-side (never trust the client),
// and writes either a Confirmed booking or a Waitlisted entry to Notion.
// Returns { ok: true, status: "Confirmed" | "Waitlisted", waitlistPosition?, bookingPageId }.
//
// Note: contactDetail (phone/email) is no longer collected on the guest page —
// the team looks the guest up by room number in Duve. Field still accepted for
// front-desk dashboard bookings if passed.

import { ACTIVITIES, queryBookingsBySession, createBookingPage, getSessionsFor } from "../lib/notion.js";

function bad(res, msg) { return res.status(400).json({ ok: false, error: msg }); }

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ ok: false, error: "Method not allowed" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return bad(res, "Invalid JSON"); }
  }
  if (!body) return bad(res, "Missing body");

  const {
    activity,
    sessionDate,
    guestName,
    roomNumber,
    partySize,
    contactMethod,
    contactDetail,
    waiverConfirmed
  } = body;

  // -- Validation -----------------------------------------------------------
  if (!ACTIVITIES[activity]) return bad(res, "Unknown activity");
  if (!getSessionsFor(activity).includes(sessionDate)) return bad(res, "Session date is not part of the published schedule");
  if (!guestName || guestName.length < 2 || guestName.length > 80) return bad(res, "Guest name required");
  if (!roomNumber || roomNumber.length > 20) return bad(res, "Room number required");
  const size = parseInt(partySize, 10);
  if (!Number.isFinite(size) || size < 1 || size > ACTIVITIES[activity].capacity) return bad(res, "Party size out of range");
  if (waiverConfirmed !== true) return bad(res, "Waiver must be accepted");
  // contactDetail is optional on guest bookings now — Duve resolves room → contact.
  if (contactDetail && contactDetail.length > 200) return bad(res, "Contact detail too long");

  const cfg = ACTIVITIES[activity];

  // -- Server-side capacity check ------------------------------------------
  let existing;
  try {
    existing = await queryBookingsBySession(activity, sessionDate);
  } catch (e) {
    console.error("queryBookingsBySession failed:", e);
    return res.status(500).json({ ok: false, error: "Could not check availability" });
  }

  const confirmed = existing.filter(b => b.status === "Confirmed").reduce((s, b) => s + b.partySize, 0);
  const spacesLeft = cfg.capacity - confirmed;

  // Duplicate check: same guest + room + session already booked & active?
  const dup = existing.find(b =>
    b.guestName?.toLowerCase() === guestName.toLowerCase() &&
    b.roomNumber === roomNumber &&
    ["Confirmed", "Waitlisted", "Offered"].includes(b.status)
  );
  if (dup) {
    return res.status(409).json({
      ok: false,
      error: "You're already booked or on the waitlist for this session.",
      existingStatus: dup.status
    });
  }

  let status, waitlistPosition = null;
  if (size <= spacesLeft) {
    status = "Confirmed";
  } else {
    status = "Waitlisted";
    waitlistPosition = existing.filter(b => b.status === "Waitlisted").length + 1;
  }

  try {
    const page = await createBookingPage({
      activity,
      sessionDate,
      sessionTime: cfg.time,
      guestName: guestName.trim(),
      roomNumber: roomNumber.trim(),
      partySize: size,
      contactMethod: contactMethod || "Front desk",
      contactDetail: (contactDetail || "").trim(),
      status,
      waitlistPosition,
      source: "Guest app"
    });

    return res.status(200).json({
      ok: true,
      status,
      waitlistPosition,
      bookingPageId: page.id
    });
  } catch (e) {
    console.error("createBookingPage failed:", e);
    return res.status(500).json({ ok: false, error: "Booking save failed" });
  }
}
