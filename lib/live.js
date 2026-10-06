// "Happening now": is a meeting streaming right now? Uses the YouTube Data API (YOUTUBE_API_KEY in Vercel),
// which Vercel can call directly; the Mac job is only needed for captions. Each refresh costs 2 search calls
// (one per channel, 100 units each) out of the 10,000 the free key allows per day, so it only runs inside meeting
// windows (an hour before a scheduled meeting until a few hours after) and no more often than every 2 minutes.
import { CHANNELS, BODIES } from "./county.js";
import { listMeetings, saveMeeting, getJSON, setJSON } from "./store.js";
import { classify, dateFromText } from "./transcript.js";
import { today } from "./pipeline.js";

const CHANNEL_PAGES = { county: "https://www.youtube.com/@howardcountygovernmentindi4259/streams", city: "https://www.youtube.com/@KGOV2/streams" };
const MIN_GAP_MS = 2 * 60e3;
const SOON_MIN = 60;      // "Starting soon" from this many minutes before
const AFTER_MIN = 240;    // keep checking this long after the scheduled start (meetings run long)

// Indiana local time as minutes since midnight, and today's date, without depending on the server's zone
function nowIndiana() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Indiana/Indianapolis", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
}
export const minutesOf = (t) => { const x = String(t || "").match(/(\d+):(\d+)\s*([ap])/i); if (!x) return null; return ((+x[1] % 12) + (/p/i.test(x[3]) ? 12 : 0)) * 60 + +x[2]; };

// Meetings whose window is open right now: scheduled today, from an hour before start until 4 hours after.
export function openWindows(meetings, now = nowIndiana()) {
  return meetings.filter((m) => {
    if (m.date !== now.date || m.cancelled) return false;
    const start = minutesOf(m.preview?.time || m.scheduled?.time);
    if (start == null) return false;
    return now.minutes >= start - SOON_MIN && now.minutes <= start + AFTER_MIN;
  }).map((m) => ({ m, start: minutesOf(m.preview?.time || m.scheduled?.time) }));
}

async function yt(path, params) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY isn't set in Vercel.");
  const u = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [k, v] of Object.entries({ ...params, key })) u.searchParams.set(k, v);
  const res = await fetch(u);
  if (!res.ok) { let d = ""; try { d = (await res.json()).error?.message || ""; } catch (e) {} throw new Error(`YouTube ${res.status}${d ? ": " + d.slice(0, 120) : ""}`); }
  return res.json();
}

// Live and upcoming streams on a channel right now (2 small calls per channel).
export async function channelStreams(channelId) {
  const out = [];
  for (const eventType of ["live", "upcoming"]) {
    const r = await yt("search", { part: "snippet", channelId, eventType, type: "video", maxResults: 5, order: "date" });
    for (const it of r.items || []) out.push({ videoId: it.id?.videoId, title: it.snippet?.title || "", live: eventType === "live", channel: CHANNELS[channelId] || "", publishedAt: it.snippet?.publishedAt });
  }
  return out.filter((s) => s.videoId);
}

// Pick the stream for a meeting: same channel, and the title names the body or a date that matches (county streams are often just "LIVE").
function matchStream(m, streams) {
  const gov = BODIES[m.body]?.gov;
  const same = streams.filter((s) => s.channel === gov);
  const byTitle = same.find((s) => { const c = classify(s.title, null, gov); return c.body === m.body || (c.fromTitle === false && dateFromText(s.title) === m.date); });
  if (byTitle) return byTitle;
  if (same.some((s) => { const c = classify(s.title, null, gov); return c.fromTitle && c.body !== m.body; }) && same.length === 1) return null; // the only stream is clearly another board
  // Otherwise: the one stream on this channel that isn't clearly another board (county streams are often titled just "LIVE")
  const neutral = same.filter((s) => { const c = classify(s.title, null, gov); return !(c.fromTitle && c.body !== m.body); });
  const live = neutral.filter((s) => s.live);
  if (live.length === 1) return live[0];
  return !live.length && neutral.length === 1 ? neutral[0] : null; // one live stream on the channel during this meeting's window: it's this meeting
}

// Refresh the live status. Returns the current state for the public site.
export async function refreshLive({ force = false } = {}) {
  const prev = (await getJSON("status:live")) || { at: null, items: [] };
  if (!force && prev.at && Date.now() - Date.parse(prev.at) < MIN_GAP_MS) return prev;
  const now = nowIndiana();
  const windows = openWindows(await listMeetings(), now);
  if (!windows.length) { const out = { at: new Date().toISOString(), items: [], windows: 0 }; await setJSON("status:live", out); return out; }
  let streams = [], error = "";
  try {
    const govs = [...new Set(windows.map(({ m }) => BODIES[m.body]?.gov))];
    for (const [channelId, gov] of Object.entries(CHANNELS)) if (govs.includes(gov)) streams.push(...(await channelStreams(channelId)));
  } catch (e) { error = e.message; }
  const items = [];
  for (const { m, start } of windows) {
    const s = matchStream(m, streams);
    const gov = BODIES[m.body]?.gov;
    const state = s?.live || (!s && now.minutes >= start) ? "now" : "soon";
    const startsIn = start - now.minutes;
    items.push({ id: m.id, body: m.body, bodyName: BODIES[m.body]?.name, date: m.date, time: m.preview?.time || m.scheduled?.time || "", location: m.preview?.location || m.scheduled?.location || "", state, startsIn, streaming: !!s?.live,
      streamUrl: s ? `https://www.youtube.com/watch?v=${s.videoId}` : CHANNEL_PAGES[gov], streamLabel: s?.live ? "Watch the live stream" : s ? "Live stream (scheduled)" : `Live stream on ${gov === "city" ? "KGOV2" : "the county's YouTube"}`, packetUrl: m.packetUrl || null });
    // Remember the stream on the meeting so the video attaches without waiting for the Mac job
    if (s && m.liveVideoId !== s.videoId) { m.liveVideoId = s.videoId; await saveMeeting(m); }
  }
  const out = { at: new Date().toISOString(), items, windows: windows.length, error };
  await setJSON("status:live", out);
  return out;
}

// Is any meeting window open now? (Cheap: no API call.) The site uses this to decide whether to poll.
export async function anyWindowOpen() {
  return openWindows(await listMeetings()).length > 0;
}
