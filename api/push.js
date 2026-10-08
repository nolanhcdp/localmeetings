// Push subscriptions from phones that have the site on their home screen. Public: subscribing is the person's own choice.
import { subscribe, unsubscribe, pushReady, setPrefs, getPrefs } from "../lib/push.js";
import { json, fail } from "../lib/http.js";
export async function GET() {
  return json({ ready: pushReady(), key: process.env.VAPID_PUBLIC_KEY || null });
}
export async function POST(request) {
  try {
    const p = await request.json();
    if (p.action === "unsubscribe") { await unsubscribe(p.endpoint); return json({ ok: true }); }
    if (p.action === "prefs") return json({ ok: true, prefs: await setPrefs(p.endpoint, p.prefs) });
    if (p.action === "getPrefs") return json({ prefs: await getPrefs(p.endpoint) });
    if (!pushReady()) return fail("Notifications aren't set up yet.", 503);
    const id = await subscribe(p.subscription, { ua: request.headers.get("user-agent") || "", prefs: p.prefs });
    return json({ ok: true, id });
  } catch (e) { return fail(e); }
}
