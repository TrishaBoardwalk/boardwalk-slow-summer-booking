// lib/notion.js
// Shared Notion helpers for the Slow Summer booking engine.
// All functions assume NOTION_TOKEN and NOTION_DB_ID env vars are set on Vercel.

import { Client } from "@notionhq/client";

export const notion = new Client({ auth: process.env.NOTION_TOKEN });
export const DB_ID = process.env.NOTION_DB_ID;

// -----------------------------------------------------------------------------
// Activity catalog — single source of truth for capacity and schedule.
// ----------------------------------------------------------------------------
export const ACTIVITIES = {
  "Floating Ocean Sound Bath": {
    time: "6:00 PM",
    capacity: 6,
    dayOfWeek: 4, // Thursday
    months: [5, 6, 7], // June=5, July=6, August=7 (0-indexed)
    year: 2026,
    location: "Boardwalk Beach"
  },
  "Golden Hour": {
    time: "6:00 PM", capacity: 8, dayOfWeek: 0, months: [5], year: 2026, location: "Boardwalk Garden"
  },
  "Hammock Cocooning": {
    time: "7:00 PM", capacity: 6, dayOfWeek: 0, months: [6, 7], year: 2026, location: "Boardwalk Garden"
  },
  "Garden Tour": {
    time: "9:00 AM", capacity: 10, dayOfWeek: 3, months: [5, 6, 7], year: 2026, location: "Boardwalk Garden"
  }
};

// ----------------------------------------------------------------------------
// Date helpers
// ----------------------------------------------------------------------------
function pad(n) { return n < 10 ? "0" + n : "" + n; }
export function isoDate(d) {
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
export function todayIso() { return isoDate(new Date()); }

export function getSessionsFor(activityName) {
  const cfg = ACTIVITIES[activityName];
  if (!cfg) return [];
  const out = [];
  for (const m of cfg.months) {
    const last = new Date(cfg.year, m + 1, 0).getDate();
    for (let day = 1; day <= last; day++) {
      const d = new Date(cfg.year, m, day);
      if (d.getDay() === cfg.dayOfWeek) out.push(isoDate(d));
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// Property readers — flatten Notion's verbose page shape into a clean object.
// ----------------------------------------------------------------------------
function readText(prop) {
  if (!prop) return "";
  if (prop.title) return prop.title.map(t => t.plain_text).join("");
  if (prop.rich_text) return prop.rich_text.map(t => t.plain_text).join("");
  return "";
}
function readNumber(prop) { return prop && typeof prop.number === "number" ? prop.number : null; }
function readSelect(prop) { return prop && prop.select ? prop.select.name : null; }
function readDate(prop) { return prop && prop.date ? prop.date.start : null; }
function readCheckbox(prop) { return !!(prop && prop.checkbox); }

export function flattenBooking(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    url: page.url,
    bookingTitle: readText(p["Booking"]),
    guestName: readText(p["Guest Name"]),
    roomNumber: readText(p["Room Number"]),
    partySize: readNumber(p["Number of People"]) || 1,
    activity: readSelect(p["Activity"]),
    sessionDate: readDate(p["Session Date"]),
    sessionTime: readText(p["Session Time"]),
    status: readSelect(p["Status"]),
    waiverConfirmed: readCheckbox(p["Waiver Confirmed"]),
    waitlistPosition: readNumber(p["Waitlist Position"]),
    offerSentAt: readDate(p["Offer Sent At"]),
    contactMethod: readSelect(p["Contact Method"]),
    contactDetail: readText(p["Contact Detail"]),
    reminderSent: readCheckbox(p["Reminder Sent"]),
    feedbackSent: readCheckbox(p["Feedback Sent"]),
    source: readSelect(p["Source"]),
    notes: readText(p["Notes"]),
    submittedAt: page.created_time,
    updatedAt: page.last_edited_time
  };
}

// ----------------------------------------------------------------------------
// Queries
// ----------------------------------------------------------------------------
export async function queryAllBookingsForActivity(activityName) {
  const out = [];
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: DB_ID,
      filter: {
        property: "Activity",
        select: { equals: activityName }
      },
      start_cursor: cursor,
      page_size: 100
    });
    for (const p of res.results) out.push(flattenBooking(p));
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return out;
}

export async function queryBookingsBySession(activityName, sessionIso) {
  const res = await notion.databases.query({
    database_id: DB_ID,
    filter: {
      and: [
        { property: "Activity", select: { equals: activityName } },
        { property: "Session Date", date: { equals: sessionIso } }
      ]
    },
    page_size: 100
  });
  return res.results.map(flattenBooking);
}

// ----------------------------------------------------------------------------
// Capacity: map of sessionIso -> { confirmed (sum of party sizes), spacesLeft }
// ----------------------------------------------------------------------------
export async function computeAvailability(activityName) {
  const cfg = ACTIVITIES[activityName];
  if (!cfg) return {};
  const all = await queryAllBookingsForActivity(activityName);
  const sessions = getSessionsFor(activityName);
  const map = {};
  for (const iso of sessions) {
    const rows = all.filter(b => b.sessionDate === iso);
    const confirmed = rows.filter(b => b.status === "Confirmed").reduce((s, b) => s + b.partySize, 0);
    const waitlistCount = rows.filter(b => b.status === "Waitlisted").length;
    map[iso] = {
      confirmed,
      spacesLeft: Math.max(0, cfg.capacity - confirmed),
      capacity: cfg.capacity,
      waitlistCount
    };
  }
  return map;
}

// ----------------------------------------------------------------------------
// Mutations
// ----------------------------------------------------------------------------
function txt(s) { return [{ type: "text", text: { content: s || "" } }]; }

export async function createBookingPage({ activity, sessionDate, sessionTime, guestName, roomNumber, partySize, contactMethod, contactDetail, status, waitlistPosition, source }) {
  const properties = {
    "Booking": { title: txt(`${guestName} — ${activity} — ${sessionDate}`) },
    "Guest Name": { rich_text: txt(guestName) },
    "Room Number": { rich_text: txt(roomNumber) },
    "Number of People": { number: partySize },
    "Activity": { select: { name: activity } },
    "Session Date": { date: { start: sessionDate } },
    "Session Time": { rich_text: txt(sessionTime) },
    "Status": { select: { name: status } },
    "Waiver Confirmed": { checkbox: true },
    "Contact Method": { select: { name: contactMethod || "Front desk" } },
    "Contact Detail": { rich_text: txt(contactDetail || "") },
    "Source": { select: { name: source || "Guest app" } }
  };
  if (status === "Waitlisted" && waitlistPosition != null) {
    properties["Waitlist Position"] = { number: waitlistPosition };
  }
  return await notion.pages.create({
    parent: { database_id: DB_ID },
    properties
  });
}

export async function updateBookingStatus(pageId, status, extra = {}) {
  const properties = { "Status": { select: { name: status } } };
  if (status === "Confirmed") {
    properties["Waitlist Position"] = { number: null };
  }
  if (extra.offerSentAt) {
    properties["Offer Sent At"] = { date: { start: extra.offerSentAt } };
  }
  if (extra.waitlistPosition != null) {
    properties["Waitlist Position"] = { number: extra.waitlistPosition };
  }
  return await notion.pages.update({ page_id: pageId, properties });
}

export async function findBookingById(pageId) {
  try {
    const page = await notion.pages.retrieve({ page_id: pageId });
    return flattenBooking(page);
  } catch (e) {
    return null;
  }
}
