// Meeting calendars: every scheduled meeting shows up on "Coming up" before any documents exist.
// When the agenda packet arrives it lands on the same record (same body + date), so nothing is matched by hand.
//   Kokomo: the city's online calendar feed (free to read; repeat rules expanded here).
//   Howard County: the 2026 schedules the county posts as PDFs, typed in below. Update when the 2027 schedules are posted.
//   County Plan Commission: no posted schedule; its meetings have been on the 3rd Tuesday, so those dates are marked "usual schedule".
import { listMeetings, getMeeting, saveMeeting } from "./store.js";

const CITY_FEED = "https://www.cityofkokomo.org/_assets_/plugins/revizeCalendar/calendar_data_handler.php?webspace=kokomoin&relative_revize_url=//cms4.revize.com&protocol=https:";
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36" };
const COUNTY_ROOM = "Hearing Room 338, Howard County Administration Center, 220 N. Main St., Kokomo";
const WINDOW_DAYS = 120; // how far ahead to list meetings

// Howard County 2026 schedules (adopted Oct. 2025). Source PDFs on in.gov/counties/howard "Meetings, Minutes, and Agendas".
const COUNTY_2026 = {
  commissioners: { time: "4:00 p.m.", dates: ["2026-01-05", "2026-01-20", "2026-02-02", "2026-02-16", "2026-03-02", "2026-03-16", "2026-04-06", "2026-04-20", "2026-05-04", "2026-05-18", "2026-06-01", "2026-06-15", "2026-07-06", "2026-07-20", "2026-08-03", "2026-08-17", "2026-09-08", "2026-09-21", "2026-10-05", "2026-10-19", "2026-11-02", "2026-11-16", "2026-12-07", "2026-12-21"], source: "2026 Board of Commissioners meeting schedule" },
  council: { time: "4:00 p.m.", dates: ["2026-01-27", "2026-02-24", "2026-03-24", "2026-04-28", "2026-05-26", "2026-06-23", "2026-07-28", "2026-08-25", "2026-09-22", "2026-10-27", "2026-11-24", "2026-12-08"], source: "2026 County Council meeting schedule",
    special: [{ date: "2026-10-08", time: "4:00 p.m.", title: "Budget and tax levy adoption" }, { date: "2026-09-10", time: "4:00 p.m.", title: "Budget hearing" }, { date: "2026-08-11", time: "8:30 a.m.", title: "Council review of the budget" }] },
};
export const SCHEDULE_NOTES = { countyYear: 2026 };

// ---- dates as plain YYYY-MM-DD strings (no time zones)
const D = (s) => new Date(s + "T12:00:00Z");
const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => ymd(new Date(D(s).getTime() + n * 864e5));
const DOW = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const nthWeekday = (y, m, dow, n) => { // n = 1..5, or -1 for last
  if (n > 0) { const first = new Date(Date.UTC(y, m, 1, 12)); const d = 1 + ((dow - first.getUTCDay() + 7) % 7) + (n - 1) * 7; const out = new Date(Date.UTC(y, m, d, 12)); return out.getUTCMonth() === m ? ymd(out) : null; }
  const last = new Date(Date.UTC(y, m + 1, 0, 12)); return ymd(new Date(Date.UTC(y, m, last.getUTCDate() - ((last.getUTCDay() - dow + 7) % 7), 12)));
};
const clock = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); const p = h >= 12 ? "p.m." : "a.m."; return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${p}`; };

// Expand the repeat rules the city calendar uses (weekly by day; monthly "nth weekday"; monthly by day of month), with EXDATE/UNTIL/COUNT.
export function expandRule(rrule, start, from, to) {
  const lines = String(rrule || "").split(/\r?\n/);
  const rule = Object.fromEntries((lines.find((l) => l.startsWith("RRULE:")) || "RRULE:").slice(6).split(";").filter(Boolean).map((p) => p.split("=")));
  const ex = new Set(lines.filter((l) => l.startsWith("EXDATE")).flatMap((l) => l.split(":")[1].split(",")).map((v) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`));
  const extra = lines.filter((l) => l.startsWith("RDATE")).flatMap((l) => l.split(":")[1].split(",")).map((v) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`);
  const s0 = start.slice(0, 10);
  const until = rule.UNTIL ? `${rule.UNTIL.slice(0, 4)}-${rule.UNTIL.slice(4, 6)}-${rule.UNTIL.slice(6, 8)}` : "9999-12-31";
  const count = rule.COUNT ? Number(rule.COUNT) : Infinity, interval = Number(rule.INTERVAL || 1);
  const days = (rule.BYDAY || "").split(",").filter(Boolean);
  const out = new Set(extra);
  let n = 0;
  if (rule.FREQ === "WEEKLY") {
    const want = days.length ? days.map((d) => DOW[d.slice(-2)]) : [D(s0).getUTCDay()];
    const weekStart = addDays(s0, -D(s0).getUTCDay());
    for (let w = 0, ws = weekStart; ws <= to && ws <= until && n < count; w++, ws = addDays(ws, 7)) {
      if (w % interval) continue;
      for (const dow of want.sort()) { const d = addDays(ws, dow); if (d < s0 || d > until) continue; n++; if (n > count) break; out.add(d); }
    }
  } else if (rule.FREQ === "MONTHLY") {
    let y = D(s0).getUTCFullYear(), m = D(s0).getUTCMonth();
    for (let i = 0; i < 600 && n < count; i++, m++) {
      if (m > 11) { m = 0; y++; }
      if (i % interval) continue;
      const first = `${y}-${String(m + 1).padStart(2, "0")}-01`;
      if (first > to || first > until) break;
      const dates = [];
      if (days.length) for (const d of days) { const pre = d.match(/^(-?\d+)?([A-Z]{2})$/); const pos = Number(pre[1] || rule.BYSETPOS || 1); const x = nthWeekday(y, m, DOW[pre[2]], pos); if (x) dates.push(x); }
      else if (rule.BYMONTHDAY) dates.push(`${y}-${String(m + 1).padStart(2, "0")}-${String(rule.BYMONTHDAY).padStart(2, "0")}`);
      else dates.push(`${y}-${String(m + 1).padStart(2, "0")}-${s0.slice(8, 10)}`);
      for (const d of dates) { if (d < s0 || d > until) continue; n++; if (n > count) break; out.add(d); }
    }
  }
  return [...out].filter((d) => d >= from && d <= to && !ex.has(d)).sort();
}

const CITY_BODIES = [
  [/common council/i, "city-council"],
  [/^\s*(?:cancel+ed\s*-?\s*)?(?:kokomo\s+)?plann?(?:ing)? commission/i, "city-plan"],
  [/board of zoning appeals/i, "city-bza"],
  [/board of public works/i, "city-works"],
];
const cleanLoc = (s) => String(s || "").replace(/\s+,/g, ",").replace(/\s+/g, " ").replace(/\bunion St\b/i, "Union St").trim();

// Every scheduled city meeting in the window, from the city's calendar feed.
export function cityMeetings(events, from, to) {
  const out = [];
  for (const e of events || []) {
    const title = String(e.title || "").trim();
    const hit = CITY_BODIES.find(([re]) => re.test(title));
    if (!hit || /concert|appreciation|bike|softball/i.test(title)) continue;
    const time = String(e.start || "").slice(11, 16);
    const dates = e.rrule ? expandRule(e.rrule, e.start, from, to) : [String(e.start).slice(0, 10)].filter((d) => d >= from && d <= to);
    for (const date of dates) out.push({ body: hit[1], date, time: time ? clock(time) : "", location: cleanLoc(e.location) || "City Hall, 100 S. Union St., Kokomo", title: /reorgani/i.test(title) ? "Reorganization meeting" : "", cancelled: /cancel/i.test(title), source: "City of Kokomo calendar" });
  }
  return out;
}

export function countyMeetings(from, to) {
  const out = [];
  for (const [body, s] of Object.entries(COUNTY_2026)) {
    for (const date of s.dates) if (date >= from && date <= to) out.push({ body, date, time: s.time, location: COUNTY_ROOM, source: s.source });
    for (const x of s.special || []) if (x.date >= from && x.date <= to) out.push({ body, date: x.date, time: x.time, location: COUNTY_ROOM, title: x.title, source: s.source });
  }
  // County Plan Commission: third Tuesday (usual schedule; the county doesn't post Plan Commission dates)
  for (let d = from.slice(0, 8) + "01"; d <= to; d = addDays(d, 32).slice(0, 8) + "01") {
    const x = nthWeekday(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, 2, 3);
    if (x >= from && x <= to) out.push({ body: "plan", date: x, time: "", location: COUNTY_ROOM, estimated: true, source: "Usual schedule (third Tuesday); the county doesn't post Plan Commission dates" });
  }
  return out;
}

async function fetchCityEvents() {
  const res = await fetch(CITY_FEED, { headers: UA });
  if (!res.ok) throw new Error(`Kokomo calendar returned ${res.status}`);
  const j = await res.json();
  return Array.isArray(j) ? j : j.events || j.data || Object.values(j);
}

// Create or update a meeting record for every scheduled meeting; flag city meetings that vanished from the calendar.
export async function syncCalendars({ today, events } = {}) {
  const from = today, to = addDays(today, WINDOW_DAYS);
  let city = [], cityError = "";
  try { city = cityMeetings(events || (await fetchCityEvents()), from, to); } catch (e) { cityError = e.message; }
  const sched = [...city, ...countyMeetings(from, to)];
  const seen = new Set();
  let created = 0, updated = 0;
  for (const s of sched) {
    const id = `${s.body}-${s.date}`;
    if (seen.has(id)) continue;
    seen.add(id);
    let m = await getMeeting(id);
    const scheduled = { time: s.time, location: s.location, title: s.title || "", source: s.source, estimated: !!s.estimated, cancelled: !!s.cancelled, missing: false };
    if (!m) {
      m = { id, body: s.body, date: s.date, status: "waiting", scheduled, createdAt: new Date().toISOString(), fromCalendar: true };
      if (s.cancelled) { m.cancelled = true; m.cancelledByCalendar = true; }
      await saveMeeting(m); created++;
      continue;
    }
    const before = JSON.stringify([m.scheduled, m.cancelled]);
    m.scheduled = { ...(m.scheduled || {}), ...scheduled, missing: false };
    if (s.cancelled && !m.packetUrl) { m.cancelled = true; m.cancelledByCalendar = true; }
    else if (!s.cancelled && m.cancelledByCalendar) { delete m.cancelled; delete m.cancelledByCalendar; }
    if (JSON.stringify([m.scheduled, m.cancelled]) !== before) { await saveMeeting(m); updated++; }
  }
  // A city meeting that was on the calendar and isn't anymore: "may be canceled" (only if the feed loaded, and no agenda came)
  let missing = 0;
  if (!cityError) {
    for (const m of await listMeetings()) {
      if (!m.body.startsWith("city-") || m.date < from || m.date > to || !m.scheduled || seen.has(m.id) || m.packetUrl) continue;
      if (!m.scheduled.missing) { m.scheduled.missing = true; await saveMeeting(m); missing++; }
    }
  }
  return { scheduled: sched.length, created, updated, missing, cityError };
}
