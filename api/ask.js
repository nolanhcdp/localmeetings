// The private Ask page. Core-group members sign in with their access code; Nolan's admin code works too.
import { ask, memberForCode, ADMIN_MEMBER, spendStatus, askLog, pinned, setPin } from "../lib/ask.js";
import { getJSON } from "../lib/store.js";
import { json, fail, isAdmin } from "../lib/http.js";
export const config = { maxDuration: 120 };

export async function POST(request) {
  try {
    const member = isAdmin(request) ? ADMIN_MEMBER : await memberForCode(request.headers.get("x-access-code"));
    if (!member) return fail("That code isn't active. Ask Nolan for one.", 401);
    const p = await request.json();
    const me = { name: member.name, research: !!member.research, admin: !!member.admin };
    switch (p.action) {
      case "whoami": return json({ me, spend: await spendStatus(member) });
      case "ask": {
        try { return json({ entry: await ask(member, p.question, p.mode), spend: await spendStatus(member) }); }
        catch (e) { return fail(e, e.status || 500); }
      }
      case "mine": return json({ entries: await askLog({ memberId: member.id, limit: 40 }) });
      case "pinned": return json({ entries: await pinned(member) });
      case "get": {
        const e = await getJSON(`ask:${String(p.id).replace(/[^a-f0-9]/g, "")}`);
        if (!e || (e.memberId !== member.id && !e.pinned && !member.admin) || (e.research && !member.research)) return fail("Not found", 404);
        return json({ entry: e });
      }
      case "pin": {
        const e = await getJSON(`ask:${String(p.id).replace(/[^a-f0-9]/g, "")}`);
        if (!e || (e.memberId !== member.id && !member.admin)) return fail("Only the person who asked (or Nolan) can pin this.", 403);
        return json({ entry: await setPin(e.id, p.on) });
      }
      default: return fail("Unknown action");
    }
  } catch (e) { return fail(e, 500); }
}
