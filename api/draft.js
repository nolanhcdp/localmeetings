// Run one Claude job on demand from the review page: draft a meeting, check it against minutes, or preview an upcoming agenda.
import { draft, verify, preview, enrich } from "../lib/pipeline.js";
import { callCents } from "../lib/claude.js";
import { json, fail, isAdmin } from "../lib/http.js";
export const config = { maxDuration: 300 };
export async function POST(request) {
  if (!isAdmin(request)) return fail("Wrong admin code", 401);
  try {
    const { id, kind = "draft" } = await request.json();
    if (kind === "check") { const m = await verify(id); return json({ ok: true, id, check: m.minutesCheck, cents: m.minutesCheck?.cents || 0 }); }
    if (kind === "enrich") { const { m, cents } = await enrich(id); return json({ ok: true, id, cents }); }
    if (kind === "preview") { const m = await preview(id); return m.previewError ? fail(m.previewError, 500) : json({ ok: true, id, items: m.preview?.items?.length || 0 }); }
    const m = await draft(id);
    return json({ ok: true, id: m.id, items: m.draft?.items?.length || 0, meta: m.draftMeta, cents: Math.round(callCents(m.draftMeta?.usage) * 100) / 100 });
  } catch (e) { return fail(e, 500); }
}
