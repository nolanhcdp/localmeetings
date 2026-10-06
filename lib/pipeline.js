// The moving parts: find packets, attach videos, draft with Claude, approve into issues.
import { BODIES, TRACKED, DEFAULT_ROSTER, CHANNELS } from "./county.js";
import { getJSON, setJSON, saveMeeting, getMeeting, listMeetings, getVideo, saveVideo, listVideos, saveIssue, listIssues, saveRef, listRefs } from "./store.js";
import { linesToText, classify, dateFromText } from "./transcript.js";
import { draftMeeting, verifyWithMinutes, previewAgenda, enrichRecord, callCents } from "./claude.js";
import { syncCalendars } from "./schedule.js";
import { applyHolds, applyChecks, useMinutesFix, recordOf, itemLabel, isPublic } from "./publish.js";

const MEETINGS_PAGE = "https://www.in.gov/counties/howard/home/meetings,-minutes,-and-agendas/";
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36" };

export const meetingId = (body, date) => `${body}-${date}`;

export { normalizeRecord } from "./store.js";
import { normalizeRecord, normalizePreview } from "./store.js";

const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
export const today = () => new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10); // Indiana (EDT) date

export async function getRoster() {
  const saved = (await getJSON("config:roster")) || {};
  const out = {};
  for (const b of TRACKED) out[b] = saved[b] || DEFAULT_ROSTER[b] || [];
  return out;
}
export const START_DATE = "2026-01-01";

// 1. Read the county and city document pages and make sure every packet/minutes file has a meeting record.
export async function scanPackets() {
  const county = await scanCounty();
  let city = { files: 0, created: [], error: "" };
  try { city = await scanCity(); } catch (e) { city.error = e.message; }
  const vids = await listVideos();
  // Any videos that were waiting for a meeting to exist
  for (const v of vids) if (!v.meetingId && v.body && TRACKED.includes(v.body)) await attachVideo(await getVideo(v.videoId));
  // Mark which meetings actually have a transcript (older records predate this flag)
  const lineCount = Object.fromEntries(vids.map((v) => [v.videoId, v.lineCount]));
  for (const m of await listMeetings()) {
    if (!m.videoId) continue;
    const has = [m.videoId, ...(m.moreVideoIds || [])].some((id) => lineCount[id] > 0);
    if (m.hasTranscript !== has) {
      m.hasTranscript = has;
      if (m.status === "error" && /Nothing to read/.test(m.error || "")) m.status = "waiting";
      await saveMeeting(m);
    }
  }
  return { packets: county.packets + city.files, created: [...county.created, ...city.created], county, city };
}

async function scanCounty() {
  const res = await fetch(MEETINGS_PAGE, { headers: UA });
  if (!res.ok) throw new Error(`County site returned ${res.status}`);
  const html = await res.text();
  const re = /meeting-and-agenda-docs\/(commissioners|council)\/(\d{4})\/(\d{2})\.(\d{2})\.(\d{4})-[A-Za-z-]*Packet\.pdf/g;
  const found = new Map();
  for (const m of html.matchAll(re)) {
    const [path, folder, , mm, dd, yyyy] = m;
    const date = `${yyyy}-${mm}-${dd}`;
    found.set(`${folder}|${date}`, { body: folder, date, packetUrl: "https://www.in.gov/counties/howard/home/meetings,-minutes,-and-agendas/" + path });
  }
  const created = [];
  for (const p of found.values()) {
    const id = meetingId(p.body, p.date);
    let m = await getMeeting(id);
    if (!m) {
      m = { id, body: p.body, date: p.date, status: "waiting", packetUrl: p.packetUrl, createdAt: new Date().toISOString() };
      created.push(id);
      await saveMeeting(m);
    } else if (m.packetUrl !== p.packetUrl) {
      m.packetUrl = p.packetUrl;
      await saveMeeting(m);
    }
  }
  // Each packet carries the official minutes of that body's previous meeting.
  const all = await listMeetings();
  for (const body of ["council", "commissioners"]) {
    const list = all.filter((m) => m.body === body && m.packetUrl).sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < list.length - 1; i++) {
      const m = list[i], next = list[i + 1];
      if (m.minutesUrl !== next.packetUrl) {
        const hadDraft = m.status === "drafted";
        m.minutesUrl = next.packetUrl;
        m.minutesDate = next.date;
        if (hadDraft) m.minutesArrivedAfterDraft = true;
        await saveMeeting(m);
      }
    }
  }
  return { packets: found.size, created };
}

// Kokomo posts everything on one "Agendas and Minutes" page in six sections. Packets and minutes are separate files,
// named by hand (typos and all), so dates are read loosely from the file name.
const CITY_PAGE = "https://www.cityofkokomo.org/residents/council_agendas_and_minutes/index.php";
const CITY_FILES = "https://cms4files1.revize.com/kokomoin/";
const CITY_SECTIONS = [
  [/council meeting packets/i, "city-council", "packet"],
  [/council meeting minutes/i, "city-council", "minutes"],
  [/plan commission meeting minutes/i, "city-plan", "minutes"],
  [/plan commission agendas/i, "city-plan", "packet"],
  [/zoning board meeting minutes/i, "city-bza", "minutes"],
  [/zoning board agendas/i, "city-bza", "packet"],
];
export function parseCityPage(html) {
  const chunks = html.split(/class="outer-cat cat"/).slice(1);
  const files = [];
  for (const chunk of chunks) {
    const head = chunk.slice(0, 4000).replace(/<[^>]+>/g, " ");
    const sec = CITY_SECTIONS.find(([re]) => re.test(head));
    if (!sec) continue;
    const seen = new Set();
    for (const m of chunk.matchAll(/href="([^"]+?\.pdf)(?:\?[^"]*)?"/gi)) {
      let path = m[1].replace(/&amp;/g, "&");
      try { path = decodeURIComponent(path); } catch (e) {}
      path = path.replace(/^https?:\/\/[^/]+\/(kokomoin\/)?/, "").replace(/^\//, "");
      if (seen.has(path)) continue;
      seen.add(path);
      const name = path.split("/").pop();
      const date = dateFromText(name);
      if (!date || /\bplat\b/i.test(name)) continue; // Plat Committee is a separate body
      // Files are sometimes posted under the wrong heading; trust the file name when it says what it is.
      let body = sec[1], kind = sec[2];
      if (/plan+ commiss?i?on/i.test(name)) body = "city-plan";
      else if (/\bbza\b|zoning/i.test(name)) body = "city-bza";
      else if (/council|coucnil/i.test(name)) body = "city-council";
      if (/minute/i.test(name)) kind = "minutes";
      else if (/agenda|packet/i.test(name)) kind = "packet";
      files.push({ body, kind, date, name, url: CITY_FILES + encodeURI(path), cancelled: /cancel/i.test(name) });
    }
  }
  return files;
}
const minutesRank = (name) => (/draft/i.test(name) ? 0 : /final|amend|approved/i.test(name) ? 2 : 1);

async function scanCity() {
  const res = await fetch(CITY_PAGE, { headers: UA });
  if (!res.ok) throw new Error(`Kokomo site returned ${res.status}`);
  const files = parseCityPage(await res.text()).filter((f) => f.date >= START_DATE);
  // Pick one packet and the best minutes per meeting
  const per = new Map();
  for (const f of files) {
    const key = `${f.body}|${f.date}`;
    const e = per.get(key) || { body: f.body, date: f.date };
    if (f.cancelled) e.cancelled = true;
    else if (f.kind === "packet") e.packet ||= f;
    else if (!e.minutes || minutesRank(f.name) > minutesRank(e.minutes.name)) e.minutes = f;
    per.set(key, e);
  }
  const created = [];
  for (const e of per.values()) {
    const id = meetingId(e.body, e.date);
    let m = await getMeeting(id);
    const isNew = !m;
    m ||= { id, body: e.body, date: e.date, status: "waiting", createdAt: new Date().toISOString() };
    let changed = isNew;
    if (e.packet && m.packetUrl !== e.packet.url) { m.packetUrl = e.packet.url; changed = true; }
    if (e.minutes && m.minutesUrl !== e.minutes.url) {
      if (m.status === "drafted") m.minutesArrivedAfterDraft = true;
      m.minutesUrl = e.minutes.url; m.minutesDate = e.date; m.minutesName = e.minutes.name; changed = true;
    }
    if (e.cancelled && !e.packet && !e.minutes && m.status === "waiting") { m.status = "skipped"; m.cancelled = true; changed = true; }
    if (changed) { await saveMeeting(m); if (isNew) created.push(id); }
  }
  return { files: files.length, created };
}

// 2. Store a transcript and attach it to the right meeting if we can tell which one.
export async function receiveVideo({ videoId, title, date, duration, lines, noCaptions, confirmed, channelId }) {
  const prev = await getVideo(videoId);
  const channel = CHANNELS[channelId] || (/kgov2/i.test(channelId) ? "city" : /howardcounty/i.test(channelId) ? "county" : "") || prev?.channel || "";
  const v = { ...(prev || {}), videoId, title, uploadDate: date, duration, channel, receivedAt: new Date().toISOString() };
  if (!v.bodyLocked) v.date = dateFromText(title) || date; // titles carry the meeting date; uploads can lag a day
  if (lines?.length) { v.lines = lines; delete v.noCaptions; delete v.confirmedNone; }
  else if (noCaptions) { v.noCaptions = true; if (confirmed) v.confirmedNone = true; }
  if (!v.bodyLocked) { const c = classify(title, v.lines, channel); v.body = c.body; v.fromTitle = c.fromTitle; }
  await saveVideo(v);
  // A transcript that arrives for a video already attached to a meeting (e.g. a retry after YouTube rate-limited us)
  if (v.meetingId && lines?.length) {
    const m = await getMeeting(v.meetingId);
    if (m && !m.hasTranscript) {
      m.hasTranscript = true;
      if (m.status === "drafted") m.videoArrivedAfterDraft = true;
      if (m.status === "error") m.status = "waiting";
      await saveMeeting(m);
    }
    return v;
  }
  return attachVideo(v);
}

// Videos the Mac job should try again: attached or unplaced, no transcript, not confirmed caption-less.
export async function missingTranscripts() {
  return (await listVideos()).filter((v) => !v.lineCount && !v.confirmedNone && v.date >= START_DATE && !["other", "budget"].includes(v.body)).map((v) => v.videoId);
}

export async function attachVideo(v) {
  if (!v || v.meetingId || v.bodyLocked && !TRACKED.includes(v.body)) return v;
  if (["other", "budget"].includes(v.body)) return v;
  const all = await listMeetings();
  let m = v.body ? all.filter((x) => x.body === v.body && Math.abs(dayDiff(x.date, v.date)) <= 1 && !x.videoId)
    .sort((a, b) => Math.abs(dayDiff(a.date, v.date)) - Math.abs(dayDiff(b.date, v.date)))[0] : null;
  // Two streams the same day (e.g. Commissioners, then the Drainage Board): the full meeting is the longer one.
  if (!m && v.body && TRACKED.includes(v.body)) {
    const taken = all.find((x) => x.body === v.body && x.date === v.date && x.videoId && x.status !== "approved");
    const old = taken && (await getVideo(taken.videoId));
    if (old && !old.bodyLocked && (old.duration || 0) < (v.duration || 0)) {
      delete old.meetingId; old.body = null; await saveVideo(old);
      delete taken.videoId; m = taken;
    }
  }
  // Untitled stream we couldn't place: if a Council or Commissioners meeting that same day still has no video, it's probably that one.
  if (!m && !v.bodyLocked && !v.fromTitle && v.channel !== "city" && (v.duration || 0) >= 1200 && v.body !== "plan") {
    const open = all.filter((x) => ["council", "commissioners"].includes(x.body) && x.date === v.date && !x.videoId);
    if (open.length === 1) { m = open[0]; v.body = m.body; v.guessed = true; }
  }
  if (!v.body || !TRACKED.includes(v.body)) return v;
  // A clearly titled video (or one you assigned) can start its own meeting record; the documents attach later by date.
  if (!m && (v.fromTitle || v.bodyLocked || v.body === "plan") && v.date >= START_DATE) {
    const id = meetingId(v.body, v.date);
    m = (await getMeeting(id)) || { id, body: v.body, date: v.date, status: "waiting", createdAt: new Date().toISOString() };
    if (m.videoId && m.videoId !== v.videoId) {
      // The stream was split into parts (it happens when the feed drops). Keep both.
      m.moreVideoIds = [...new Set([...(m.moreVideoIds || []), v.videoId])];
      if (v.lines?.length) m.hasTranscript = true;
      if (m.status === "drafted") m.videoArrivedAfterDraft = true;
      await saveMeeting(m);
      v.meetingId = m.id; v.part = true;
      return saveVideo(v);
    }
  }
  if (!m) return v; // stays in "unsorted" until a packet shows up or Nolan assigns it
  m.videoId = v.videoId;
  m.hasTranscript = !!v.lines?.length;
  m.title = m.title || v.title;
  if (m.status === "drafted") m.videoArrivedAfterDraft = true;
  await saveMeeting(m);
  v.meetingId = m.id;
  await saveVideo(v);
  return v;
}

export async function assignVideo(videoId, body, date) {
  const v = await getVideo(videoId);
  if (!v) throw new Error("No such video");
  if (v.meetingId) {
    const old = await getMeeting(v.meetingId);
    if (old && old.videoId === videoId) { delete old.videoId; await saveMeeting(old); }
    delete v.meetingId;
  }
  v.body = body; v.bodyLocked = true;
  if (date) v.date = date;
  await saveVideo(v);
  if (!TRACKED.includes(body)) return v;
  const id = meetingId(body, v.date);
  let m = (await getMeeting(id)) || { id, body, date: v.date, status: "waiting", createdAt: new Date().toISOString() };
  m.videoId = videoId; m.title = m.title || v.title;
  await saveMeeting(m);
  v.meetingId = id;
  return saveVideo(v);
}

// 3. Draft a meeting with Claude.
async function pdfB64(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`Couldn't download ${url.split("/").pop()} (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.slice(0, 4).toString() !== "%PDF") throw new Error(`${url.split("/").pop()} isn't a PDF on the county site (it may be a broken link).`);
  return buf.toString("base64");
}

export function readyToDraft(m) {
  if (m.date > today() || m.cancelled) return false;
  if (m.videoId && m.hasTranscript) return true;
  // Documents only, if a usable video never came
  return !!(m.packetUrl || m.minutesUrl) && dayDiff(today(), m.date) > 10;
}

export async function draft(id) {
  const m = await getMeeting(id);
  if (!m) throw new Error("No such meeting");
  m.status = "drafting"; await saveMeeting(m);
  try {
    const [packetB64, minutesB64, video, roster, issues] = await Promise.all([
      m.packetUrl ? pdfB64(m.packetUrl).catch((e) => { m.packetError = e.message; return null; }) : null,
      m.minutesUrl ? pdfB64(m.minutesUrl).catch(() => null) : null,
      m.videoId ? getVideo(m.videoId) : null,
      getRoster(),
      listIssues(),
    ]);
    let transcriptText = video?.lines?.length ? linesToText(video.lines) : "";
    for (const [i, id] of (m.moreVideoIds || []).entries()) {
      const part = await getVideo(id);
      if (part?.lines?.length) transcriptText += `\n\n=== PART ${i + 2}: a separate video of the same meeting (youtube id ${id}); its timestamps start over at 0 ===\n` + linesToText(part.lines);
    }
    if (!packetB64 && !minutesB64 && !transcriptText) throw new Error("Nothing to read yet: no packet, minutes or transcript.");
    const refText = await referenceContext(BODIES[m.body].gov).catch(() => "");
    const args = {
      meeting: m, packetB64, minutesB64, minutesDate: m.minutesDate, minutesSeparate: BODIES[m.body].docs === "city", transcriptText, roster, refText,
      issues: issues.map((i) => ({ key: i.key, title: i.title })).slice(0, 200),
    };
    let out;
    try { out = await draftMeeting(args); }
    catch (e) {
      // Very long packets (100+ pages) are over Claude's PDF limit: draft from minutes and video, and say so.
      if (!packetB64 || !/page|too (large|long)|exceed|maximum|size/i.test(e.message)) throw e;
      out = await draftMeeting({ ...args, packetB64: null });
      m.packetError = "The agenda packet was too long for Claude to read; drafted from minutes and video.";
    }
    const { _usage, _model, _truncated, ...record } = out;
    m.draft = applyHolds(normalizeRecord(record));
    m.draftMeta = { schema: 2, at: new Date().toISOString(), model: _model, usage: _usage, truncated: _truncated, hadMinutes: !!minutesB64, hadPacket: !!packetB64 && !m.packetError, hadVideo: !!transcriptText };
    m.status = "drafted"; m.edited = false;
    delete m.minutesArrivedAfterDraft; delete m.videoArrivedAfterDraft; delete m.error; delete m.minutesCheck;
    await saveMeeting(m);
    await rebuildIssuesFor(m);
    return m;
  } catch (e) {
    m.status = "error"; m.error = e.message;
    await saveMeeting(m);
    throw e;
  }
}

// 4. Approve: lock the record and fold its items into issue timelines.
export async function approve(id, record) {
  const m = await getMeeting(id);
  if (!m) throw new Error("No such meeting");
  m.record = normalizeRecord(record);
  m.status = "approved";
  m.approvedAt = new Date().toISOString();
  await saveMeeting(m);
  await rebuildIssuesFor(m);
  return m;
}

export async function unapprove(id) {
  const m = await getMeeting(id);
  m.status = "drafted";
  if (m.record) m.draft = m.record;
  delete m.record;
  await saveMeeting(m);
  await rebuildIssuesFor(m); // still public as a draft
  return m;
}

export async function rebuildIssuesFor(m, removeOnly = false, cache = null) {
  const issues = cache || (await listIssues());
  const touched = new Map();
  for (const i of issues) {
    if ((i.events || []).some((e) => e.meetingId === m.id)) {
      i.events = i.events.filter((e) => e.meetingId !== m.id);
      touched.set(i.key, i);
    }
  }
  const rec = recordOf(m);
  if (!removeOnly && rec && isPublic(m)) {
    (rec.items || []).forEach((it, idx) => {
      const key = (it.issue?.key || "").trim();
      if (!key) return;
      const label = itemLabel(m, it);
      if (label === "held" || label === "hidden") return;
      let i = touched.get(key) || issues.find((x) => x.key === key);
      if (!i) { i = { key, title: it.issue.title || it.title, body: m.body, events: [], createdAt: new Date().toISOString() }; issues.push(i); }
      i.events = (i.events || []).filter((e) => !(e.meetingId === m.id && e.idx === idx));
      i.events.push({ meetingId: m.id, body: m.body, date: m.date, idx, title: it.title, stage: it.stage, result: it.vote?.result, label, amount: it.amount ?? null, docNumber: it.docNumber || "", nextStep: it.nextStep || null, videoId: m.videoId || null, videoSeconds: it.videoSeconds ?? null });
      touched.set(key, i);
    });
  }
  for (const i of touched.values()) {
    i.events.sort((a, b) => a.date.localeCompare(b.date) || a.idx - b.idx);
    const last = i.events[i.events.length - 1];
    i.lastDate = last?.date || null;
    i.firstDate = i.events[0]?.date || null;
    i.latestStage = last?.stage || null;
    i.nextStep = last?.nextStep || null;
    i.bodies = [...new Set(i.events.map((e) => e.body))];
    i.updatedAt = new Date().toISOString();
    await saveIssue(i);
  }
}

// Rebuild every issue timeline from scratch (after the publishing rules change, or a bulk import).
export async function rebuildAllIssues() {
  const issues = (await listIssues()).map((i) => ({ ...i, events: [] }));
  const meetings = await listMeetings();
  for (const i of issues) await saveIssue(i);
  for (const m of meetings) await rebuildIssuesFor(m, false, issues);
  return { issues: issues.filter((i) => i.events.length).length };
}

// Held items: publish as written, use the minutes' version, or keep off the public site.
export async function resolveItem(id, idx, action) {
  const m = await getMeeting(id);
  const rec = m.status === "approved" ? m.record : m.draft;
  const it = rec?.items?.[idx];
  if (!it) throw new Error("No such item");
  if (action === "publish") { delete it.hold; it.released = true; delete it.hidden; }
  else if (action === "minutes") useMinutesFix(it);
  else if (action === "hide") { it.hidden = true; delete it.hold; }
  else if (action === "unhide") { delete it.hidden; }
  else throw new Error("Unknown action");
  m.edited = true;
  await saveMeeting(m);
  await rebuildIssuesFor(m);
  return m;
}

// Minutes came out after the draft: check the draft against them instead of redrafting.
export async function verify(id) {
  const m = await getMeeting(id);
  const rec = m && (m.status === "approved" ? m.record : m.draft);
  if (!rec || !m.minutesUrl) throw new Error(`${id}: nothing to check`);
  const minutesB64 = await pdfB64(m.minutesUrl);
  const out = await verifyWithMinutes({ meeting: m, record: rec, minutesB64, minutesDate: m.minutesDate, minutesSeparate: BODIES[m.body].docs === "city" });
  applyChecks(m, out, out._model || "claude");
  m.minutesCheck.cents = Math.round(callCents(out._usage) * 100) / 100;
  await saveMeeting(m);
  await rebuildIssuesFor(m);
  return m;
}

// "Coming up": read an upcoming meeting's packet and explain it.
export async function preview(id) {
  const m = await getMeeting(id);
  if (!m?.packetUrl) throw new Error(`${id}: no packet yet`);
  try {
    const [packetB64, issues] = await Promise.all([pdfB64(m.packetUrl), listIssues()]);
    const { _usage, _model, _truncated, ...out } = await previewAgenda({ meeting: m, packetB64, issues: issues.map((i) => ({ key: i.key, title: i.title })).slice(0, 200) });
    m.preview = normalizePreview({ ...out, packetUrl: m.packetUrl, at: new Date().toISOString(), model: _model });
    delete m.previewError;
  } catch (e) { m.previewError = e.message; m.previewErrorPacket = m.packetUrl; }
  return saveMeeting(m);
}
// Older drafts: fill in companies, who got the money, funding source and research flags from the draft's own text.
export async function enrich(id) {
  const m = await getMeeting(id);
  const rec = m && (m.status === "approved" ? m.record : m.draft);
  if (!rec?.items?.length) { if (m) { m.enriched = new Date().toISOString(); await saveMeeting(m); } return { m, cents: 0 }; }
  const out = await enrichRecord({ meeting: m, record: rec });
  let patches = out.items;
  if (typeof patches === "string") { try { patches = JSON.parse(patches); } catch (e) { patches = []; } }
  patchItems(m, Array.isArray(patches) ? patches : []);
  m.enriched = new Date().toISOString();
  await saveMeeting(m);
  await rebuildIssuesFor(m);
  return { m, cents: Math.round(callCents(out._usage) * 100) / 100 };
}
export const needsEnrich = (m) => ["drafted", "approved"].includes(m.status) && !m.enriched && !m.draftMeta?.schema;
export const needsPreview = (m) => m.packetUrl && m.date >= today() && !m.cancelled && m.preview?.packetUrl !== m.packetUrl && m.previewErrorPacket !== m.packetUrl;
export const needsCheck = (m) => ["drafted", "approved"].includes(m.status) && m.minutesUrl && !m.minutesCheck && !m.draftMeta?.hadMinutes;

// The daily job
export async function dailyRun({ maxDrafts = 2, maxChecks = 4, maxPreviews = 3 } = {}) {
  const started = Date.now(), timeLeft = () => Date.now() - started < 170e3; // stay inside Vercel's 5-minute limit
  const calendar = await syncCalendars({ today: today() }).catch((e) => ({ error: e.message }));
  const scan = await scanPackets();
  const drafted = [], errors = [];
  const all = await listMeetings();
  // Redraft only when a video shows up for a documents-only draft; minutes that arrive later are a cheaper check (below).
  const queue = all.filter((m) => (m.status === "waiting" && readyToDraft(m)) || (m.status === "drafted" && !m.edited && m.videoArrivedAfterDraft && !m.draftMeta?.hadVideo))
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const m of queue.slice(0, maxDrafts)) {
    if (!timeLeft()) break;
    try { await draft(m.id); drafted.push(m.id); } catch (e) { errors.push(`${m.id}: ${e.message}`); }
  }
  const checked = [], previewed = [];
  const fresh = await listMeetings();
  for (const m of fresh.filter(needsCheck).sort((a, b) => b.date.localeCompare(a.date)).slice(0, maxChecks)) {
    if (!timeLeft()) break;
    try { await verify(m.id); checked.push(m.id); } catch (e) { errors.push(`${m.id} (minutes check): ${e.message}`); }
  }
  for (const m of fresh.filter(needsPreview).sort((a, b) => a.date.localeCompare(b.date)).slice(0, maxPreviews)) {
    if (!timeLeft()) break;
    const out = await preview(m.id); (out.previewError ? errors.push(`${m.id} (preview): ${out.previewError}`) : previewed.push(m.id));
  }
  const status = { at: new Date().toISOString(), calendar, scan, drafted, checked, previewed, errors, queued: queue.length };
  await setJSON("status:lastRun", status);
  return status;
}

// Records drafted outside the app (e.g. by Claude in a chat session) and reference documents like budgets.
export async function importFiles(files) {
  const done = [];
  for (const f of files) {
    if (f?.type === "reference" && f.id) {
      await saveRef({ ...f, importedAt: new Date().toISOString() });
      done.push(`Reference: ${f.title || f.id}`);
    } else if (f?.type === "meeting-draft" && f.meetingId && f.record) {
      let m = await getMeeting(f.meetingId);
      if (!m) {
        if (!TRACKED.includes(f.body) || !/^\d{4}-\d{2}-\d{2}$/.test(f.date || "")) throw new Error(`${f.meetingId}: unknown meeting`);
        m = { id: f.meetingId, body: f.body, date: f.date, status: "waiting", createdAt: new Date().toISOString() };
      }
      if (m.status === "approved") { done.push(`Skipped ${f.meetingId}: already approved`); continue; }
      m.draft = applyHolds(normalizeRecord(f.record));
      m.references = f.references || [];
      m.draftMeta = { schema: 2, at: new Date().toISOString(), model: f.draftedBy || "imported", imported: true, hadPacket: true, hadMinutes: !!f.hadMinutes, hadVideo: true };
      m.status = "drafted"; m.edited = true; // imported drafts are never redrafted automatically
      delete m.error; delete m.minutesArrivedAfterDraft; delete m.videoArrivedAfterDraft; delete m.minutesCheck;
      await saveMeeting(m);
      await rebuildIssuesFor(m);
      done.push(`Draft: ${f.meetingId}`);
    } else if (f?.type === "meeting-check" && f.meetingId) {
      // A minutes check done in a chat session: { checks, attendance?, missingItems?, patches? }
      const m = await getMeeting(f.meetingId);
      if (!m) { done.push(`Skipped ${f.meetingId}: no such meeting`); continue; }
      if (f.checks) applyChecks(m, f, f.checkedBy || "chat");
      patchItems(m, f.patches);
      await saveMeeting(m); await rebuildIssuesFor(m);
      done.push(`Checked: ${f.meetingId}${m.minutesCheck ? ` (${m.minutesCheck.matched} match, ${m.minutesCheck.conflicts} to look at)` : ""}`);
    } else if (f?.type === "meeting-preview" && f.meetingId && f.preview) {
      let m = await getMeeting(f.meetingId);
      if (!m) {
        if (!TRACKED.includes(f.body) || !/^\d{4}-\d{2}-\d{2}$/.test(f.date || "")) throw new Error(`${f.meetingId}: unknown meeting`);
        m = { id: f.meetingId, body: f.body, date: f.date, status: "waiting", createdAt: new Date().toISOString() };
      }
      m.preview = normalizePreview({ ...f.preview, packetUrl: f.packetUrl || m.packetUrl || null, at: new Date().toISOString(), model: f.draftedBy || "imported" });
      if (!m.packetUrl && f.packetUrl) m.packetUrl = f.packetUrl;
      await saveMeeting(m);
      done.push(`Preview: ${f.meetingId}`);
    } else {
      done.push("Skipped a file that isn't a localmeetings draft or reference");
    }
  }
  return done;
}

// Short background from reference documents (e.g. the adopted budget) for drafting meetings of the same government.
export async function referenceContext(gov) {
  const refs = (await listRefs()).filter((r) => r.gov === gov);
  return refs.map((r) => {
    const lines = [`${r.title}${[r.docNumber, r.adopted && `adopted ${r.adopted}`].filter(Boolean).length ? ` (${[r.docNumber, r.adopted && `adopted ${r.adopted}`].filter(Boolean).join(", ")})` : ""}: ${r.summary || ""}`];
    if (r.funds?.length) lines.push("Fund budgets: " + r.funds.map((f) => `${f.name} $${Math.round(f.budget).toLocaleString("en-US")}`).join("; "));
    if (r.generalFundDepartments?.length) lines.push("General Fund by department: " + r.generalFundDepartments.map((d) => `${d.name} $${Math.round(d.amount).toLocaleString("en-US")}`).join("; "));
    return lines.join("\n");
  }).join("\n\n");
}

// Merge extra fields into items (e.g. parties/recipient/flags added to older drafts in a chat session).
const PATCHABLE = ["parties", "recipient", "fundingSource", "flags", "holdReason", "checkNote", "title", "whatItIs", "whyItMatters", "issue"];
export function patchItems(m, patches) {
  const rec = m.status === "approved" ? m.record : m.draft;
  for (const p of Array.isArray(patches) ? patches : []) {
    const it = rec?.items?.[p?.idx];
    if (!it) continue;
    for (const k of PATCHABLE) if (p[k] !== undefined) { let v = p[k]; if (typeof v === "string" && /^\s*[\[{]/.test(v)) { try { v = JSON.parse(v); } catch (e) {} } it[k] = v; }
    if (p.holdReason && !it.released && m.status !== "approved") it.hold = { reason: p.holdReason, at: new Date().toISOString() };
  }
  if (rec && patches?.length) m.enriched = new Date().toISOString();
  return m;
}

// Everything a chat session needs to check drafts against minutes and fill in the newer fields.
export async function exportForChat() {
  const all = await listMeetings();
  return all.filter((m) => recordOf(m)).map((m) => ({
    meetingId: m.id, body: m.body, date: m.date, status: m.status, packetUrl: m.packetUrl || null, minutesUrl: m.minutesUrl || null, minutesDate: m.minutesDate || null,
    needsMinutesCheck: needsCheck(m), needsEnrich: needsEnrich(m),
    record: recordOf(m),
  }));
}

// The frequent check (every couple of hours, from GitHub): new documents, calendar changes, and previews for meetings
// in the next two days. Cheap by design: it skips if it ran in the last 45 minutes, and a packet is only ever previewed once.
export async function tick({ force = false } = {}) {
  const last = await getJSON("status:lastTick");
  if (!force && last?.at && Date.now() - Date.parse(last.at) < 45 * 60e3) return { skipped: true, lastAt: last.at };
  await setJSON("status:lastTick", { at: new Date().toISOString(), running: true });
  const started = Date.now();
  const calendar = await syncCalendars({ today: today() }).catch((e) => ({ error: e.message }));
  const scan = await scanPackets().catch((e) => ({ error: e.message }));
  const soon = addDaysStr(today(), 2), previewed = [], errors = [];
  const due = (await listMeetings()).filter((m) => needsPreview(m) && m.date <= soon).sort((a, b) => a.date.localeCompare(b.date));
  for (const m of due.slice(0, 3)) {
    if (Date.now() - started > 200e3) break;
    const out = await preview(m.id);
    out.previewError ? errors.push(`${m.id}: ${out.previewError}`) : previewed.push(m.id);
  }
  // A live stream we saw during a meeting becomes that meeting's video record (the Mac job adds the transcript later)
  for (const m of await listMeetings()) {
    if (!m.liveVideoId || m.videoId) continue;
    const gov = BODIES[m.body]?.gov;
    await saveVideo({ videoId: m.liveVideoId, title: `${BODIES[m.body]?.name} ${m.date}`, uploadDate: m.date, date: m.date, channel: gov, body: m.body, bodyLocked: true, receivedAt: new Date().toISOString() });
    m.videoId = m.liveVideoId; m.hasTranscript = false;
    await saveMeeting(m);
    const v = await getVideo(m.liveVideoId); v.meetingId = m.id; await saveVideo(v);
  }
  // A meeting from the last week whose video transcript just came in: draft it now instead of waiting for the daily run.
  const drafted = [];
  const weekAgo = addDaysStr(today(), -7);
  const ready = (await listMeetings()).filter((m) => (m.status === "waiting" || (m.status === "error" && !/Nothing to read/.test(m.error || ""))) && m.date >= weekAgo && m.hasTranscript && readyToDraft(m)).sort((a, b) => b.date.localeCompare(a.date));
  for (const m of ready.slice(0, 1)) {
    if (Date.now() - started > 120e3) break; // leave room: a draft takes a minute or two
    try { await draft(m.id); drafted.push(m.id); } catch (e) { errors.push(`${m.id} (draft): ${e.message}`); }
  }
  const status = { at: new Date().toISOString(), calendar, scan: scan.error ? scan : { packets: scan.packets, created: scan.created }, previewed, drafted, errors };
  await setJSON("status:lastTick", status);
  return status;
}
const addDaysStr = (s, n) => new Date(Date.parse(s + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
