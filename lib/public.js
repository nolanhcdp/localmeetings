// Read-only views for the public site. Everything here passes through publicMeeting(), so held and hidden items never leave.
import { BODIES, TRACKED, GLOSSARY } from "./county.js";
import { listMeetings, listIssues, listRefs, getRef, getJSON } from "./store.js";
import { getRoster, today, normalizeRecord } from "./pipeline.js";
import { publicMeeting, isPublic, recordOf, itemLabel } from "./publish.js";
import { roadmapFor, classifyIssue } from "./roadmaps.js";

const lastName = (n) => String(n || "").toLowerCase().replace(/[.,]/g, " ").replace(/\b(jr|sr|ii|iii|dr|mr|mrs|ms|councilman|councilwoman|councilor|commissioner|president)\b/g, "").trim().split(/\s+/).pop() || "";
const has = (list, person) => (list || []).some((n) => lastName(n) && lastName(n) === lastName(person));
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function load() {
  const [meetings, issues, roster] = await Promise.all([listMeetings(), listIssues(), getRoster()]);
  for (const m of meetings) { normalizeRecord(m.draft); normalizeRecord(m.record); }
  return { meetings, issues, roster };
}

const upcomingOf = (m) => ({
  id: m.id, body: m.body, bodyName: BODIES[m.body]?.name, gov: BODIES[m.body]?.gov, date: m.date, packetUrl: m.packetUrl || null,
  time: m.preview?.time || m.scheduled?.time || "", location: m.preview?.location || m.scheduled?.location || "", howToComment: m.preview?.howToComment || "", summary: m.preview?.summary || "",
  special: m.scheduled?.title || "", estimated: !!m.scheduled?.estimated && !m.packetUrl, cancelled: !!m.cancelled, maybeCanceled: !!m.scheduled?.missing && !m.packetUrl,
  state: m.cancelled ? "cancelled" : m.preview ? "previewed" : m.packetUrl ? "agenda" : "scheduled", over: !!m.liveEndedAt, previewAt: m.preview?.at || "",
  items: (m.preview?.items || []).map((it) => ({ title: it.title, whatItIs: it.whatItIs, whyItMatters: it.whyItMatters || "", step: it.step || "", publicHearing: !!it.publicHearing, speak: it.speak || (it.publicHearing ? "right" : ""), amount: it.amount ?? null, category: it.category, docNumber: it.docNumber || "", location: it.location || "", recipient: it.recipient || "", parties: it.parties || [], issue: it.issue?.key ? { key: it.issue.key, title: it.issue.title } : null, page: it.page ?? null })),
});
const minutesOf = (t) => { const x = String(t || "").match(/(\d+):(\d+)\s*([ap])/i); if (!x) return 24 * 60; return ((+x[1] % 12) + (/p/i.test(x[3]) ? 12 : 0)) * 60 + +x[2]; };
const byWhen = (a, b) => a.date.localeCompare(b.date) || minutesOf(a.time) - minutesOf(b.time);
const plusDays = (s, n) => new Date(Date.parse(s + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

const issueOut = (i, t) => { const r = roadmapFor(i, { today: t }); return { key: i.key, title: i.title, bodies: i.bodies || [...new Set((i.events || []).map((e) => e.body))], firstDate: i.firstDate, lastDate: i.lastDate, latestStage: i.latestStage, nextStep: i.nextStep, count: i.events?.length || 0, kind: r?.kind || null, kindLabel: r?.label || "", progress: r ? { done: r.done, total: r.total, status: r.status, states: r.steps.filter((s) => s.state !== "skipped").map((s) => s.state), next: r.next ? { title: r.next.title, bodyName: r.next.bodyName, scheduled: r.next.scheduled } : null } : null }; };

export async function home() {
  const { meetings, issues } = await load();
  const t = today();
  const future = meetings.filter((m) => m.date >= t && (m.status !== "skipped" || m.cancelled)).map(upcomingOf).sort(byWhen);
  const twoWeeks = future.filter((u) => u.date <= plusDays(t, 14));
  const upcoming = twoWeeks.length >= 6 ? twoWeeks : future.slice(0, 6);
  // The permanent "next meeting" line: the soonest one that isn't cancelled and hasn't already ended today
  const live = future.filter((u) => !u.cancelled && !(u.date === t && u.over));
  const next = live[0] || null, then = live[1] || null;
  const pubs = meetings.filter(isPublic).sort((a, b) => b.date.localeCompare(a.date));
  const recent = pubs.slice(0, 12).map((m) => ({ ...publicMeeting(m, { full: false }), addedAt: m.draftMeta?.at || m.approvedAt || "" }));
  // What just happened: the latest decisions across the last few meetings, one line each
  const decisions = [];
  for (const m of pubs.slice(0, 8)) {
    const rec = recordOf(m); if (!rec) continue;
    const addedAt = m.draftMeta?.at || m.approvedAt || "";
    (rec.items || []).forEach((it, idx) => {
      const label = itemLabel(m, it);
      if (label === "held" || label === "hidden" || ["minutes", "claims", "report"].includes(it.category)) return;
      const v = it.vote || {};
      decisions.push({ meetingId: m.id, idx, body: m.body, bodyName: BODIES[m.body]?.name, date: m.date, title: it.title, stage: it.stage || "", result: v.result || "", amount: it.amount ?? null, category: it.category || "",
        voteText: v.method === "roll call" && (v.yes?.length || v.no?.length) ? `${v.yes?.length || 0}–${v.no?.length || 0}${v.no?.length ? ", " + v.no.map((n) => n.split(" ").pop()).join(", ") + " no" : ""}` : v.method === "voice" ? (v.note && /no one|unanimous|none/i.test(v.note) ? "voice vote, no one heard voting no" : "voice vote") : "", addedAt, issue: it.issue?.key || "" });
    });
  }
  decisions.sort((a, b) => b.date.localeCompare(a.date) || (b.result ? 1 : 0) - (a.result ? 1 : 0) || (b.amount || 0) - (a.amount || 0));
  const active = issues.filter((i) => i.events?.length).sort((a, b) => (b.lastDate || "").localeCompare(a.lastDate || "") || b.events.length - a.events.length).slice(0, 12).map((i) => issueOut(i, t));
  // Still moving: only issues with a real signal, a dated next step or something in the last 60 days
  const moving = active.filter((i) => i.progress && i.progress.status === "active" && i.progress.next && (i.progress.next.scheduled || (i.lastDate || "") >= plusDays(t, -60))).slice(0, 6);
  const ahead = issues.filter((i) => i.nextStep?.date && i.nextStep.date >= t).map((i) => ({ key: i.key, title: i.title, date: i.nextStep.date, text: i.nextStep.text, publicCanSpeak: !!i.nextStep.publicCanSpeak })).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10);
  const dl = await getJSON("home:dateline");
  const dateline = dl?.date === t ? { segments: dl.segments, at: dl.at } : null;
  const tick = await getJSON("status:lastTick"), run = await getJSON("status:lastRun");
  const updatedAt = [tick?.at, run?.at, recent[0]?.addedAt].filter(Boolean).sort().pop() || "";
  const votes = pubs.reduce((n, m) => n + (recordOf(m)?.items || []).filter((it) => it.vote?.result === "passed" || it.vote?.result === "failed").length, 0);
  const firstDate = pubs.length ? pubs[pubs.length - 1].date : "";
  return { today: t, next, then, dateline, updatedAt, upcoming, recent, decisions: decisions.slice(0, 8), issues: active, moving, ahead, bodies: BODIES, counts: { meetings: pubs.length, issues: issues.filter((i) => i.events?.length).length, votes, since: firstDate } };
}

// Everything scheduled for the next four months
export async function calendar() {
  const { meetings } = await load();
  const t = today();
  const from = plusDays(t.slice(0, 7) + "-01", -40);
  const future = meetings.filter((m) => m.date >= t && (m.status !== "skipped" || m.cancelled)).map(upcomingOf);
  // Past meetings in the grid too, so a month reads as what happened and what's coming
  const past = meetings.filter((m) => m.date < t && m.date >= from && (isPublic(m) || m.cancelled || m.packetUrl || m.scheduled)).map((m) => {
    const pm = isPublic(m) ? publicMeeting(m, { full: false }) : null;
    return { ...upcomingOf(m), past: true, published: !!pm, itemCount: pm?.items?.length || 0, passed: pm ? pm.items.filter((i) => i.result === "passed").length : 0 };
  });
  return { today: t, meetings: [...past, ...future].sort(byWhen), bodies: BODIES };
}

export async function meetings(body) {
  const { meetings } = await load();
  return { meetings: meetings.filter((m) => isPublic(m) && (!body || m.body === body)).map((m) => publicMeeting(m, { full: false })), bodies: BODIES };
}

export async function meeting(id) {
  const { meetings } = await load();
  const m = meetings.find((x) => x.id === id);
  if (!m) return null;
  const out = isPublic(m) ? publicMeeting(m) : { id: m.id, body: m.body, bodyName: BODIES[m.body]?.name, gov: BODIES[m.body]?.gov, date: m.date, items: [], summary: "", packetUrl: m.packetUrl || null, videoId: m.videoId || null, pending: true };
  if (m.date >= today()) out.upcoming = upcomingOf(m);
  const terms = new Set(out.items.flatMap((i) => i.terms || []));
  out.glossary = Object.fromEntries([...terms].filter((t) => GLOSSARY[t]).map((t) => [t, GLOSSARY[t]]));
  for (const t of out.newTerms || []) if (t?.term) out.glossary[t.term] = t.plain;
  out.role = BODIES[m.body]?.role;
  if (out.references?.length) {
    const rs = await listRefs();
    out.references = out.references.map((id) => { const r = rs.find((x) => x.id === (id.id || id)); return r ? { id: r.id, title: r.title } : null; }).filter(Boolean);
  }
  return out;
}

export async function issue(key) {
  const { issues, meetings } = await load();
  const i = issues.find((x) => x.key === key);
  if (!i) return null;
  const byId = new Map(meetings.map((m) => [m.id, m]));
  const events = (i.events || []).map((e) => {
    const m = byId.get(e.meetingId);
    const it = m && (m.status === "approved" ? m.record : m.draft)?.items?.[e.idx];
    return { ...e, bodyName: BODIES[e.body]?.name, whatItIs: it?.whatItIs || "", vote: it?.vote ? { method: it.vote.method, result: it.vote.result, no: it.vote.no || [], note: it.vote.note || "" } : null };
  });
  // Upcoming agendas that mention this issue
  const coming = meetings.filter((m) => m.date >= today() && m.preview?.items?.some((it) => it.issue?.key === key)).map((m) => ({ id: m.id, date: m.date, body: m.body, bodyName: BODIES[m.body]?.name, items: m.preview.items.filter((it) => it.issue?.key === key).map((it) => ({ title: it.title, step: it.step || "", publicHearing: !!it.publicHearing })) }));
  const scheduled = coming.map((c) => ({ id: c.id, date: c.date, body: c.body }));
  const roadmap = roadmapFor(i, { today: today(), scheduled });
  return { ...issueOut(i, today()), events, coming, roadmap };
}

export async function issuesList() {
  const { issues } = await load();
  const t = today();
  return { issues: issues.filter((i) => i.events?.length).sort((a, b) => (b.lastDate || "").localeCompare(a.lastDate || "")).map((i) => issueOut(i, t)), bodies: BODIES };
}

// Officials: attendance, motions, and every vote where the record names them. Most local votes are voice votes,
// so "named" votes are mainly roll calls and recorded no votes.
function officialStats(person, body, meetings) {
  const out = { name: person.name, title: person.title || "", party: person.party || "", body, bodyName: BODIES[body]?.name, slug: slug(person.name), meetings: 0, present: 0, absent: 0, motions: 0, seconds: 0, yes: 0, no: 0, abstain: 0, votes: [], absences: [], attended: [] };
  for (const m of meetings) {
    if (m.body !== body || !isPublic(m)) continue;
    const pm = publicMeeting(m);
    out.meetings++;
    const att = pm.attendance || {};
    const away = has(att.absent, person.name);
    if (away) { out.absent++; out.absences.push({ meetingId: m.id, date: m.date }); }
    else if (has(att.present, person.name)) out.present++;
    out.attended.push({ meetingId: m.id, date: m.date, present: !away });
    for (const it of pm.items) {
      const v = it.vote || {};
      let how = has(v.no, person.name) ? "no" : has(v.abstain, person.name) ? "abstain" : has(v.yes, person.name) ? "yes" : "";
      const moved = has([it.motionBy], person.name), seconded = has([it.secondBy], person.name);
      if (moved) out.motions++;
      if (seconded) out.seconds++;
      if (how) out[how]++;
      if (how || moved || seconded) out.votes.push({ meetingId: m.id, date: m.date, idx: it.idx, title: it.title, how, moved, seconded, result: v.result || "", method: v.method || "", label: it.label, amount: it.amount, issue: it.issue });
    }
  }
  out.votes.sort((a, b) => b.date.localeCompare(a.date));
  out.attended.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export async function officials() {
  const { meetings, roster } = await load();
  const list = [];
  for (const body of TRACKED) for (const p of roster[body] || []) {
    const s = officialStats(p, body, meetings);
    delete s.votes; delete s.absences; delete s.attended;
    list.push(s);
  }
  return { officials: list, bodies: BODIES };
}

export async function official(body, s) {
  const { meetings, roster } = await load();
  const p = (roster[body] || []).find((x) => slug(x.name) === s);
  if (!p) return null;
  return { ...officialStats(p, body, meetings), role: BODIES[body]?.role };
}

// Plain word search across published meetings, agenda previews and reference documents.
export async function search(q) {
  const words = String(q || "").toLowerCase().split(/\s+/).filter((w) => w.length > 1).slice(0, 8);
  if (!words.length) return { results: [] };
  const { meetings } = await load();
  const score = (text) => { const t = text.toLowerCase(); let s = 0; for (const w of words) { if (!t.includes(w)) return 0; s += t.split(w).length - 1; } return s; };
  const results = [];
  for (const m of meetings) {
    if (isPublic(m)) {
      const pm = publicMeeting(m);
      for (const it of pm.items) {
        const text = [it.title, it.officialTitle, it.docNumber, it.whatItIs, it.whyItMatters, it.recipient, it.fundingSource, ...(it.parties || []).map((p) => p.name), ...(it.notes || []), ...(it.quotes || []).map((x) => `${x.speaker || ""} ${x.text}`)].join(" ");
        const s = score(text);
        if (s) results.push({ type: "item", score: s + 2, meetingId: m.id, date: m.date, bodyName: pm.bodyName, idx: it.idx, title: it.title, snippet: it.whatItIs, label: it.label, issue: it.issue });
      }
    }
    if (m.preview && m.date >= today()) for (const it of m.preview.items || []) {
      const s = score([it.title, it.officialTitle, it.docNumber, it.whatItIs, it.whyItMatters, it.location, it.recipient].join(" "));
      if (s) results.push({ type: "upcoming", score: s + 3, meetingId: m.id, date: m.date, bodyName: BODIES[m.body]?.name, title: it.title, snippet: it.whatItIs });
    }
  }
  for (const r of await listRefs()) {
    for (const f of [...(r.funds || []).map((x) => ({ ...x, kind: "fund" })), ...(r.generalFundDepartments || []).map((x) => ({ ...x, kind: "department" }))]) {
      const s = score(`${f.name} ${f.number || ""} ${f.note || ""}`);
      if (s) results.push({ type: "budget", score: s, refId: r.id, title: `${f.name} (${r.title})`, amount: f.budget ?? f.amount ?? null });
    }
    for (const o of r.observations || []) { const text = typeof o === "string" ? o : `${o.title || ""} ${o.text || ""}`; const s = score(text); if (s) results.push({ type: "budget", score: s, refId: r.id, title: r.title, snippet: text.slice(0, 240) }); }
  }
  results.sort((a, b) => b.score - a.score || (b.date || "").localeCompare(a.date || ""));
  return { results: results.slice(0, 60), total: results.length };
}

export async function refs() {
  return { refs: (await listRefs()).map(({ funds, generalFundDepartments, otherPropertyTaxDepartments, ...r }) => r) };
}
export const ref = (id) => getRef(id);
