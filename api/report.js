// "Report an error" from the public site. Stored for the review page; nothing is published from here.
import { redis } from "../lib/store.js";
import { json, fail } from "../lib/http.js";
export async function POST(request) {
  try {
    const p = await request.json();
    const text = String(p.text || "").trim().slice(0, 1500);
    if (text.length < 5) return fail("Please say what looks wrong.");
    const meetingId = /^[a-z0-9-]{3,60}$/.test(String(p.meetingId || "")) ? p.meetingId : null;
    const page = String(p.page || "").replace(/[^a-zA-Z0-9\/#_.%-]/g, "").slice(0, 200) || null;
    if (!meetingId && !page) return fail("Unknown page");
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const r = { id, meetingId, page, idx: Number.isInteger(p.idx) ? p.idx : null, text, contact: String(p.contact || "").slice(0, 200), at: new Date().toISOString() };
    await redis(["SET", `report:${id}`, JSON.stringify(r)], ["SADD", "reports", id]);
    return json({ ok: true });
  } catch (e) { return fail(e, 500); }
}
