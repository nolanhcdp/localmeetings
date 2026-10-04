// Storage on Upstash Redis (Vercel Marketplace, free tier). REST API, no packages.
const findEnv = (suffix) => {
  for (const k of ["KV_" + suffix, "UPSTASH_REDIS_" + suffix]) if (process.env[k]) return process.env[k];
  const isUrl = suffix.includes("URL");
  const k = Object.keys(process.env).find((n) => n.endsWith("_" + suffix) && /^https?:\/\//.test(process.env[n]) === isUrl);
  return k ? process.env[k] : undefined;
};
const URL_ = () => findEnv("REST_API_URL") || findEnv("REST_URL");
const TOKEN = () => findEnv("REST_API_TOKEN") || findEnv("REST_TOKEN");

export async function redis(...cmds) {
  if (!URL_() || !TOKEN()) throw new Error("Storage isn't connected. Add Upstash Redis to the Vercel project.");
  const res = await fetch(`${URL_()}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN()}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!res.ok) throw new Error(`Storage error ${res.status}`);
  const out = await res.json();
  for (const r of out) if (r.error) throw new Error(`Storage error: ${r.error}`);
  return out.map((r) => r.result);
}

export async function getJSON(key) {
  const [v] = await redis(["GET", key]);
  return v ? JSON.parse(v) : null;
}
export async function setJSON(key, value) {
  await redis(["SET", key, JSON.stringify(value)]);
  return value;
}
export async function getMany(keys) {
  if (!keys.length) return [];
  const [vals] = await redis(["MGET", ...keys]);
  return vals.map((v) => (v ? JSON.parse(v) : null));
}

// ---- Meetings: meeting:<id>, id = <body>-YYYY-MM-DD; index zset "meetings" scored by date
export const dateScore = (d) => Number(d.replaceAll("-", ""));
export async function saveMeeting(m) {
  m.updatedAt = new Date().toISOString();
  await redis(["SET", `meeting:${m.id}`, JSON.stringify(m)], ["ZADD", "meetings", dateScore(m.date), m.id]);
  return m;
}
export const getMeeting = (id) => getJSON(`meeting:${id}`);
export async function listMeetings() {
  const [ids] = await redis(["ZRANGE", "meetings", 0, -1, "REV"]);
  return (await getMany(ids.map((id) => `meeting:${id}`))).filter(Boolean);
}

// ---- Videos: video:<videoId> (includes transcript lines); index set "videos"
export async function saveVideo(v) {
  await redis(["SET", `video:${v.videoId}`, JSON.stringify(v)], ["SADD", "videos", v.videoId]);
  return v;
}
export const getVideo = (id) => getJSON(`video:${id}`);
export async function listVideos() {
  const [ids] = await redis(["SMEMBERS", "videos"]);
  const vids = (await getMany(ids.map((id) => `video:${id}`))).filter(Boolean);
  return vids.map(({ lines, ...rest }) => ({ ...rest, lineCount: lines?.length || 0 }));
}

// ---- Issues: issue:<key>; index set "issues"
export async function saveIssue(i) {
  await redis(["SET", `issue:${i.key}`, JSON.stringify(i)], ["SADD", "issues", i.key]);
  return i;
}
export async function listIssues() {
  const [keys] = await redis(["SMEMBERS", "issues"]);
  return (await getMany(keys.map((k) => `issue:${k}`))).filter(Boolean);
}
