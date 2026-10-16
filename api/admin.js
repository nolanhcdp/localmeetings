// Everything the review screen needs, behind ADMIN_CODE.
import { listMeetings, getMeeting, saveMeeting, listVideos, getVideo, listIssues, saveIssue, getJSON, setJSON, listRefs, getRef, redis, getMany } from "../lib/store.js";
import { approve, unapprove, assignVideo, scanPackets, getRoster, readyToDraft, normalizeRecord, importFiles, rebuildAllIssues, rebuildIssuesFor, resolveItem, releasePrivacyHolds, exportForChat, scanArchive, matchArchiveVideos, archiveOverview, needsCheck, needsPreview, needsEnrich } from "../lib/pipeline.js";
import { itemLabel, recordOf } from "../lib/publish.js";
import { insights } from "../lib/insights.js";
import { listMembers, createMember, updateMember, askConfig, askLog, spendStatus, ADMIN_MEMBER } from "../lib/ask.js";
import { BODIES, GLOSSARY } from "../lib/county.js";
import { subCount, broadcast, pushReady, prefStats } from "../lib/push.js";
import { classifyIssue, KINDS } from "../lib/roadmaps.js";
import { dupeScan, dupeQueue, mergeIssues, relateIssues, dismiss, settlePair } from "../lib/issues.js";
import { editProject, projectFrom, handleScan, projectScan, projectQueue, applyProposal, dismissProposal, createProject, addParts, removePart, deleteProject, renameProject } from "../lib/projects.js";
import { videoInventory } from "../lib/live.js";
import { CHANNELS } from "../lib/county.js";
import { json, fail, isAdmin } from "../lib/http.js";
import { postsOverview, draftPost, markPosted, deleteDraft, saveStyle, tryStyle, suggestions, dismissIdea } from "../lib/posts.js";
import { calendar } from "../lib/public.js";
import { today as todayDate } from "../lib/pipeline.js";

// What needs a person: held items, open error reports, drafts that came back with no items
async function needsYou() {
  const meetings = await listMeetings();
  const held = [];
  for (const m of meetings) { normalizeRecord(m.draft); normalizeRecord(m.record); (recordOf(m)?.items || []).forEach((it, idx) => { if (itemLabel(m, it) === "held") held.push({ meetingId: m.id, body: m.body, date: m.date, idx, title: it.title, reason: it.hold?.reason || it.checkNote || "Sources disagree" }); }); }
  held.sort((a, b) => b.date.localeCompare(a.date));
  const broken = meetings.filter((m) => { const r = recordOf(m); return r && (m.draftProblem || (r.summary && !(r.items || []).length)); });
  const [ids] = await redis(["SMEMBERS", "reports"]);
  const reports = (await getMany((ids || []).map((id) => `report:${id}`))).filter((r) => r && !r.done);
  return { meetings, held, broken, reports };
}
export const config = { maxDuration: 60 };

const slim = (m) => { normalizeRecord(m.draft); normalizeRecord(m.record); return {
  id: m.id, body: m.body, date: m.date, title: m.title || "", status: m.status,
  hasPacket: !!m.packetUrl, hasMinutes: !!m.minutesUrl, hasVideo: !!m.videoId, hasTranscript: !!m.hasTranscript, edited: !!m.edited,
  items: (m.record || m.draft)?.items?.length || 0, error: m.error || "",
  needsCheck: ((m.record || m.draft)?.items || []).filter((i) => i.confidence === "low" || i.checkNote).length,
  minutesArrivedAfterDraft: !!m.minutesArrivedAfterDraft, videoArrivedAfterDraft: !!m.videoArrivedAfterDraft,
  ready: (m.status === "waiting" || m.status === "error") && readyToDraft(m),
  labels: (recordOf(m)?.items || []).reduce((a, it) => { const l = itemLabel(m, it); a[l] = (a[l] || 0) + 1; return a; }, {}),
  unpublished: !!m.unpublished, needsCheck: needsCheck(m), needsEnrich: needsEnrich(m), needsPreview: !!needsPreview(m), hasPreview: !!m.preview, previewError: m.previewError || "",
  minutesCheck: m.minutesCheck || null, scheduled: m.scheduled || null, cancelled: !!m.cancelled,
}; };

export async function POST(request) {
  if (!isAdmin(request)) return fail("Wrong admin code", 401);
  try {
    const p = await request.json();
    switch (p.action) {
      case "overview": {
        // One-time: issue timelines used to hold only approved meetings; now every published meeting counts.
        if (!(await getJSON("migrate:issues2"))) { await rebuildAllIssues(); await setJSON("migrate:issues2", { at: new Date().toISOString() }); }
        const [meetings, videos, lastRun, roster, lastTick] = await Promise.all([listMeetings(), listVideos(), getJSON("status:lastRun"), getRoster(), getJSON("status:lastTick")]);
        return json({ meetings: meetings.map(slim), videos, lastRun, lastTick, roster, bodies: BODIES });
      }
      case "meeting": {
        const m = await getMeeting(p.id);
        if (!m) return fail("No such meeting", 404);
        normalizeRecord(m.draft); normalizeRecord(m.record);
        const v = m.videoId ? await getVideo(m.videoId) : null;
        return json({ meeting: m, video: v ? { videoId: v.videoId, title: v.title, date: v.date, duration: v.duration, lineCount: v.lines?.length || 0 } : null, glossary: GLOSSARY, bodies: BODIES });
      }
      case "transcript": {
        const v = await getVideo(p.videoId);
        return json({ lines: v?.lines || [] });
      }
      case "save": { // save edits without approving
        const m = await getMeeting(p.id);
        if (m.status === "approved") m.record = p.record; else m.draft = p.record;
        m.edited = true;
        await saveMeeting(m);
        await rebuildIssuesFor(m);
        return json({ ok: true });
      }
      case "approve": return json({ ok: true, meeting: slim(await approve(p.id, p.record)) });
      case "unapprove": return json({ ok: true, meeting: slim(await unapprove(p.id)) });
      case "skip": { // not worth a record (e.g., cancelled meeting)
        const m = await getMeeting(p.id);
        m.status = p.undo ? "waiting" : "skipped";
        await saveMeeting(m);
        return json({ ok: true });
      }
      case "assign": return json({ ok: true, video: await assignVideo(p.videoId, p.body, p.date) });
      case "scan": return json(await scanPackets());
      case "archiveScan": return json(await scanArchive(p.year));
      case "archiveVideos": { // attach a year's videos to archive meetings as links; boards with no documents get their records from the videos
        const year = Number(p.year);
        const inv = {};
        for (const [id, gov] of Object.entries(CHANNELS)) inv[gov] = await videoInventory(id, year);
        return json({ year, ...(await matchArchiveVideos(year, inv)) });
      }
      case "archiveList": return json({ year: Number(p.year), meetings: await archiveOverview(p.year) });
      case "videoInventory": { // scoping past years: what each channel has for a year, with caption availability
        const year = Number(p.year) || new Date().getFullYear() - 1;
        const out = {};
        for (const [id, gov] of Object.entries(CHANNELS)) out[gov] = await videoInventory(id, year);
        return json({ year, ...out });
      }
      case "roster": await setJSON("config:roster", p.roster); return json({ ok: true });
      case "issues": return json({ issues: (await listIssues()).map((i) => ({ ...i, kind: classifyIssue(i), guessed: classifyIssue({ ...i, kindOverride: null }) })), kinds: KINDS });
      case "issueKind": { // admin override of the roadmap kind; "" clears the override, "none" means no roadmap
        const issues = await listIssues(); const i = issues.find((x) => x.key === p.key); if (!i) return fail("No such issue");
        if (p.kind && p.kind !== "none" && !KINDS.some((k) => k.kind === p.kind)) return fail("Unknown kind");
        if (p.kind) i.kindOverride = p.kind; else delete i.kindOverride;
        await saveIssue(i); return json({ kind: classifyIssue(i) });
      }
      // Duplicate issues: scan (repeat until pending is 0), then merge / link / dismiss what's left
      // Projects: one page above several issues (the jail's land, tax, bonds, contract, site plan)
      case "projects": return json(await projectQueue());
      case "projectScan": return json(await projectScan({ restart: !!p.restart }));
      case "projectApply": return json({ project: await applyProposal(p.clusterId, Number(p.index), { title: p.title, parts: p.parts }) });
      case "projectDismiss": return json(await dismissProposal(p.clusterId, Number(p.index)));
      case "projectCreate": return json({ project: await createProject({ title: p.title, parts: p.parts || [] }) });
      case "projectAdd": return json({ project: await addParts(p.key, p.parts || []) });
      case "projectRemove": return json(await removePart(p.part));
      case "projectDelete": return json(await deleteProject(p.key));
      case "projectRename": return json({ project: await renameProject(p.key, p.title) });
    case "projectEdit": return json({ project: await editProject(p.key, p.patch || {}) });
    case "projectFrom": return json(await projectFrom(p.key, { apply: !!p.apply }));
    case "projectHandles": return json(await handleScan({ maxCalls: Number(p.maxCalls) || 3 }));
      case "dupes": return json(await dupeQueue());
      case "dupeScan": return json(await dupeScan({ restart: !!p.restart, batch: Number(p.batch) || 20 }));
      case "dupeMerge": { if (!p.into || !p.from) return fail("Need into and from"); const i = await mergeIssues(p.into, p.from); await settlePair(p.into, p.from, "merged", i.key); return json({ ok: true, key: i.key, title: i.title, events: i.events.length }); }
      case "dupeRelate": { if (!p.a || !p.b) return fail("Need a and b"); await relateIssues(p.a, p.b, p.on !== false); await settlePair(p.a, p.b, p.on !== false ? "related" : "dismissed"); return json({ ok: true }); }
      case "dupeDismiss": { if (!p.a || !p.b) return fail("Need a and b"); await dismiss(p.a, p.b, "admin"); return json({ ok: true }); }
      case "issueTitle": { const issues = await listIssues(); const i = issues.find((x) => x.key === p.key); if (!i) return fail("No such issue"); i.title = String(p.title || "").trim() || i.title; await saveIssue(i); return json({ ok: true }); }
      case "import": return json({ ok: true, done: await importFiles(p.files || []) });
      case "releasePrivacyHolds": return json(await releasePrivacyHolds());
      case "refs": return json({ refs: (await listRefs()).map(({ funds, generalFundDepartments, otherPropertyTaxDepartments, ...r }) => r) });
      case "ref": return json({ ref: await getRef(p.id) });
      case "queue": { // held items across every meeting
        const out = [];
        for (const m of await listMeetings()) {
          normalizeRecord(m.draft); normalizeRecord(m.record);
          (recordOf(m)?.items || []).forEach((it, idx) => {
            if (itemLabel(m, it) !== "held") return;
            out.push({ meetingId: m.id, body: m.body, date: m.date, idx, title: it.title, whatItIs: it.whatItIs, vote: it.vote, amount: it.amount ?? null, motionBy: it.motionBy || "", secondBy: it.secondBy || "", reason: it.hold?.reason || it.checkNote || "Sources disagree", minutesFix: it.minutesFix || null, videoId: m.videoId || null, videoSeconds: it.videoSeconds ?? null, notes: it.notes || [] });
          });
        }
        out.sort((a, b) => b.date.localeCompare(a.date));
        const broken = [];
        for (const m of (await listMeetings()).filter((m) => { const r = recordOf(m); return r && (m.draftProblem || (r.summary && !(r.items || []).length)); })) {
          // Raw, un-normalized copy straight from storage, so the queue can show what Claude actually sent back
          const raw = await getJSON(`meeting:${m.id}`);
          const rd = raw?.status === "approved" ? raw?.record : raw?.draft;
          const items = rd?.items;
          const shape = items === undefined ? "missing" : items === null ? "null" : Array.isArray(items) ? `array of ${items.length}${items.length ? ` (${typeof items[0]})` : ""}` : typeof items;
          const sample = items === undefined ? "" : JSON.stringify(items).slice(0, 300);
          broken.push({ meetingId: m.id, body: m.body, date: m.date, problem: m.draftProblem || "The draft has a summary but no items; redraft it.", truncated: !!m.draftMeta?.truncated,
            diag: { shape, sample, keys: Object.keys(rd || {}).join(", "), draftedAt: m.draftMeta?.at || null, model: m.draftMeta?.model || null, outputTokens: m.draftMeta?.usage?.output_tokens ?? null, hadVideo: !!m.draftMeta?.hadVideo, hadPacket: !!m.draftMeta?.hadPacket, hadMinutes: !!m.draftMeta?.hadMinutes, itemsRaw: (rd?.itemsRaw || "").slice(0, 300), error: m.error || "", toolUses: m.draftMeta?.toolUses ?? null, stop: m.draftMeta?.stop || "", retried: !!m.draftMeta?.retried, retryError: m.draftMeta?.retryError || '', mode: m.draftMeta?.mode || '', transcriptChars: m.draftMeta?.transcriptChars ?? null, rawText: (m.draftRaw?.text || "").slice(0, 1200), rawInput: (m.draftRaw?.input || "").slice(0, 1500) } });
        }
        broken.sort((a, b) => b.date.localeCompare(a.date));
        const [ids] = await redis(["SMEMBERS", "reports"]);
        const reports = (await getMany(ids.map((id) => `report:${id}`))).filter((r) => r && !r.done).sort((a, b) => b.at.localeCompare(a.at));
        return json({ items: out, reports, broken, bodies: BODIES });
      }
      case "dismissReport": {
        const r = await getJSON(`report:${p.id}`);
        if (r) { r.done = true; await setJSON(`report:${p.id}`, r); }
        return json({ ok: true });
      }
      case "resolve": { const m = await resolveItem(p.id, p.idx, p.do); return json({ ok: true, meeting: slim(m) }); }
      case "publishMeeting": { // take a whole meeting off the public site, or put it back
        const m = await getMeeting(p.id);
        if (p.on) delete m.unpublished; else m.unpublished = true;
        await saveMeeting(m); await rebuildIssuesFor(m);
        return json({ ok: true });
      }
      case "rebuildIssues": return json(await rebuildAllIssues());
      case "export": return json({ exportedAt: new Date().toISOString(), meetings: await exportForChat() });
      case "insights": return json(await insights());
      case "members": {
        const members = await listMembers();
        const cfg = await askConfig();
        const spend = await spendStatus(ADMIN_MEMBER);
        const withDay = await Promise.all(members.map(async (m) => ({ ...m, codeHash: undefined, today: (await spendStatus(m)).dayCents })));
        return json({ members: withDay, config: cfg, monthCents: spend.monthCents, log: (await askLog({ limit: 60 })).map(({ answer, refs, ...e }) => ({ ...e, answer: answer.slice(0, 400) })) });
      }
      case "addMember": return json(await createMember(p));
      case "updateMember": return json({ member: await updateMember(p.id, p.patch || {}) });
      case "pushStatus": return json({ ready: pushReady(), subscribers: await subCount(), stats: await prefStats(), log: (await getJSON("push:log")) || [], since: await getJSON("push:since") });
      case "pushTest": return json(await broadcast({ title: "Test from Second Reading", body: "If you can read this, alerts work.", url: "/", tag: "test" }));
      case "pushSend": {
        const title = String(p.title || "").trim().slice(0, 80), body = String(p.body || "").trim().slice(0, 240);
        let url = String(p.url || "/").trim() || "/";
        if (!/^(\/|https?:\/\/)/.test(url)) url = "/" + url;
        if (!title) return fail("Give the alert a title.");
        return json(await broadcast({ title, body, url, tag: "custom-" + Date.now().toString(36) }));
      }
      case "askConfig": { const cfg = { monthlyCents: Math.max(0, Math.round(+p.monthlyCents || 0)), dailyCents: Math.max(0, Math.round(+p.dailyCents || 0)) }; await setJSON("config:ask", cfg); return json({ config: cfg }); }
      case "counts": {
        const [n, ideas, pq] = await Promise.all([needsYou(), suggestions().catch(() => []), projectQueue().catch(() => ({ review: [] }))]);
        return json({ needsYou: n.held.length + n.reports.length + n.broken.length + (pq.review?.length || 0), ideas: ideas.filter((x) => !x.posted && !x.drafted && !x.dismissed).length });
      }
      case "today": {
        const t = todayDate();
        const [n, ideas, cal, videos, lastRun, lastTick, spend, pq] = await Promise.all([needsYou(), suggestions().catch(() => []), calendar(), listVideos(), getJSON("status:lastRun"), getJSON("status:lastTick"), spendStatus(ADMIN_MEMBER).catch(() => ({})), projectQueue().catch(() => ({ review: [] }))]);
        const sl = n.meetings.map(slim);
        const plus7 = new Date(Date.parse(t + "T12:00:00Z") + 7 * 864e5).toISOString().slice(0, 10);
        return json({
          today: t, lastRun, lastTick, askMonthCents: spend.monthCents ?? null, bodies: BODIES,
          held: n.held.slice(0, 8), heldCount: n.held.length, reports: n.reports.length, projectReview: (pq.review || []).slice(0, 3).map((r) => ({ title: r.title, parts: r.parts.length, confidence: r.confidence })), projectReviewCount: (pq.review || []).length, broken: n.broken.map((m) => ({ id: m.id, body: m.body, date: m.date })),
          check: sl.filter((m) => m.needsCheck).map((m) => ({ id: m.id, body: m.body, date: m.date })),
          problems: sl.filter((m) => m.status === "error" || m.previewError).map((m) => ({ id: m.id, body: m.body, date: m.date, error: m.error || m.previewError })),
          ready: sl.filter((m) => m.ready).map((m) => ({ id: m.id, body: m.body, date: m.date })),
          unsorted: videos.filter((v) => !v.meetingId && !["other", "budget"].includes(v.body)).length,
          ideas: ideas.filter((x) => !x.posted && !x.dismissed).slice(0, 4), ideaCount: ideas.filter((x) => !x.posted && !x.drafted && !x.dismissed).length,
          upcoming: cal.meetings.filter((m) => !m.past && m.date >= t && m.date <= plus7).slice(0, 8).map((m) => ({ id: m.id, body: m.body, bodyName: m.bodyName, date: m.date, time: m.time, state: m.state, cancelled: m.cancelled, maybeCanceled: m.maybeCanceled, items: (m.items || []).length })),
        });
      }
      case "posts": return json(await postsOverview());
      case "postDraft": return json({ draft: await draftPost({ type: p.type, ref: p.ref, key: p.key, tweak: String(p.tweak || "").slice(0, 400), current: String(p.current || "").slice(0, 6000) }) });
      case "postMark": return json(await markPosted(p.key, p.on !== false));
      case "postDismiss": return json(await dismissIdea(String(p.key || ""), p.on !== false));
      case "postDelete": return json(await deleteDraft(p.key));
      case "postStyle": return json({ style: await saveStyle(p.style || {}) });
      case "postTry": return json({ draft: await tryStyle(p.style || {}) });
      default: return fail("Unknown action");
    }
  } catch (e) { return fail(e, 500); }
}
