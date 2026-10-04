import { dailyRun } from "../lib/pipeline.js";
import { json, fail, isAdmin, isCron } from "../lib/http.js";
export const config = { maxDuration: 300 };
export async function GET(request) {
  if (!isCron(request) && !isAdmin(request)) return fail("Not allowed", 401);
  try { return json(await dailyRun()); } catch (e) { return fail(e, 500); }
}
