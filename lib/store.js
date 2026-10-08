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
  await redis(["SET", `meeting:${m.id}`, JSON.stringify(m)], ["ZADD", "meetings", dateScore(m.date), m.id]);
  return m;
}
export const getMeeting = async (id) => cleanMeeting(await getJSON(`meeting:${id}`));
export async function listMeetings() {
  const [ids] = await redis(["ZRANGE", "meetings", 0, -1, "REV"]);
  return (await getMany(ids.map((id) => `meeting:${id}`))).filter(Boolean).map(cleanMeeting);
}

// ---- Videos: video:<videoId> (includes transcript lines); index set "videos"
export async function saveVideo(v) {
  await redis(["SET", `video:${v.videoId}`, JSON.stringify(v)], ["SADD", "videos", v.videoId]);
  return v;
}
export const getVideo = (id) => getJSON(`video:${id}`);
export async function listVideos() {
  const [ids] = await redis(["SMEMBERS", "videos"]);
  const vids = (await getMany(ids.map((id) => `video:${id}`))).filter(Boolean);
  return vids.map(({ lines, ...rest }) => ({ ...rest, lineCount: lines?.length || 0 }));
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
