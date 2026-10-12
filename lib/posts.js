// Facebook posts for the Second Reading Page. Suggestions are free (computed from the public views, so held or hidden
// items never reach a post); a draft is one Claude call. Everything here reads only what the public site shows.
import { calendar, decisions, meeting as pubMeeting, issue as pubIssue, issuesList } from "./public.js";
import { getJSON, setJSON } from "./store.js";
import { today } from "./pipeline.js";
import { callTool, callCents } from "./claude.js";
import { ROADMAPS, KINDS, roadmapFor } from "./roadmaps.js";
import { BODIES } from "./county.js";

const SITE = "secondreading.org";
const plusDays = (s, n) => new Date(Date.parse(s + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const weekday = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
const nice = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
const mondayOf = (d) => { const x = new Date(d + "T12:00:00Z"); return plusDays(d, -((x.getUTCDay() + 6) % 7)); };
const ROUTINE = ["minutes", "claims", "report"];
const money = (n) => n == null ? "" : n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, "")} million` : "$" + Math.round(n).toLocaleString("en-US");

export const TYPES = {
  headsup: { label: "Heads-up", what: "The day before or the morning of a meeting: the two or three items that matter most.", words: [90, 150] },
  week: { label: "The Week Ahead", what: "Monday: every meeting in the next seven days, one line each.", words: [80, 160] },
  decided: { label: "Decided.", what: "Friday: the five or six biggest results of the past week.", words: [110, 180] },
  second: { label: "Second Look", what: "When an issue moves a step: what it is, what just happened, what's next.", words: [80, 150] },
  numbers: { label: "By the Numbers", what: "One figure, what it is, and what it means.", words: [40, 80] },
  explain: { label: "Who Decides?", what: "How one kind of decision works, tied to something coming up when possible.", words: [80, 140] },
};

export const VOICES = {
  C: "Wry explainer. Short, clear lines. Dry, understated humor about how the process works (how many boards, how many meetings, what a board can and can't do), never about people, their motives, or whether something is good or bad. Calm and specific: the facts carry the post.",
  A: "Sharp and quick. Very short lines that hit hard. Lead with the single most striking fact. No jokes.",
  B: "Friendly neighbor. Conversational and warm, like explaining it over the fence. Plain comparisons are welcome (football fields, city blocks) when they're accurate.",
};

export const DEFAULT_STYLE = {
  voice: "C",
  emoji: "none", // none | one
  leadIns: "labels", // labels ("The rezoning: ...") | sentences
  firstLine: "news", // news | date
  whoDecides: true, // end with a "Who decides:" line when there's a decision ahead
  finePrint: true, // allow a "Fine print:" line for a detail most people would miss
  linkLead: "",
  signoff: "",
  banned: ["controversial", "finally", "quietly", "slammed", "rammed", "shocking", "breaking", "outrage", "sneaky"],
  words: Object.fromEntries(Object.entries(TYPES).map(([k, t]) => [k, t.words])),
  notes: "",
};

export async function getStyle() { return { ...DEFAULT_STYLE, ...((await getJSON("config:postStyle")) || {}) }; }
export async function saveStyle(s) {
  const clean = { ...DEFAULT_STYLE };
  for (const k of Object.keys(DEFAULT_STYLE)) if (s?.[k] !== undefined) clean[k] = s[k];
  clean.banned = (Array.isArray(clean.banned) ? clean.banned : String(clean.banned).split(/[,\n]/)).map((w) => String(w).trim()).filter(Boolean).slice(0, 60);
  for (const k of Object.keys(TYPES)) { const w = clean.words?.[k]; clean.words[k] = Array.isArray(w) && w.length === 2 ? w.map((n) => Math.max(10, Math.min(400, Math.round(+n) || 0))) : TYPES[k].words; }
  clean.notes = String(clean.notes || "").slice(0, 2000); clean.linkLead = String(clean.linkLead || "").slice(0, 120); clean.signoff = String(clean.signoff || "").slice(0, 160);
  if (!VOICES[clean.voice]) clean.voice = "C";
  await setJSON("config:postStyle", clean);
  return clean;
}

const getDrafts = async () => (await getJSON("posts:drafts")) || {};
const getLog = async () => (await getJSON("posts:log")) || [];

// ---------- What's worth posting right now (no API calls)
const loadViews = () => Promise.all([calendar(), decisions("", ""), issuesList()]);
export async function suggestions(views) {
  const t = today();
  const [[cal, dec, iss], drafts, log] = await Promise.all([views || loadViews(), getDrafts(), getLog()]);
  const posted = new Set(log.map((l) => l.key));
  const out = [];
  const add = (s) => out.push({ ...s, label: TYPES[s.type].label, drafted: !!drafts[s.key], posted: posted.has(s.key) });

  // Heads-up: previewed meetings today through two days out
  for (const m of cal.meetings.filter((m) => !m.past && !m.cancelled && m.date >= t && m.date <= plusDays(t, 2) && m.state === "previewed")) {
    const big = (m.items || []).filter((i) => !ROUTINE.includes(i.category)).length;
    add({ type: "headsup", ref: m.id, key: `headsup:${m.id}`, title: `${m.bodyName}, ${m.date === t ? "today" : m.date === plusDays(t, 1) ? "tomorrow" : weekday(m.date)}`, why: `${big} item${big === 1 ? "" : "s"} on the agenda${m.items?.some((i) => i.publicHearing) ? ", with a public hearing" : ""}.`, when: m.date });
  }
  // The Week Ahead: always available for the coming seven days
  const wk = cal.meetings.filter((m) => !m.past && m.date >= t && m.date <= plusDays(t, 6));
  add({ type: "week", ref: t, key: `week:${mondayOf(t)}`, title: `Next seven days (${wk.length} meeting${wk.length === 1 ? "" : "s"})`, why: new Date(t + "T12:00:00Z").getUTCDay() === 1 ? "It's Monday." : "Best posted Monday.", when: t });
  // Decided.: the past seven days
  const recent = dec.meetings.filter((m) => m.date >= plusDays(t, -7) && m.date <= t);
  if (recent.length) add({ type: "decided", ref: t, key: `decided:${mondayOf(t)}`, title: `Past seven days (${recent.reduce((a, m) => a + m.items.length, 0)} decisions)`, why: new Date(t + "T12:00:00Z").getUTCDay() === 5 ? "It's Friday." : "Best posted Friday.", when: t });
  // Second Look: issues with a roadmap that moved in the last ten days and have more than one step on record
  for (const i of iss.issues.filter((i) => i.kind && i.count >= 2 && (i.lastDate || "") >= plusDays(t, -10)).slice(0, 6))
    add({ type: "second", ref: i.key, key: `second:${i.key}:${i.lastDate}`, title: i.title, why: `Moved ${i.lastDate === t ? "today" : `on ${nice(i.lastDate)}`}${i.progress?.next ? `. Next: ${i.progress.next.title}` : ""}.`, when: i.lastDate });
  // By the Numbers: the biggest approved amounts in the last two weeks
  const amounts = dec.meetings.filter((m) => m.date >= plusDays(t, -14)).flatMap((m) => m.items.filter((i) => i.amount >= 100000 && i.result === "passed" && !ROUTINE.includes(i.category)).map((i) => ({ m, i })))
    .sort((a, b) => b.i.amount - a.i.amount).slice(0, 4);
  for (const { m, i } of amounts) add({ type: "numbers", ref: `${m.id}:${i.idx}`, key: `numbers:${m.id}:${i.idx}`, title: `${money(i.amount)}: ${i.title}`, why: `${m.bodyName}, ${nice(m.date)}.`, when: m.date });
  // Who Decides?: the kinds of decisions on upcoming agendas
  const kindOf = new Map(iss.issues.map((i) => [i.key, i.kind]));
  const soon = cal.meetings.filter((m) => !m.past && !m.cancelled && m.date >= t && m.date <= plusDays(t, 10));
  const kinds = new Map();
  for (const m of soon) for (const it of m.items || []) { const k = it.issue && kindOf.get(it.issue.key); if (k && !kinds.has(k)) kinds.set(k, { m, it }); }
  for (const [k, { m, it }] of [...kinds].slice(0, 3)) add({ type: "explain", ref: k, key: `explain:${k}:${mondayOf(t)}`, title: ROADMAPS[k]?.label || k, why: `Comes up at the ${m.bodyName} on ${nice(m.date)} (${it.title}).`, when: m.date });
  return out;
}

// Choices for "Draft a post" when you pick the subject yourself
export async function targets(views) {
  const t = today();
  const [cal, dec, iss] = views || await loadViews();
  return {
    upcoming: cal.meetings.filter((m) => !m.past && !m.cancelled && m.date >= t && m.date <= plusDays(t, 14)).map((m) => ({ ref: m.id, label: `${m.bodyName}, ${nice(m.date)}${m.state === "previewed" ? "" : " (no preview yet)"}` })),
    issues: iss.issues.slice(0, 60).map((i) => ({ ref: i.key, label: i.title })),
    amounts: dec.meetings.filter((m) => m.date >= plusDays(t, -45)).flatMap((m) => m.items.filter((i) => i.amount > 0).map((i) => ({ ref: `${m.id}:${i.idx}`, label: `${money(i.amount)}: ${i.title} (${BODIES[m.body]?.short || m.bodyName}, ${m.date})`, amount: i.amount }))).sort((a, b) => b.amount - a.amount).slice(0, 40),
    kinds: KINDS.map((k) => ({ ref: k.kind, label: k.label })),
  };
}

// ---------- The facts a draft may use
async function roadmapBrief(key, body, item = null, date = "") {
  const i = key ? await pubIssue(key) : null;
  // An item that's new on an agenda has no issue record yet: place it on its road from the agenda item itself
  const r = i?.roadmap || (item && body ? roadmapFor({ title: item.title, events: [{ body, date: date || today(), title: item.title, category: item.category, about: item.whatItIs || "" }] }, { today: today() }) : null);
  if (!r) return i ? { issue: i.title } : null;
  const steps = r.steps.filter((s) => s.state !== "skipped");
  const here = body ? steps.find((s) => s.bodies?.includes(body) && s.state !== "done") || steps.find((s) => s.bodies?.includes(body)) : null;
  const final = steps.find((s) => s.final);
  return {
    issue: i?.title || item?.title || "", kind: r.label, ...(i?.roadmap ? { stepsDone: r.done, stepsTotal: r.total } : { stepsTotal: r.total, note: "This meeting is the first step on record." }),
    thisStep: here ? { title: here.title, board: here.bodyName, publicCanSpeak: here.speak === "right" ? "yes, a public hearing the law requires" : here.speak === "custom" ? "usually, but not required" : "no" } : null,
    finalSay: final ? final.bodyName : "", next: i?.roadmap && r.next ? `${r.next.title} (${r.next.bodyName})` : "", afterThis: !i?.roadmap ? steps.filter((s) => s !== here).map((s) => `${s.title} (${s.bodyName})`) : undefined, why: r.why,
  };
}

const link = (type, ref) => type === "headsup" || type === "numbers" ? `${SITE}/#/m/${String(ref).split(":")[0]}` : type === "second" ? `${SITE}/#/i/${ref}` : type === "week" ? `${SITE}/#/calendar` : type === "decided" ? `${SITE}/#/decisions` : `${SITE}/#/about`;

async function factsFor(type, ref) {
  const t = today();
  const base = { today: `${nice(t)} (${t})`, tomorrow: nice(plusDays(t, 1)) };
  if (type === "headsup") {
    const m = await pubMeeting(ref);
    const u = m?.upcoming;
    if (!u) throw new Error("That meeting has no agenda preview yet.");
    const items = [];
    for (const it of u.items.filter((i) => !ROUTINE.includes(i.category))) items.push({ title: it.title, whatItIs: it.whatItIs, whyItMatters: it.whyItMatters, amount: it.amount, publicHearing: it.publicHearing, step: it.step, parties: (it.parties || []).map((p) => p.name), location: it.location, roadmap: await roadmapBrief(it.issue?.key, u.body, it, u.date) });
    return { ...base, meeting: { board: u.bodyName, government: u.gov === "city" ? "City of Kokomo" : "Howard County", day: nice(u.date), date: u.date, time: u.time, location: u.location, summary: u.summary, special: u.special }, items };
  }
  if (type === "week") {
    const cal = await calendar();
    return { ...base, meetings: cal.meetings.filter((m) => !m.past && m.date >= ref && m.date <= plusDays(ref, 6)).map((m) => ({ board: m.bodyName, government: m.gov, day: nice(m.date), time: m.time, cancelled: m.cancelled, maybeCanceled: m.maybeCanceled, agenda: m.state === "previewed" ? "posted and previewed" : m.state === "agenda" ? "posted, not yet previewed" : "not posted yet", special: m.special, topItems: (m.items || []).filter((i) => !ROUTINE.includes(i.category)).slice(0, 4).map((i) => ({ title: i.title, amount: i.amount, publicHearing: i.publicHearing })) })) };
  }
  if (type === "decided") {
    const dec = await decisions("", "");
    const ms = dec.meetings.filter((m) => m.date >= plusDays(ref, -7) && m.date <= ref);
    const out = [];
    for (const s of ms) {
      const m = await pubMeeting(s.id);
      out.push({ board: m.bodyName, government: m.gov, day: nice(m.date), items: (m.items || []).filter((i) => !ROUTINE.includes(i.category) && i.result && i.result !== "no vote").map((i) => ({ title: i.title, result: i.result, stage: i.stage, amount: i.amount, docNumber: i.docNumber, whatItIs: i.whatItIs, voteNote: i.vote?.note || "", votedNo: i.vote?.no || [], nextStep: i.nextStep?.text || "", recipient: i.recipient, uncertain: i.uncertain })) });
    }
    return { ...base, note: "A first reading that 'passed' is not final; it comes back for another vote. 'recommended favorably' is a recommendation, not a decision.", meetings: out.filter((m) => m.items.length) };
  }
  if (type === "second") {
    const i = await pubIssue(ref);
    if (!i) throw new Error("No such issue.");
    const r = i.roadmap;
    return { ...base, issue: i.title, history: i.events.map((e) => ({ day: nice(e.date), board: e.bodyName, title: e.title, stage: e.stage, whatItIs: e.whatItIs, result: e.vote?.result || "", votedNo: e.vote?.no || [] })), coming: i.coming.map((c) => ({ day: nice(c.date), board: c.bodyName, items: c.items })),
      roadmap: r ? { kind: r.label, intro: r.intro, steps: r.steps.filter((s) => s.state !== "skipped").map((s) => ({ title: s.title, board: s.bodyName, state: s.state, publicCanSpeak: s.speak, final: s.final })), after: r.after, why: r.why, next: r.next ? `${r.next.title} (${r.next.bodyName})` : "" } : null };
  }
  if (type === "numbers") {
    const [id, idx] = String(ref).split(":");
    const m = await pubMeeting(id);
    const it = m?.items?.find((x) => String(x.idx) === idx);
    if (!it) throw new Error("That item isn't public.");
    return { ...base, board: m.bodyName, government: m.gov, day: nice(m.date), item: { title: it.title, amount: it.amount, result: it.result, stage: it.stage, whatItIs: it.whatItIs, whyItMatters: it.whyItMatters, recipient: it.recipient, fundingSource: it.fundingSource, docNumber: it.docNumber, nextStep: it.nextStep?.text || "" }, roadmap: await roadmapBrief(it.issue?.key, m.body) };
  }
  if (type === "explain") {
    const road = ROADMAPS[ref];
    if (!road) throw new Error("Unknown kind of decision.");
    const flat = (v) => typeof v === "string" || !v ? v || "" : road.gov ? v[road.gov] || "" : `County: ${v.county} City: ${v.city}`;
    const cal = await calendar(); const iss = await issuesList();
    const kindOf = new Map(iss.issues.map((i) => [i.key, i.kind]));
    const tieIns = cal.meetings.filter((m) => !m.past && !m.cancelled && m.date >= today()).flatMap((m) => (m.items || []).filter((it) => it.issue && kindOf.get(it.issue.key) === ref).map((it) => ({ board: m.bodyName, day: nice(m.date), title: it.title }))).slice(0, 3);
    return { ...base, kind: road.label, government: road.gov || "both (wording differs; say which you mean)", intro: flat(road.intro), steps: road.steps.map((s) => ({ title: flat(s.title), board: Array.isArray(s.body) ? s.body.map((b) => BODIES[b]?.name || "staff").join(" or ") : BODIES[s.body]?.name || "staff", what: flat(s.what), publicCanSpeak: s.speak, final: !!s.final })), after: flat(road.after), why: flat(road.why), law: road.law, comingUp: tieIns };
  }
  throw new Error("Unknown post type.");
}

// Which boards a post is about, from the board names in its facts (for the image colors)
const BOARD_BY_NAME = new Map(Object.entries(BODIES).flatMap(([k, b]) => [[b.name.toLowerCase(), k], [String(b.short || "").toLowerCase(), k]]));
const boardKey = (name) => BOARD_BY_NAME.get(String(name || "").trim().toLowerCase()) || "";
function boardsIn(facts) {
  const found = [];
  const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (k === "board" && typeof x === "string") x.split(/ or /).forEach((n) => { const b = boardKey(n); if (b && !found.includes(b)) found.push(b); }); else walk(x); } };
  walk(facts);
  return found;
}

// ---------- Drafting
const POST_TOOL = {
  name: "save_post", description: "Save the Facebook post and the text for its image.",
  input_schema: {
    type: "object", required: ["text", "card"],
    properties: {
      text: { type: "string", description: "The post, plain text, blank line between paragraphs. No link (it is added after)." },
      card: { type: "object", required: ["headline", "points"], properties: {
        headline: { type: "string", description: "The biggest words on the image, at most 7 words. Must carry meaning (e.g. '390 acres for heavy industry'), never empty framing like 'Heads up' or 'This week'." },
        sub: { type: "string", description: "One supporting line, at most 12 words." },
        points: { type: "array", maxItems: 4, items: { type: "object", required: ["label", "text"], properties: { label: { type: "string", description: "1-3 words" }, text: { type: "string", description: "At most 14 words" }, board: { type: "string", description: "When the post covers more than one board: the board this point is about, exactly as named in the facts. Empty if the point isn't about one board." } } } },
      } },
      checks: { type: "array", items: { type: "string" }, description: "Anything the editor should double-check before posting (a fact that looked inconsistent, a missing detail). Empty if none." },
    },
  },
};

function systemFor(type, style) {
  const [lo, hi] = style.words?.[type] || TYPES[type].words;
  return `You write Facebook posts for Second Reading, an independent, nonpartisan site that follows Kokomo and Howard County, Indiana government meetings. The site's line is "So every vote has a witness."

THIS POST: ${TYPES[type].label}. ${TYPES[type].what}

VOICE: ${VOICES[style.voice] || VOICES.C}

FACTS ARE THE ONLY SOURCE
- Use only the facts provided. Every number, date, place, board and name must come from them. Round only for readability ($128,285,532 is "$128.3 million"; 334.95 acres is "about 335 acres").
- Kokomo (the city) and Howard County are separate governments. The mayor, Common Council, Kokomo Plan Commission, BZA and Board of Public Works and Safety are city. The Commissioners, County Council and County Plan Commission are county. Never mix them.
- Say who has the final say exactly as the facts give it. A Plan Commission recommendation is not a decision. A first reading is not a final vote.
- Say residents can speak only when the facts say there's a public hearing or publicCanSpeak is "right"/"yes".
- If the record leaves out something a reader would obviously want (what will be built, who the buyer is, the cost), you may say plainly that the record doesn't say. Never guess.
- Never characterize people, motives or merits. Humor is only about the process. Never mention AI.

FORMAT
- Plain text for Facebook: no markdown, no asterisks, no hashtags, no exclamation points, no all caps, no bullet symbols.
- ${style.firstLine === "date" ? "The first line gives the day and the board, then the news." : "The first line is the news itself (the most important fact), not a greeting, a date, or framing like 'Heads up'. Facebook shows only two or three lines before 'See more'."}
- One idea per short paragraph, blank line between them.
- ${style.leadIns === "labels" ? "Items start with a short label and a colon, e.g. 'The rezoning: ...'." : "Items are full sentences, no label-and-colon lead-ins."}
- Days and times look like "Tuesday, Oct. 13, 5 p.m." Use "today" or "tomorrow" when that's accurate.
- ${style.whoDecides ? "When a decision is still ahead, include a line starting 'Who decides:'." : "No 'Who decides:' line."}
- ${style.finePrint ? "When the facts include a telling detail most people would miss, you may add one line starting 'Fine print:'." : "No 'Fine print:' line."}
- ${style.emoji === "one" ? "Each item may start with one fitting emoji. Nowhere else." : "No emoji."}
- Never open with what people think or have said ("A lot of people...", "People told me...").
- Length: ${lo} to ${hi} words.
- Never use these words: ${(style.banned || []).join(", ") || "(none)"}.
${style.notes ? `\nEDITOR'S NOTES (follow these):\n${style.notes}\n` : ""}
Also write the text for the post's image (card). Respond by calling save_post.`;
}

export async function draftPost({ type, ref, tweak = "", current = "", key, styleOverride = null, save = true }) {
  if (!TYPES[type]) throw new Error("Unknown post type.");
  const style = styleOverride ? { ...DEFAULT_STYLE, ...styleOverride } : await getStyle();
  const facts = await factsFor(type, ref);
  key = key || `${type}:${ref}`;
  const drafts = await getDrafts();
  const prev = drafts[key];
  let msg = `FACTS (JSON):\n${JSON.stringify(facts)}`;
  const earlier = String(current || prev?.text || "").split("\n").filter((l) => !l.includes(SITE) && (!style.signoff || l.trim() !== style.signoff.trim())).join("\n").trim();
  if (tweak && earlier) msg += `\n\nYOUR EARLIER DRAFT:\n${earlier}\n\nREVISE IT: ${tweak}. Keep everything else that works, and keep every rule above.`;
  const r = await callTool(systemFor(type, style), msg, POST_TOOL);
  const text = String(r.text || "").split("\n").filter((l) => !l.toLowerCase().includes(SITE)).join("\n").replace(/\*\*/g, "").replace(/\n{3,}/g, "\n\n").trim();
  const url = link(type, ref);
  const tail = [style.linkLead ? `${style.linkLead} ${url}` : url, style.signoff].filter(Boolean).join("\n\n");
  const out = { key, type, ref, label: TYPES[type].label, text: `${text}\n\n${tail}`, card: { series: TYPES[type].label, headline: r.card?.headline || "", sub: r.card?.sub || "", points: (r.card?.points || []).slice(0, 4).map((p) => ({ label: p.label, text: p.text, board: boardKey(p.board) })), boards: boardsIn(facts), url: SITE }, checks: r.checks || [], cents: Math.round(callCents(r._usage) * 10) / 10, at: new Date().toISOString(), tweak };
  if (save) {
    drafts[key] = out;
    const keep = Object.values(drafts).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 80);
    await setJSON("posts:drafts", Object.fromEntries(keep.map((d) => [d.key, d])));
  }
  return out;
}

export async function postsOverview() {
  const views = await loadViews();
  const [list, drafts, style, log, tg] = await Promise.all([suggestions(views), getDrafts(), getStyle(), getLog(), targets(views)]);
  return { suggestions: list, drafts: Object.values(drafts).sort((a, b) => b.at.localeCompare(a.at)), style, defaults: DEFAULT_STYLE, voices: VOICES, types: TYPES, log: log.slice(0, 50), targets: tg };
}

export async function markPosted(key, on = true) {
  let log = await getLog();
  log = log.filter((l) => l.key !== key);
  if (on) { const d = (await getDrafts())[key]; log.unshift({ key, type: d?.type || key.split(":")[0], at: new Date().toISOString(), text: (d?.text || "").slice(0, 160) }); }
  await setJSON("posts:log", log.slice(0, 300));
  return { ok: true };
}
export async function deleteDraft(key) { const d = await getDrafts(); delete d[key]; await setJSON("posts:drafts", d); return { ok: true }; }

// "Try it": redraft a real post with unsaved settings, without saving anything
export async function tryStyle(style) {
  const list = await suggestions();
  const pick = list.find((s) => s.type === "headsup") || list.find((s) => s.type === "decided") || list[0];
  if (!pick) throw new Error("Nothing to try it on yet.");
  return draftPost({ type: pick.type, ref: pick.ref, key: pick.key, styleOverride: style, save: false });
}
