// Public, read-only. Cached at Vercel's edge for a few minutes so the site stays fast and cheap.
import * as P from "../lib/public.js";
import { json, fail } from "../lib/http.js";
export const config = { maxDuration: 30 };

export async function GET(request) {
  const u = new URL(request.url), q = (k) => u.searchParams.get(k) || "";
  try {
    let out;
    switch (q("view")) {
      case "home": out = await P.home(); break;
      case "meetings": out = await P.meetings(q("body"), q("year")); break;
      case "decisions": out = await P.decisions(q("body"), q("year")); break;
      case "calendar": out = await P.calendar(); break;
      case "meeting": out = await P.meeting(q("id")); break;
      case "issues": out = await P.issuesList(); break;
      case "issue": out = await P.issue(q("key")); break;
      case "officials": out = await P.officials(q("year")); break;
      case "official": out = await P.official(q("body"), q("slug"), q("year")); break;
      case "search": out = await P.search(q("q")); break;
      case "refs": out = await P.refs(); break;
      case "ref": out = await P.ref(q("id")); break;
      default: return fail("Unknown view", 400);
    }
    if (!out) return fail("Not found", 404);
    const res = json(out);
    res.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=60");
    return res;
  } catch (e) { return fail(e, 500); }
}
