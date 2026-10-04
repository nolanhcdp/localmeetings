// Receives transcripts from the Mac job (multipart: meta + json3 file) and the browser button (JSON).
import { receiveVideo, missingTranscripts } from "../lib/pipeline.js";
import { linesFromJson3, linesFromSegments } from "../lib/transcript.js";
import { json, fail, isAdmin } from "../lib/http.js";
export const config = { maxDuration: 60 };

const normDate = (d) => {
  d = String(d || "").trim();
  if (/^\d{8}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  return "";
};

export async function POST(request) {
  if (!isAdmin(request)) return fail("Wrong admin code", 401);
  try {
    let meta, lines = null;
    const type = request.headers.get("content-type") || "";
    if (type.includes("multipart/form-data")) {
      const form = await request.formData();
      meta = JSON.parse(form.get("meta"));
      const file = form.get("subs");
      if (file && typeof file !== "string") lines = linesFromJson3(JSON.parse(await file.text()));
    } else {
      meta = await request.json();
      if (meta.json3) lines = linesFromJson3(meta.json3);
      else if (meta.segments) lines = linesFromSegments(meta.segments);
      else if (meta.lines) lines = meta.lines;
    }
    if (!/^[\w-]{11}$/.test(meta.videoId || "")) return fail("Missing video id");
    const date = normDate(meta.date);
    if (!date) return fail("Missing video date");
    const v = await receiveVideo({ videoId: meta.videoId, title: meta.title || "", date, duration: Number(meta.duration) || 0, lines, noCaptions: !lines?.length && !!meta.noCaptions, confirmed: !!meta.confirmed, channelId: meta.channelId || "" });
    return json({ ok: true, videoId: v.videoId, body: v.body || null, meetingId: v.meetingId || null, lines: lines?.length || 0 });
  } catch (e) { return fail(e, 500); }
}

// The Mac job asks which videos still need a transcript (e.g. ones YouTube refused with "too many requests").
export async function GET(request) {
  if (!isAdmin(request)) return fail("Wrong admin code", 401);
  try { return json({ missing: await missingTranscripts() }); } catch (e) { return fail(e, 500); }
}
