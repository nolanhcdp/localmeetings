// Live-stream status for the "Happening now" bar. Public; refreshes at most every 2 minutes and only inside meeting windows.
import { refreshLive } from "../lib/live.js";
import { json, fail } from "../lib/http.js";
export async function GET() {
  try {
    const out = await refreshLive();
    const res = json(out);
    res.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=30");
    return res;
  } catch (e) { return fail(e, 500); }
}
