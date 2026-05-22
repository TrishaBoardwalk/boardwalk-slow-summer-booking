// api/availability.js
// GET /api/availability?activity=Floating%20Ocean%20Sound%20Bath
// Returns a map of session date (YYYY-MM-DD) -> { confirmed, spacesLeft, capacity, waitlistCount }.
// Used by the guest booking page to render real-time capacity per Thursday.

import { ACTIVITIES, computeAvailability } from "../lib/notion.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*"); // safe — read-only

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const activity = req.query.activity || "Floating Ocean Sound Bath";
  if (!ACTIVITIES[activity]) {
    return res.status(400).json({ error: "Unknown activity: " + activity });
  }

  try {
    const map = await computeAvailability(activity);
    return res.status(200).json({
      activity,
      capacity: ACTIVITIES[activity].capacity,
      sessions: map
    });
  } catch (err) {
    console.error("availability error:", err);
    return res.status(500).json({ error: "Availability lookup failed" });
  }
}
