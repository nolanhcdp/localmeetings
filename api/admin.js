// Everything the review screen needs, behind ADMIN_CODE.
import { listMeetings, getMeeting, saveMeeting, listVideos, getVideo, listIssues, getJSON, setJSON, listRefs, getRef } from "../lib/store.js";
import { approve, unapprove, assignVideo, scanPackets, getRoster, readyToDraft, normalizeRecord, importFiles } from "../lib/pipeline.js";
import { BODIES, GLOSSARY } from "../lib/county.js";
import { json, fail, isAdmin } from "../lib/http.js";
export const config = { maxDuration: 60 };

const slim = (m) => { normalizeRecord(m.draft); normalizeRecord(m.record); return {
  id: m.id, body: m.body, date: m.date, title: m.title || "", status: m.status,
  hasPacket: !!m.packetUrl, hasMinutes: !!m.minutesUrl, hasVideo: !!m.videoId, hasTranscript: !!m.hasTranscript, edited: !!m.edited,
  items: (m.record || m.draft)?.items?.length || 0, error: m.error || "",
  needsCheck: ((m.record || m.draft)?.items || []).filter((i) => i.confidence === "low" || i.checkNote).length,
  minutesArrivedAfterDraft: !!m.minutesArrivedAfterDraft, videoArrivedAfterDraft: !!m.videoArrivedAfterDraft,
  ready: (m.status === "waiting" || m.status === "error") && readyToDraft(m),
}; };

export async function POST(request) {
  if (!isAdmin(request)) return fail("Wrong admin code", 401);
  try {
    const p = await request.json();
    switch (p.action) {
      case "overview": {
        const [meetings, videos, lastRun, roster] = await Promise.all([listMeetings(), listVideos(), getJSON("status:lastRun"), getRoster()]);
        return json({ meetings: meetings.map(slim), videos, lastRun, roster, bodies: BODIES });
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
      case "roster": await setJSON("config:roster", p.roster); return json({ ok: true });
      case "issues": return json({ issues: await listIssues() });
      case "import": return json({ ok: true, done: await importFiles(p.files || []) });
      case "refs": return json({ refs: (await listRefs()).map(({ funds, generalFundDepartments, otherPropertyTaxDepartments, ...r }) => r) });
      case "ref": return json({ ref: await getRef(p.id) });
      default: return fail("Unknown action");
    }
  } catch (e) { return fail(e, 500); }
}
