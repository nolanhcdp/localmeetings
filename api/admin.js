// Everything the review screen needs, behind ADMIN_CODE.
import { listMeetings, getMeeting, saveMeeting, listVideos, getVideo, listIssues, saveIssue, getJSON, setJSON, listRefs, getRef, redis, getMany } from "../lib/store.js";
import { approve, unapprove, assignVideo, scanPackets, getRoster, readyToDraft, normalizeRecord, importFiles, rebuildAllIssues, rebuildIssuesFor, resolveItem, refreshDateline, exportForChat, needsCheck, needsPreview, needsEnrich } from "../lib/pipeline.js";
import { itemLabel, recordOf } from "../lib/publish.js";
import { insights } from "../lib/insights.js";
import { listMembers, createMember, updateMember, askConfig, askLog, spendStatus, ADMIN_MEMBER } from "../lib/ask.js";
import { BODIES, GLOSSARY } from "../lib/county.js";
import { subCount, broadcast, pushReady, prefStats } from "../lib/push.js";
import { classifyIssue, KINDS } from "../lib/roadmaps.js";
import { json, fail, isAdmin } from "../lib/http.js";
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
      case "dateline": return json(await refreshDateline({ force: true }));
      case "roster": await setJSON("config:roster", p.roster); return json({ ok: true });
      case "issues": return json({ issues: (await listIssues()).map((i) => ({ ...i, kind: classifyIssue(i), guessed: classifyIssue({ ...i, kindOverride: null }) })), kinds: KINDS });
      case "issueKind": { // admin override of the roadmap kind; "" clears the override, "none" means no roadmap
        const issues = await listIssues(); const i = issues.find((x) => x.key === p.key); if (!i) return fail("No such issue");
        if (p.kind && p.kind !== "none" && !KINDS.some((k) => k.kind === p.kind)) return fail("Unknown kind");
        if (p.kind) i.kindOverride = p.kind; else delete i.kindOverride;
        await saveIssue(i); return json({ kind: classifyIssue(i) });
      }
      case "import": return json({ ok: true, done: await importFiles(p.files || []) });
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
      default: return fail("Unknown action");
    }
  } catch (e) { return fail(e, 500); }
}
