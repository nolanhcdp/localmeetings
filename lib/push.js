// Web Push: phones with Second Reading on the home screen get a heads-up before meetings and when write-ups land.
// Keys: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in Vercel (generate once with `npx web-push generate-vapid-keys`).
import webpush from "web-push";
import { createHash } from "node:crypto";
import { BODIES } from "./county.js";
import { redis, getJSON, setJSON, getMany, listMeetings } from "./store.js";
import { isPublic, recordOf } from "./publish.js";

export const pushReady = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
function configure() {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:hello@secondreading.org", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
}
const subId = (endpoint) => createHash("sha256").update(endpoint).digest("hex").slice(0, 24);

// What a person can choose. Announcements (custom sends from the admin page) always go to everyone.
export const KINDS = ["agenda", "starting", "published"];
export const GROUPS = { council: ["council"], commissioners: ["commissioners"], plan: ["plan"], "city-council": ["city-council"], "city-boards": ["city-plan", "city-bza", "city-works"] };
export const DEFAULT_PREFS = { kinds: [...KINDS], groups: Object.keys(GROUPS) };
export function cleanPrefs(p) {
  const kinds = Array.isArray(p?.kinds) ? KINDS.filter((k) => p.kinds.includes(k)) : [...KINDS];
  const groups = Array.isArray(p?.groups) ? Object.keys(GROUPS).filter((g) => p.groups.includes(g)) : Object.keys(GROUPS);
  return { kinds, groups };
}
const groupOf = (body) => Object.keys(GROUPS).find((g) => GROUPS[g].includes(body)) || null;
// Does this subscription want this notification? Announcements have no kind and always pass.
export function wants(sub, { kind, body }) {
  if (!kind) return true;
  const p = cleanPrefs(sub.prefs);
  if (!p.kinds.includes(kind)) return false;
  const g = groupOf(body);
  return !g || p.groups.includes(g);
}

export async function subscribe(sub, meta = {}) {
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error("Not a push subscription");
  const id = subId(sub.endpoint);
  const prev = await getJSON(`push:sub:${id}`);
  await setJSON(`push:sub:${id}`, { id, endpoint: sub.endpoint, keys: sub.keys, prefs: cleanPrefs(meta.prefs || prev?.prefs || DEFAULT_PREFS), createdAt: prev?.createdAt || new Date().toISOString(), seenAt: new Date().toISOString(), ua: String(meta.ua || "").slice(0, 160) });
  await redis(["SADD", "push:subs", id]);
  return id;
}
export async function setPrefs(endpoint, prefs) {
  const id = subId(String(endpoint || ""));
  const s = await getJSON(`push:sub:${id}`);
  if (!s) throw new Error("Alerts aren't turned on for this phone.");
  s.prefs = cleanPrefs(prefs); s.seenAt = new Date().toISOString();
  await setJSON(`push:sub:${id}`, s);
  return s.prefs;
}
export async function getPrefs(endpoint) {
  const s = await getJSON(`push:sub:${subId(String(endpoint || ""))}`);
  return s ? cleanPrefs(s.prefs) : null;
}
export async function unsubscribe(endpoint) {
  const id = subId(String(endpoint || ""));
  await redis(["DEL", `push:sub:${id}`], ["SREM", "push:subs", id]);
  return id;
}
export async function listSubs() {
  const [ids] = await redis(["SMEMBERS", "push:subs"]);
  return (await getMany(ids.map((id) => `push:sub:${id}`))).filter(Boolean);
}
export async function prefStats() {
  const subs = await listSubs();
  const kinds = Object.fromEntries(KINDS.map((k) => [k, 0])), groups = Object.fromEntries(Object.keys(GROUPS).map((g) => [g, 0]));
  for (const s of subs) { const p = cleanPrefs(s.prefs); p.kinds.forEach((k) => kinds[k]++); p.groups.forEach((g) => groups[g]++); }
  return { total: subs.length, kinds, groups };
}
export async function subCount() { const [n] = await redis(["SCARD", "push:subs"]); return n || 0; }

// Send one notification to everyone. Dead subscriptions (uninstalled, revoked) are dropped as they fail.
export async function broadcast({ title, body, url, tag, kind = null, meetingBody = null }) {
  if (!pushReady()) return { sent: 0, skipped: "no keys" };
  configure();
  const subs = await listSubs();
  const payload = JSON.stringify({ title, body: body || "", url: url || "/", tag: tag || "" });
  let sent = 0, dropped = 0, failed = 0, skipped = 0;
  for (const s of subs) {
    if (!wants(s, { kind, body: meetingBody })) { skipped++; continue; }
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 6 * 3600 }); sent++; }
    catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { await redis(["DEL", `push:sub:${s.id}`], ["SREM", "push:subs", s.id]); dropped++; }
      else failed++;
    }
  }
  const log = (await getJSON("push:log")) || [];
  log.unshift({ at: new Date().toISOString(), title, body, url, kind, sent, dropped, failed, skipped });
  await setJSON("push:log", log.slice(0, 50));
  return { sent, dropped, failed, skipped };
}

// Each event goes out once. The first run marks everything that already exists as sent, so a fresh deploy doesn't fire 80 old meetings.
async function onceOnly(key, fn) {
  const [added] = await redis(["SADD", "push:sent", key]);
  if (!added) return null;
  return fn();
}
const nowIndiana = () => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Indiana/Indianapolis", hour12: false, hour: "2-digit", weekday: "short", month: "short", day: "numeric" }).formatToParts(new Date()).map((p) => [p.type, p.value]));
const dayWord = (date, today) => { const d = (Date.parse(date + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) / 864e5; return d === 0 ? "today" : d === 1 ? "tomorrow" : d > 1 && d < 7 ? new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" }) : new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
const trim = (s, n = 140) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s\S*$/, "") + "…" : s; };

// Called at the end of every quick check and daily run: new agenda summaries and new write-ups go out, during waking hours.
export async function pushDigest({ today, force = false }) {
  if (!pushReady()) return { skipped: "no keys" };
  const since = await getJSON("push:since");
  if (!since) { // first run: remember the moment, and treat everything older as already announced
    await setJSON("push:since", new Date().toISOString());
    const ms = await listMeetings();
    const keys = ms.flatMap((m) => [m.preview ? `preview:${m.id}` : null, isPublic(m) ? `published:${m.id}` : null]).filter(Boolean);
    if (keys.length) await redis(["SADD", "push:sent", ...keys]);
    return { primed: keys.length };
  }
  const hour = Number(nowIndiana().hour) % 24;
  if (!force && (hour < 7 || hour >= 21)) return { quiet: true };
  const out = [];
  for (const m of await listMeetings()) {
    const name = BODIES[m.body]?.name || m.body;
    if (m.preview && m.date >= today && !m.cancelled && m.preview.at >= since) {
      const r = await onceOnly(`preview:${m.id}`, () => broadcast({ title: `${name} meets ${dayWord(m.date, today)}`, body: trim(m.preview.summary || `${m.preview.items?.length || 0} items on the agenda.`), url: `/#/m/${m.id}`, tag: `preview-${m.id}`, kind: "agenda", meetingBody: m.body }));
      if (r) out.push({ preview: m.id, ...r });
    }
    const rec = recordOf(m);
    const at = m.draftMeta?.at || m.approvedAt || "";
    if (isPublic(m) && at >= since && !m.archive) {
      const items = rec?.items || [];
      const passed = items.filter((i) => i.result === "passed").length;
      const r = await onceOnly(`published:${m.id}`, () => broadcast({ title: `What happened at ${name}`, body: trim(rec?.summary || `${items.length} items, ${passed} passed.`), url: `/#/m/${m.id}`, tag: `published-${m.id}`, kind: "published", meetingBody: m.body }));
      if (r) out.push({ published: m.id, ...r });
    }
  }
  return { sent: out };
}

// Called from the live check: once per meeting, about an hour before it starts (or when it's found already under way).
export async function pushStarting(item) {
  if (!pushReady() || !item) return null;
  const when = item.state === "now" ? "is under way" : item.startsIn > 1 ? `starts in ${item.startsIn} minutes` : "is starting";
  return onceOnly(`starting:${item.id}`, () => broadcast({ title: `${item.bodyName} ${when}`, body: item.streaming ? "Tap to watch the live stream." : `${item.time || ""}${item.location ? " · " + item.location : ""}`.trim(), url: `/#/m/${item.id}`, tag: `starting-${item.id}`, kind: "starting", meetingBody: item.body }));
}
