// api/cancel.js
// Guest-facing cancellation.
//
// GET  /api/cancel?id=<notion-page-id>  → renders a friendly "are you sure?" page
// POST /api/cancel?id=<notion-page-id>  → marks Status=Cancelled in Notion,
//                                          immediately promotes the next waitlisted guest
//                                          on the same session to Offered (no 15-min wait),
//                                          returns a confirmation page.
//
// The cancel link lives on the booking confirmation screen and is embedded in
// the reminder messages the team sends via Duve.

import {
  findBookingById,
  updateBookingStatus,
  promoteNextWaitlistForSession,
  ACTIVITIES
} from "../lib/notion.js";

function pageShell(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — Boardwalk Aruba</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Karla:wght@300;400;500&family=Noto+Serif+Display:ital,wght@0,400;0,500;1,400&family=Playfair+Display:ital@1&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: light; }
  body {
    margin:0; min-height:100vh;
    background: linear-gradient(180deg, #f2ebe2 0%, #e9dace 100%);
    font-family: 'Karla', system-ui, sans-serif;
    font-weight: 300;
    color: #155864;
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
  }
  .card {
    background: #fff;
    border-radius: 20px;
    padding: 40px 30px;
    max-width: 480px;
    width: 100%;
    box-shadow: 0 10px 40px rgba(21,88,100,.12);
    text-align: center;
  }
  .icon { font-size: 48px; margin-bottom: 12px; }
  h1 {
    font-family: 'Noto Serif Display', Georgia, serif;
    font-weight: 400;
    font-size: 30px;
    color: #155864;
    margin: 0 0 14px;
  }
  .accent { font-family: 'Playfair Display', Georgia, serif; font-style: italic; color: #00b3c2; }
  p { font-size: 15.5px; line-height: 1.6; color: #155864; margin: 0 auto 14px; }
  .meta {
    background: #dbeced;
    border-radius: 12px;
    padding: 14px;
    margin-top: 18px;
    font-size: 14px;
    color: #155864;
  }
  .meta strong { font-weight: 500; }
  .small { font-size: 13px; color: #155864; opacity: .75; margin-top: 20px; }
  .err { color: #8a2f2f; }
  .actions { display: flex; flex-direction: column; gap: 10px; margin-top: 22px; }
  .btn {
    display: inline-block;
    padding: 14px 20px;
    border-radius: 12px;
    font-family: 'Karla', sans-serif;
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    text-decoration: none;
    letter-spacing: .02em;
  }
  .btn-danger { background: #8a2f2f; color: #f6f1e8; }
  .btn-danger:hover { background: #6c2323; }
  .btn-ghost { background: #fff; color: #155864; border: 1.5px solid #155864; }
  .btn-ghost:hover { background: #dbeced; }
</style>
</head>
<body><div class="card">${body}</div></body>
</html>`;
}

function getBookingId(req) {
  return (req.query && req.query.id) || null;
}

export default async function handler(req, res) {
  const id = getBookingId(req);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  if (!id) {
    return res.status(400).send(pageShell("Missing booking", `
      <div class="icon">🌴</div>
      <h1>We can't find that link</h1>
      <p class="err">The booking ID is missing. Please reply to the message we sent you, or stop by the front desk.</p>
    `));
  }

  let booking;
  try {
    booking = await findBookingById(id);
  } catch (e) {
    console.error("findBookingById failed:", e);
  }
  if (!booking) {
    return res.status(404).send(pageShell("Not found", `
      <div class="icon">🌴</div>
      <h1>We can't find that reservation</h1>
      <p>This link may have expired. Please pop by the front desk and we'll help.</p>
    `));
  }

  // Already cancelled / past — friendly state
  if (booking.status === "Cancelled") {
    return res.status(200).send(pageShell("Already cancelled", `
      <div class="icon">🌊</div>
      <h1>This spot is already <span class="accent">released</span></h1>
      <p>No further action needed.</p>
    `));
  }

  if (req.method === "POST") {
    // Actual cancellation
    try {
      await updateBookingStatus(booking.id, "Cancelled");
    } catch (e) {
      console.error("cancel update failed:", e);
      return res.status(500).send(pageShell("Something went wrong", `
        <div class="icon">🌴</div>
        <h1>We couldn't cancel just now</h1>
        <p class="err">Please reply to the message we sent or stop by the front desk and we'll sort it.</p>
      `));
    }

    // Immediately offer the next waitlisted guest on this session (best effort —
    // the 15-min cron is the safety net).
    let promoted = null;
    if (booking.status === "Confirmed") {
      try {
        promoted = await promoteNextWaitlistForSession(booking.activity, booking.sessionDate);
      } catch (e) {
        console.error("promoteNextWaitlistForSession failed:", e);
      }
    }

    const promotedNote = promoted
      ? `<p class="small">We've offered the spot to the next guest on the waitlist.</p>`
      : `<p class="small">Thanks for letting us know. We hope to see you for another evening soon.</p>`;

    return res.status(200).send(pageShell("Cancelled", `
      <div class="icon">🌴</div>
      <h1>Your spot is <span class="accent">released</span></h1>
      <p>Thanks — we've cancelled your reservation for the <strong>${booking.activity}</strong>.</p>
      <div class="meta">
        <strong>${booking.sessionDate}</strong> · ${booking.sessionTime}
      </div>
      ${promotedNote}
    `));
  }

  // GET — show "Are you sure?" confirmation page with a form that POSTs back.
  return res.status(200).send(pageShell("Cancel your reservation", `
    <div class="icon">🌴</div>
    <h1>Cancel your <span class="accent">spot</span>?</h1>
    <p>You're currently booked for the <strong>${booking.activity}</strong>.</p>
    <div class="meta">
      <strong>${booking.sessionDate}</strong> · ${booking.sessionTime}<br>
      ${ACTIVITIES[booking.activity]?.location || ''}
    </div>
    <p class="small">If you can't make it, please let us know so we can offer the spot to another guest on the waitlist.</p>
    <div class="actions">
      <form method="POST" action="/api/cancel?id=${encodeURIComponent(booking.id)}" style="margin:0;">
        <button class="btn btn-danger" type="submit" style="width:100%;">Yes, cancel my spot</button>
      </form>
      <a class="btn btn-ghost" href="https://boardwalk-slow-summer-booking.vercel.app/" style="display:block;">Keep my spot</a>
    </div>
  `));
}
