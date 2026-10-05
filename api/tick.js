// Frequent check, called every ~2 hours by GitHub Actions (.github/workflows/check.yml). Public on purpose: it does nothing
// if it already ran in the last 45 minutes, and it only previews a packet once, so it can't run up costs.
import { tick } from "../lib/pipeline.js";
import { json, fail, isAdmin, isCron } from "../lib/http.js";
export const config = { maxDuration: 300 };
export async function GET(request) {
  try { return json(await tick({ force: isAdmin(request) || isCron(request) })); } catch (e) { return fail(e, 500); }
}
