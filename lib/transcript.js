// Turning YouTube captions into timestamped lines, and working out which meeting a video is.

const stamp = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

// YouTube json3 caption file -> [[seconds, text], ...] in ~200-character chunks
export function linesFromJson3(j) {
  const out = [];
  let buf = "", t0 = null;
  for (const e of j.events || []) {
    if (!e.segs) continue;
    const s = e.segs.map((x) => x.utf8 || "").join("").replace(/\s+/g, " ").trim();
    if (!s) continue;
    if (t0 === null) t0 = Math.floor((e.tStartMs || 0) / 1000);
    buf += " " + s;
    if (buf.length > 200) { out.push([t0, buf.trim()]); buf = ""; t0 = null; }
  }
  if (buf.trim()) out.push([t0 || 0, buf.trim()]);
  return out;
}

// Segments scraped from the YouTube transcript panel: [["1:02:03", "text"], ...]
export function linesFromSegments(segs) {
  const toSec = (ts) => String(ts).split(":").map(Number).reduce((a, n) => a * 60 + n, 0);
  const out = [];
  let buf = "", t0 = null;
  for (const [ts, text] of segs) {
    if (!text) continue;
    if (t0 === null) t0 = toSec(ts);
    buf += " " + text;
    if (buf.length > 200) { out.push([t0, buf.trim()]); buf = ""; t0 = null; }
  }
  if (buf.trim()) out.push([t0 || 0, buf.trim()]);
  return out;
}

export const linesToText = (lines) => lines.map(([t, s]) => `[${stamp(t)}] ${s}`).join("\n");

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// Find a date in free text: 9/22/2026, 09-21-2026, 9.3.2026, "September 28, 2026", "Augest 17 2026", "Sept_14_2026".
export function dateFromText(text) {
  const t = String(text || "");
  let m = t.match(/(\d{1,2})[\/.\-_](\d{1,2})[\/.\-_](\d{4})/);
  if (m) return iso(+m[3], +m[1], +m[2]);
  m = t.match(/([A-Za-z]{3,10})[\s._-]+(\d{1,2})(?:st|nd|rd|th)?,?[\s._-]+(\d{4})/);
  if (m) { const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()); if (mi >= 0) return iso(+m[3], mi + 1, +m[2]); }
  m = t.match(/(\d{1,2})[\/.\-_](\d{1,2})[\/.\-_](\d{2})(?!\d)/);
  if (m) return iso(2000 + +m[3], +m[1], +m[2]);
  return "";
}
function iso(y, mo, d) {
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Which body is this video? channel is "county" | "city" | "" (unknown).
// Returns { body, fromTitle } where body is a tracked body id, "budget", "other", or null (can't tell).
export function classify(title, lines, channel = "") {
  const t = (title || "").toLowerCase();
  const isCity = channel === "city" || (!channel && /kgov/.test(t));
  if (isCity) {
    if (/budget/.test(t) && !/council/.test(t)) return { body: "other", fromTitle: true };
    if (/common council/.test(t)) return { body: "city-council", fromTitle: true };
    if (/plan(ning)? commission/.test(t)) return { body: "city-plan", fromTitle: true };
    if (/zoning appeals|\bbza\b/.test(t)) return { body: "city-bza", fromTitle: true };
    if (/board of (public )?works/.test(t)) return { body: "city-works", fromTitle: true };
    if (channel === "city") return { body: "other", fromTitle: true };
  }
  if (/budget/.test(t)) return { body: "budget", fromTitle: true };
  if (/plan(ning)? commission/.test(t)) return { body: "plan", fromTitle: true };
  if (/drainage|storm ?water|zoning|appeals|must meeting|correction|jrac|safety/.test(t)) return { body: "other", fromTitle: true };
  if (/council/.test(t)) return { body: "council", fromTitle: true };
  if (/commiss?ioner/.test(t)) return { body: "commissioners", fromTitle: true };
  // No useful title (e.g. "LIVE - Howard County Government, IN"): whichever body is named first in the opening talk wins.
  const head = (lines || []).slice(0, 25).map((l) => l[1]).join(" ").toLowerCase();
  const signals = [
    ["plan", /plan commission/],
    ["other", /board of (zoning )?appeals|zoning appeals|drainage board|storm ?water|community corrections/],
    ["budget", /budget (presentations|hearing)/],
    ["council", /council meeting|county council|meeting for the council|welcome to the council|councilman|councilwoman/],
    ["commissioners", /commissioners|now in session|hear ye|here you/],
  ];
  let best = null, bestAt = Infinity;
  for (const [body, re] of signals) {
    const m = head.match(re);
    if (m && m.index < bestAt) { best = body; bestAt = m.index; }
  }
  return { body: best, fromTitle: false };
}
