// api/confirm-offer.js
// GET /api/confirm-offer?id=<notion-page-id>
//
// This is the link the guest taps inside the "a spot has opened up" message.
// It validates the offer is still within its 2-hour window, flips Status to Confirmed,
// and returns a friendly Boardwalk-branded HTML page so the guest sees a polished result.

import { findBookingById, updateBookingStatus, ACTIVITIES } from "../lib/notion.js";

const OFFER_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

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
</style>
</head>
<body><div class="card">${body}</div></body>
</html>`;
}

export default async function handler(req, res) {
  const id = req.query.id;
  res.setHeader("Cache-Control", "no-store");

  if (!id) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(400).send(pageShell("Missing booking", `
      <div class="icon">🌴</div>
      <h1>We can't find that link</h1>
      <p class="err">The booking ID is missing. Please reply to the message we sent you, or stop by the front desk and we'll sort it.</p>
    `));
  }

  let booking;
  try {
    booking = await findBookingById(id);
  } catch (e) {
    console.error("findBookingById failed:", e);
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");

  if (!booking) {
    return res.status(404).send(pageShell("Not found", `
      <div class="icon">🌴</div>
      <h1>We can't find that reservation</h1>
      <p>This link may have expired. Please pop by the front desk and we'll help you sort it.</p>
    `));
  }

  if (booking.status === "Confirmed") {
    return res.status(200).send(pageShell("Already confirmed", `
      <div class="icon">✨</div>
      <h1>You're already <span class="accent">confirmed</span></h1>
      <p>We have you down for the <strong>${booking.activity}</strong>.</p>
      <div class="meta">${booking.sessionDate} · ${booking.sessionTime}</div>
      <p class="small">See you there. 🌊</p>
    `));
  }

  if (booking.status !== "Offered") {
    return res.status(409).send(pageShell("Spot no longer available", `
      <div class="icon">🌊</div>
      <h1>This spot is no longer open</h1>
      <p>The window for this offer has closed and we've moved it to the next guest. We're sorry we missed you this time — there's always another sunset.</p>
      <p class="small">Stop by the front desk if you'd like to try another evening.</p>
    `));
  }

  // Check 2-hour window. If Offer Sent At is missing, the row is malformed —
  // reject the confirmation rather than defaulting to "now" (which would let
  // a guest confirm a stale offer forever).
  if (!booking.offerSentAt) {
    console.warn("confirm-offer: Offered row missing Offer Sent At", booking.id);
    return res.status(410).send(pageShell("Offer expired", `
      <div class="icon">🌅</div>
      <h1>This offer has expired</h1>
      <p>The window for this offer has closed. We've moved it to the next guest on the list.</p>
      <p class="small">Stop by the front desk if you'd still like to come.</p>
    `));
  }
  const offered = new Date(booking.offerSentAt).getTime();
  const elapsed = Date.now() - offered;
  if (elapsed > OFFER_WINDOW_MS) {
    // Expired — let the cron clean it up, but tell the guest now
    return res.status(410).send(pageShell("Offer expired", `
      <div class="icon">🌅</div>
      <h1>This offer has expired</h1>
      <p>More than two hours have passed since we sent the offer, so we've moved it to the next guest on the list.</p>
      <p class="small">If you'd still like to come, stop by the front desk and we'll see what we can do.</p>
    `));
  }

  try {
    await updateBookingStatus(booking.id, "Confirmed");
  } catch (e) {
    console.error("confirm-offer update failed:", e);
    return res.status(500).send(pageShell("Something went wrong", `
      <div class="icon">🌴</div>
      <h1>Something went wrong</h1>
      <p class="err">We couldn't confirm your spot just now. Please reply to the message we sent or stop by the front desk.</p>
    `));
  }

  return res.status(200).send(pageShell("Spot confirmed", `
    <div class="icon">🌴</div>
    <h1>Your spot is <span class="accent">yours</span></h1>
    <p>We're so glad you'll be joining us for the <strong>${booking.activity}</strong>.</p>
    <div class="meta">
      <strong>${booking.sessionDate}</strong> · ${booking.sessionTime}<br>
      ${ACTIVITIES[booking.activity]?.location || ''}
    </div>
    <p style="margin-top:20px;">We'll send a gentle reminder the morning of. Until then — slow down, enjoy the island. 🌺</p>
  `));
}
