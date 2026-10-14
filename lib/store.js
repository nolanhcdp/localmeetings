// Storage on Upstash Redis (Vercel Marketplace, free tier). REST API, no packages.
const findEnv = (suffix) => {
  for (const k of ["KV_" + suffix, "UPSTASH_REDIS_" + suffix]) if (process.env[k]) return process.env[k];
  const isUrl = suffix.includes("URL");
  const k = Object.keys(process.env).find((n) => n.endsWith("_" + suffix) && /^https?:\/\//.test(process.env[n]) === isUrl);
  return k ? process.env[k] : undefined;
};
const URL_ = () => findEnv("REST_API_URL") || findEnv("REST_URL");
const TOKEN = () => findEnv("REST_API_TOKEN") || findEnv("REST_TOKEN");

export async function redis(...cmds) {
  if (!URL_() || !TOKEN()) throw new Error("Storage isn't connected. Add Upstash Redis to the Vercel project.");
  const res = await fetch(`${URL_()}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN()}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!res.ok) throw new Error(`Storage error ${res.status}`);
  const out = await res.json();
  for (const r of out) if (r.error) throw new Error(`Storage error: ${r.error}`);
  return out.map((r) => r.result);
}

export async function getJSON(key) {
  const [v] = await redis(["GET", key]);
  return v ? JSON.parse(v) : null;
}
export async function setJSON(key, value) {
  await redis(["SET", key, JSON.stringify(value)]);
  return value;
}
export async function getMany(keys) {
  if (!keys.length) return [];
  const [vals] = await redis(["MGET", ...keys]);
  return vals.map((v) => (v ? JSON.parse(v) : null));
}

// Claude sometimes hands back a list as a JSON string ("[{...}]") instead of a real list. Fix that everywhere we read or save a record.
// Pull every complete {...} object out of a JSON array that was cut off or otherwise won't parse (a long draft hitting the output limit).
export function salvageItems(str) {
  const out = []; let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") { if (depth === 0) start = i; depth++; }
    else if (ch === "}") { depth--; if (depth === 0 && start >= 0) { try { out.push(JSON.parse(str.slice(start, i + 1))); } catch (e) {} start = -1; } }
  }
  return out;
}
export function normalizeRecord(r) {
  if (!r || typeof r !== "object") return r;
  const parse = (v) => { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch (e) { return v; } };
  for (const k of ["items", "attendance", "newTerms"]) r[k] = parse(r[k]);
  if (typeof r.items === "string" && r.items.trim()) { r.itemsRaw = r.items; r.items = salvageItems(r.items); r.itemsSalvaged = true; }
  if (!Array.isArray(r.items)) r.items = [];
  // Each item can also arrive as a JSON string; unwrap those too (this is what left meetings with a summary and no items)
  r.items = r.items.map((it) => (typeof it === "string" ? (parse(it) ?? it) : it));
  if (!Array.isArray(r.newTerms)) r.newTerms = [];
  if (!r.attendance || typeof r.attendance !== "object") r.attendance = { present: [], absent: [] };
  for (const it of r.items) {
    if (!it || typeof it !== "object") continue;
    for (const k of ["vote", "issue", "nextStep", "quotes", "notes", "terms", "sources", "parties", "flags"]) it[k] = parse(it[k]);
    for (const k of ["quotes", "notes", "terms", "sources", "parties", "flags"]) if (it[k] != null && !Array.isArray(it[k])) it[k] = typeof it[k] === "string" && it[k].trim() && k === "notes" ? [it[k]] : [];
    for (const k of ["issue", "nextStep"]) if (it[k] != null && typeof it[k] !== "object") it[k] = null;
    if (it.vote != null && typeof it.vote !== "object") it.vote = { method: "unclear", result: "unclear", note: String(it.vote) };
    if (it.vote && typeof it.vote === "object") for (const k of ["yes", "no", "abstain"]) { it.vote[k] = parse(it.vote[k]); if (it.vote[k] != null && !Array.isArray(it.vote[k])) it.vote[k] = typeof it.vote[k] === "string" && it.vote[k].trim() ? it.vote[k].split(/,\s*/) : []; }
  }
  const bad = r.items.filter((it) => !(it && typeof it === "object"));
  if (bad.length) r.itemsRaw = (r.itemsRaw ? r.itemsRaw + "\n" : "") + bad.map(String).join("\n");
  r.items = r.items.filter((it) => it && typeof it === "object");
  return r;
}

// Agenda previews ("Coming up") can come back with the same text-instead-of-list problem.
export function normalizePreview(p) {
  if (!p || typeof p !== "object") return p;
  const parse = (v) => { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch (e) { return v; } };
  p.items = parse(p.items);
  if (!Array.isArray(p.items)) p.items = [];
  p.items = p.items.map(parse).filter((it) => it && typeof it === "object");
  for (const it of p.items) {
    it.parties = parse(it.parties);
    if (!Array.isArray(it.parties)) it.parties = [];
    it.issue = parse(it.issue);
    if (it.issue != null && typeof it.issue !== "object") it.issue = null;
  }
  for (const k of ["time", "location", "howToComment", "summary"]) if (p[k] != null && typeof p[k] !== "string") p[k] = String(p[k]);
  return p;
}
const cleanMeeting = (m) => { if (m) { normalizeRecord(m.draft); normalizeRecord(m.record); normalizePreview(m.preview); } return m; };

// ---- Meetings: meeting:<id>, id = <body>-YYYY-MM-DD; index zset "meetings" scored by date
export const dateScore = (d) => Number(d.replaceAll("-", ""));
export async function saveMeeting(m) {
  m.updatedAt = new Date().toISOString();
  await redis(["SET", `meeting:${m.id}`, JSON.stringify(m)], ["ZADD", "meetings", dateScore(m.date), m.id], ["INCR", "meetings:ver"]);
  MEET_CACHE = null;
  return m;
}
export const getMeeting = async (id) => cleanMeeting(await getJSON(`meeting:${id}`));
// Reading every meeting is the biggest use of storage bandwidth, so a warm server keeps the last full read and reuses it
// while nothing has changed. "meetings:ver" goes up on every save, so a tiny check of it is enough to know the copy is current.
// Callers get their own copy, so changing what they read never touches the cache.
let MEET_CACHE = null; // { ver, raw: string }
export async function listMeetings() {
  const [ver] = await redis(["GET", "meetings:ver"]);
  if (MEET_CACHE && ver != null && MEET_CACHE.ver === ver) return JSON.parse(MEET_CACHE.raw).map(cleanMeeting);
  const [ids] = await redis(["ZRANGE", "meetings", 0, -1, "REV"]);
  const list = (await getMany(ids.map((id) => `meeting:${id}`))).filter(Boolean);
  if (ver != null) MEET_CACHE = { ver, raw: JSON.stringify(list) };
  else await redis(["SETNX", "meetings:ver", "1"]); // first run after this change
  return list.map(cleanMeeting);
}
// Only the meetings on given dates (YYYY-MM-DD), straight from the date index. Used by the live check, which only needs today.
export async function listMeetingsBetween(from, to = from) {
  const [ids] = await redis(["ZRANGEBYSCORE", "meetings", dateScore(from), dateScore(to)]);
  return (await getMany(ids.map((id) => `meeting:${id}`))).filter(Boolean).map(cleanMeeting);
}

// ---- Videos: video:<videoId> (includes transcript lines); index set "videos"
// Each video also gets a small copy without its transcript ("videometa:"), so listing videos doesn't download every transcript
const videoMeta = ({ lines, ...rest }) => ({ ...rest, lineCount: lines?.length || 0 });
export async function saveVideo(v) {
  await redis(["SET", `video:${v.videoId}`, JSON.stringify(v)], ["SET", `videometa:${v.videoId}`, JSON.stringify(videoMeta(v))], ["SADD", "videos", v.videoId]);
  return v;
}
export const getVideo = (id) => getJSON(`video:${id}`);
export async function listVideos() {
  const [ids] = await redis(["SMEMBERS", "videos"]);
  const metas = await getMany(ids.map((id) => `videometa:${id}`));
  // Videos saved before the small copies existed: read them in full once and write their small copy
  const missing = ids.filter((_, i) => !metas[i]);
  if (missing.length) {
    const full = await getMany(missing.map((id) => `video:${id}`));
    const sets = [];
    full.forEach((v, i) => { if (!v) return; const meta = videoMeta(v); metas[ids.indexOf(missing[i])] = meta; sets.push(["SET", `videometa:${missing[i]}`, JSON.stringify(meta)]); });
    for (let i = 0; i < sets.length; i += 50) await redis(...sets.slice(i, i + 50));
  }
  return metas.filter(Boolean);
}

// ---- Issues: issue:<key>; index set "issues"
export async function saveIssue(i) {
  await redis(["SET", `issue:${i.key}`, JSON.stringify(i)], ["SADD", "issues", i.key]);
  return i;
}
export async function listIssues() {
  const [keys] = await redis(["SMEMBERS", "issues"]);
  return (await getMany(keys.map((k) => `issue:${k}`))).filter(Boolean);
}

// ---- Reference documents (budgets, plans): ref:<id>; index set "refs"
export async function saveRef(r) {
  await redis(["SET", `ref:${r.id}`, JSON.stringify(r)], ["SADD", "refs", r.id]);
  return r;
}
export const getRef = (id) => getJSON(`ref:${id}`);
export async function listRefs() {
  const [ids] = await redis(["SMEMBERS", "refs"]);
  return (await getMany(ids.map((id) => `ref:${id}`))).filter(Boolean);
}
