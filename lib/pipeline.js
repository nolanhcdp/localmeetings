// The moving parts: find packets, attach videos, draft with Claude, approve into issues.
import { BODIES, TRACKED, DEFAULT_ROSTER } from "./county.js";
import { getJSON, setJSON, saveMeeting, getMeeting, listMeetings, getVideo, saveVideo, listVideos, saveIssue, listIssues } from "./store.js";
import { linesToText, classify } from "./transcript.js";
import { draftMeeting } from "./claude.js";

const MEETINGS_PAGE = "https://www.in.gov/counties/howard/home/meetings,-minutes,-and-agendas/";
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36" };

export const meetingId = (body, date) => `${body}-${date}`;
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
export const today = () => new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10); // Indiana (EDT) date

export async function getRoster() {
  return (await getJSON("config:roster")) || DEFAULT_ROSTER;
}

// 1. Read the county meetings page and make sure every packet has a meeting record.
export async function scanPackets() {
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
  // Any videos that were waiting for this meeting to exist
  for (const v of await listVideos()) if (!v.meetingId && v.body && TRACKED.includes(v.body)) await attachVideo(await getVideo(v.videoId));
  return { packets: found.size, created };
}

// 2. Store a transcript and attach it to the right meeting if we can tell which one.
export async function receiveVideo({ videoId, title, date, duration, lines, noCaptions }) {
  const prev = await getVideo(videoId);
  const v = { ...(prev || {}), videoId, title, date, duration, receivedAt: new Date().toISOString() };
  if (lines?.length) v.lines = lines;
  if (noCaptions) v.noCaptions = true;
  if (!v.bodyLocked) v.body = classify(title, v.lines);
  await saveVideo(v);
  return attachVideo(v);
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
  if (!m && !v.bodyLocked && (v.duration || 0) >= 1200 && v.body !== "plan") {
    const open = all.filter((x) => ["council", "commissioners"].includes(x.body) && x.date === v.date && !x.videoId);
    if (open.length === 1) { m = open[0]; v.body = m.body; v.guessed = true; }
  }
  if (!v.body || !TRACKED.includes(v.body)) return v;
  if (!m && v.body === "plan") {
    m = { id: meetingId("plan", v.date), body: "plan", date: v.date, status: "waiting", createdAt: new Date().toISOString() };
  }
  if (!m) return v; // stays in "unsorted" until a packet shows up or Nolan assigns it
  m.videoId = v.videoId;
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
  if (m.date > today()) return false;
  if (m.body === "plan") return !!m.videoId;
  if (!m.packetUrl) return !!m.videoId;
  return !!m.videoId || dayDiff(today(), m.date) > 10; // packet only if the video never came
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
    const transcriptText = video?.lines?.length ? linesToText(video.lines) : "";
    if (!packetB64 && !minutesB64 && !transcriptText) throw new Error("Nothing to read yet: no packet, minutes or transcript.");
    const out = await draftMeeting({
      meeting: m, packetB64, minutesB64, minutesDate: m.minutesDate, transcriptText, roster,
      issues: issues.map((i) => ({ key: i.key, title: i.title })).slice(0, 200),
    });
    const { _usage, _model, _truncated, ...record } = out;
    m.draft = record;
    m.draftMeta = { at: new Date().toISOString(), model: _model, usage: _usage, truncated: _truncated, hadMinutes: !!minutesB64, hadPacket: !!packetB64, hadVideo: !!transcriptText };
    m.status = "drafted"; m.edited = false;
    delete m.minutesArrivedAfterDraft; delete m.videoArrivedAfterDraft; delete m.error;
    return saveMeeting(m);
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
  m.record = record;
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
  await rebuildIssuesFor(m, true);
  return m;
}

async function rebuildIssuesFor(m, removeOnly = false) {
  const issues = await listIssues();
  const touched = new Map();
  for (const i of issues) {
    if ((i.events || []).some((e) => e.meetingId === m.id)) {
      i.events = i.events.filter((e) => e.meetingId !== m.id);
      touched.set(i.key, i);
    }
  }
  if (!removeOnly) {
    (m.record.items || []).forEach((it, idx) => {
      const key = (it.issue?.key || "").trim();
      if (!key) return;
      const i = touched.get(key) || issues.find((x) => x.key === key) || { key, title: it.issue.title || it.title, body: m.body, events: [], createdAt: new Date().toISOString() };
      i.events = (i.events || []).filter((e) => !(e.meetingId === m.id && e.idx === idx));
      i.events.push({ meetingId: m.id, body: m.body, date: m.date, idx, title: it.title, stage: it.stage, result: it.vote?.result, amount: it.amount ?? null, docNumber: it.docNumber || "", nextStep: it.nextStep || null, videoId: m.videoId || null, videoSeconds: it.videoSeconds ?? null });
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
    i.updatedAt = new Date().toISOString();
    await saveIssue(i);
  }
}

// The daily job
export async function dailyRun({ maxDrafts = 2 } = {}) {
  const scan = await scanPackets();
  const drafted = [], errors = [];
  const all = await listMeetings();
  const queue = all.filter((m) => (m.status === "waiting" && readyToDraft(m)) || (m.status === "drafted" && !m.edited && (m.minutesArrivedAfterDraft || m.videoArrivedAfterDraft)))
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const m of queue.slice(0, maxDrafts)) {
    try { await draft(m.id); drafted.push(m.id); } catch (e) { errors.push(`${m.id}: ${e.message}`); }
  }
  await setJSON("status:lastRun", { at: new Date().toISOString(), scan, drafted, errors, queued: queue.length });
  return { scan, drafted, errors, queued: queue.length };
}
