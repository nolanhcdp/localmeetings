// "Happening now": is a meeting streaming right now? Uses the YouTube Data API (YOUTUBE_API_KEY in Vercel),
// which Vercel can call directly; the Mac job is only needed for captions. Each refresh costs 4 quota units
// (two 1-unit calls per channel) out of the 10,000 the free key allows per day, so it only runs inside meeting
// windows (an hour before a scheduled meeting until a few hours after) and no more often than every 2 minutes.
import { CHANNELS, BODIES } from "./county.js";
import { listMeetings, saveMeeting, getJSON, setJSON } from "./store.js";
import { classify, dateFromText } from "./transcript.js";
import { today } from "./pipeline.js";
import { pushStarting } from "./push.js";

const CHANNEL_PAGES = { county: "https://www.youtube.com/@howardcountygovernmentindi4259/streams", city: "https://www.youtube.com/@KGOV2/streams" };
const MIN_GAP_MS = 2 * 60e3;
const SOON_MIN = 60;      // "Starting soon" from this many minutes before
const AFTER_MIN = 240;    // keep checking this long after the scheduled start when a stream is live (meetings run long)
const NO_STREAM_MIN = 120; // with no stream ever found, give up on "Happening now" this long after the start

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

// Live, upcoming and just-ended streams on a channel. Two cheap calls per channel (1 quota unit each): the channel's
// uploads playlist for recent video ids, then videos.list for their live status. (search.list costs 100 units a call
// and blew through the free daily quota in a single meeting window.)
export async function channelStreams(channelId) {
  const pl = await yt("playlistItems", { part: "contentDetails", playlistId: "UU" + channelId.slice(2), maxResults: 10 });
  const ids = (pl.items || []).map((i) => i.contentDetails?.videoId).filter(Boolean);
  if (!ids.length) return [];
  const v = await yt("videos", { part: "snippet,liveStreamingDetails", id: ids.join(",") });
  const out = [];
  for (const it of v.items || []) {
    const d = it.liveStreamingDetails; if (!d) continue; // never a broadcast
    const kind = it.snippet?.liveBroadcastContent; // live | upcoming | none
    const endedAgo = d.actualEndTime ? (Date.now() - Date.parse(d.actualEndTime)) / 60e3 : null;
    const live = kind === "live" || (!!d.actualStartTime && !d.actualEndTime && kind !== "upcoming");
    const upcoming = kind === "upcoming";
    const ended = !live && !upcoming && endedAgo != null && endedAgo < 8 * 60;
    if (!live && !upcoming && !ended) continue;
    out.push({ videoId: it.id, title: it.snippet?.title || "", live, upcoming, ended, channel: CHANNELS[channelId] || "", publishedAt: it.snippet?.publishedAt, scheduledStart: d.scheduledStartTime || null, actualEnd: d.actualEndTime || null });
  }
  return out;
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
    const startsIn = start - now.minutes;
    // Over: YouTube says the stream ended, or the stream we saw live is no longer live, or no stream was ever found and it's been a long while
    const over = (s?.ended) || (!error && m.liveSeenAt && !s?.live);
    if (over) { if (!m.liveEndedAt) { m.liveEndedAt = new Date().toISOString(); if (s) m.liveVideoId = s.videoId; await saveMeeting(m); } continue; }
    if (m.liveEndedAt && !s?.live) continue;
    if (!s?.live && now.minutes >= start + NO_STREAM_MIN) continue;
    const state = s?.live || (!s && now.minutes >= start) ? "now" : "soon";
    items.push({ id: m.id, body: m.body, bodyName: BODIES[m.body]?.name, date: m.date, time: m.preview?.time || m.scheduled?.time || "", location: m.preview?.location || m.scheduled?.location || "", state, startsIn, streaming: !!s?.live,
      streamUrl: s ? `https://www.youtube.com/watch?v=${s.videoId}` : CHANNEL_PAGES[gov], streamLabel: s?.live ? "Watch the live stream" : s ? "Live stream (scheduled)" : `Live stream on ${gov === "city" ? "KGOV2" : "the county's YouTube"}`, packetUrl: m.packetUrl || null });
    // About an hour out (or already under way): one notification per meeting
    if (startsIn <= SOON_MIN) await pushStarting(items[items.length - 1]).catch(() => null);
    // Remember the stream on the meeting so the video attaches without waiting for the Mac job
    if (s && (m.liveVideoId !== s.videoId || (s.live && !m.liveSeenAt))) { m.liveVideoId = s.videoId; if (s.live) m.liveSeenAt = new Date().toISOString(); await saveMeeting(m); }
  }
  const out = { at: new Date().toISOString(), items, windows: windows.length, error };
  await setJSON("status:live", out);
  return out;
}

// Is any meeting window open now? (Cheap: no API call.) The site uses this to decide whether to poll.
export async function anyWindowOpen() {
  return openWindows(await listMeetings()).length > 0;
}

// Inventory of a channel's videos for one year (for scoping past-year coverage): title, date, length, whether it was a
// stream, and whether YouTube has captions for it. Costs about 1 quota unit per 50 videos, twice.
export async function videoInventory(channelId, year) {
  const ids = [];
  let pageToken = "";
  for (let page = 0; page < 20; page++) {
    const pl = await yt("playlistItems", { part: "contentDetails,snippet", playlistId: "UU" + channelId.slice(2), maxResults: 50, ...(pageToken ? { pageToken } : {}) });
    let older = false;
    for (const it of pl.items || []) {
      const at = it.contentDetails?.videoPublishedAt || it.snippet?.publishedAt || "";
      if (at.startsWith(String(year))) ids.push(it.contentDetails.videoId);
      else if (at && at < `${year}-01-01`) older = true;
    }
    pageToken = pl.nextPageToken || "";
    if (older || !pageToken) break;
  }
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const v = await yt("videos", { part: "snippet,contentDetails,liveStreamingDetails", id: ids.slice(i, i + 50).join(",") });
    for (const it of v.items || []) {
      const d = it.contentDetails?.duration || "";
      const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || [];
      const minutes = (+m[1] || 0) * 60 + (+m[2] || 0) + Math.round((+m[3] || 0) / 60);
      out.push({ videoId: it.id, title: it.snippet?.title || "", date: (it.liveStreamingDetails?.actualStartTime || it.snippet?.publishedAt || "").slice(0, 10), minutes, live: !!it.liveStreamingDetails, captions: it.contentDetails?.caption === "true", channel: CHANNELS[channelId] || "" });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
