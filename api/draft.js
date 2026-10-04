import { draft } from "../lib/pipeline.js";
import { json, fail, isAdmin } from "../lib/http.js";
export const config = { maxDuration: 300 };
export async function POST(request) {
  if (!isAdmin(request)) return fail("Wrong admin code", 401);
  try {
    const { id } = await request.json();
    const m = await draft(id);
    return json({ ok: true, id: m.id, items: m.draft?.items?.length || 0, meta: m.draftMeta });
  } catch (e) { return fail(e, 500); }
}
