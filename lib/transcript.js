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

// Which body is this video? Uses the title first, then the first few minutes of talk.
// Returns "council" | "commissioners" | "plan" | "budget" | "other" | null (can't tell).
export function classify(title, lines) {
  const t = (title || "").toLowerCase();
  if (/budget/.test(t)) return "budget";
  if (/plan(ning)? commission/.test(t)) return "plan";
  if (/drainage|storm ?water|zoning|appeals|must meeting|correction|jrac|safety/.test(t)) return "other";
  if (/council/.test(t)) return "council";
  if (/commiss?ioner/.test(t)) return "commissioners";
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
  if (best) return best;
  return null;
}
