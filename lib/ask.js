// "Ask": Claude answers questions for Nolan's core group by querying the meeting records with tools
// (never the raw PDFs or transcripts), so a question costs cents. Spending is capped per person per day
// and for the whole page per month, and every question is logged with its cost.
import crypto from "node:crypto";
import { BODIES, TRACKED } from "./county.js";
import { listMeetings, listIssues, listRefs, getJSON, setJSON, redis, getMany } from "./store.js";
import { getRoster, today, normalizeRecord } from "./pipeline.js";
import { recordOf, itemLabel } from "./publish.js";

// ---- Models and prices (USD per million tokens; platform.claude.com, Oct 2026)
export const MODES = {
  quick: { model: () => process.env.ASK_QUICK_MODEL || "claude-haiku-4-5-20251001", price: [1, 5], rounds: 5, maxTokens: 1500, ceilingCents: 10 },
  deep: { model: () => process.env.ASK_DEEP_MODEL || "claude-sonnet-5-5", price: [2, 10], rounds: 9, maxTokens: 4000, ceilingCents: 50 },
};
const costCents = (u, [inP, outP]) => ((u.input_tokens || 0) * inP + (u.cache_creation_input_tokens || 0) * inP * 1.25 + (u.cache_read_input_tokens || 0) * inP * 0.1 + (u.output_tokens || 0) * outP) / 1e4;

// ---- Members (access codes). Codes are stored hashed; the code itself is shown once when created.
const hash = (code) => crypto.createHash("sha256").update(String(code).trim().toLowerCase()).digest("hex");
export const DEFAULTS = { monthlyCents: 2500, dailyCents: 100 };
export const askConfig = async () => ({ ...DEFAULTS, ...((await getJSON("config:ask")) || {}) });

export async function listMembers() {
  const [ids] = await redis(["SMEMBERS", "members"]);
  return (await getMany(ids.map((id) => `member:${id}`))).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}
export async function createMember({ name, research = false, dailyCents = null }) {
  const words = ["oak", "river", "maple", "prairie", "cedar", "harbor", "summit", "meadow", "birch", "canyon", "willow", "granite", "lantern", "orchard", "falcon", "juniper"];
  const code = `${words[crypto.randomInt(words.length)]}-${words[crypto.randomInt(words.length)]}-${crypto.randomInt(1000, 9999)}`;
  const m = { id: crypto.randomBytes(5).toString("hex"), name: String(name || "").trim().slice(0, 60) || "Member", research: !!research, dailyCents: dailyCents ?? null, active: true, codeHash: hash(code), createdAt: new Date().toISOString() };
  await redis(["SET", `member:${m.id}`, JSON.stringify(m)], ["SADD", "members", m.id], ["SET", `membercode:${m.codeHash}`, JSON.stringify(m.id)]);
  return { member: m, code };
}
export async function updateMember(id, patch) {
  const m = await getJSON(`member:${id}`);
  if (!m) throw new Error("No such member");
  for (const k of ["name", "research", "dailyCents", "active"]) if (patch[k] !== undefined) m[k] = patch[k];
  await setJSON(`member:${id}`, m);
  return m;
}
export async function memberForCode(code) {
  if (!code) return null;
  const id = await getJSON(`membercode:${hash(code)}`).catch(() => null);
  const m = id && (await getJSON(`member:${id}`));
  return m?.active ? m : null;
}
export const ADMIN_MEMBER = { id: "nolan", name: "Nolan", research: true, dailyCents: null, admin: true };

// ---- Spend tracking (cents, stored as numbers)
const monthKey = () => `askspend:month:${today().slice(0, 7)}`;
const dayKey = (id) => `askspend:day:${today()}:${id}`;
const num = async (k) => Number((await getJSON(k)) || 0);
export async function spendStatus(member) {
  const cfg = await askConfig();
  const [month, day] = await Promise.all([num(monthKey()), num(dayKey(member.id))]);
  const daily = member.admin ? null : member.dailyCents ?? cfg.dailyCents;
  return { monthCents: month, monthlyCents: cfg.monthlyCents, dayCents: day, dailyCents: daily };
}
async function addSpend(member, cents) {
  const [month, day] = await Promise.all([num(monthKey()), num(dayKey(member.id))]);
  await redis(["SET", monthKey(), JSON.stringify(month + cents)], ["SET", dayKey(member.id), JSON.stringify(day + cents)]);
}

// ---- The data Claude can query
async function loadData(research) {
  const [meetings, issues, roster, refs] = await Promise.all([listMeetings(), listIssues(), getRoster(), listRefs()]);
  const items = [], mtgs = new Map();
  for (const m of meetings) {
    normalizeRecord(m.draft); normalizeRecord(m.record);
    const rec = recordOf(m);
    if (m.preview && m.date >= today()) mtgs.set(m.id, { m, rec: null });
    if (!rec || (m.unpublished && !research)) continue;
    mtgs.set(m.id, { m, rec });
    rec.items.forEach((it, idx) => {
      const label = itemLabel(m, it);
      if (label === "hidden" || (label === "held" && !research)) return;
      items.push({ ref: `${m.id}#${idx}`, m, it, idx, label, gov: BODIES[m.body]?.gov });
    });
  }
  return { meetings, mtgs, items, issues, roster, refs, research };
}

const short = (s, n = 220) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const lastName = (n) => String(n || "").toLowerCase().replace(/[.,]/g, " ").replace(/\b(jr|sr|ii|iii|dr|mr|mrs|ms|councilman|councilwoman|councilor|commissioner|president)\b/g, "").trim().split(/\s+/).pop() || "";
const hasName = (list, p) => (list || []).some((n) => lastName(n) && lastName(n) === lastName(p));
const norm = (s) => String(s || "").toLowerCase().replace(/[.,'’]/g, "").replace(/\b(llc|inc|co|corp|company)\b/g, "").replace(/\s+/g, " ").trim();
const words = (q) => String(q || "").toLowerCase().split(/\s+/).filter((w) => w.length > 1);
const textOf = (x) => { const it = x.it; return [it.title, it.officialTitle, it.docNumber, it.whatItIs, it.whyItMatters, it.recipient, it.fundingSource, it.issue?.title, ...(it.parties || []).map((p) => p.name), ...(it.notes || []), ...(it.quotes || []).map((q) => `${q.speaker} ${q.text}`)].join(" ").toLowerCase(); };

function filterItems(d, a = {}) {
  const w = words(a.text);
  return d.items.filter((x) => {
    const it = x.it, v = it.vote || {};
    if (a.gov && x.gov !== a.gov) return false;
    if (a.boards?.length && !a.boards.includes(x.m.body)) return false;
    if (a.categories?.length && !a.categories.includes(it.category)) return false;
    if (a.from && x.m.date < a.from) return false;
    if (a.to && x.m.date > a.to) return false;
    if (a.result && v.result !== a.result) return false;
    if (a.min_amount != null && !(Math.abs(it.amount || 0) >= a.min_amount)) return false;
    if (a.issue && it.issue?.key !== a.issue) return false;
    if (a.person) {
      const p = a.person, named = hasName(v.yes, p) || hasName(v.no, p) || hasName(v.abstain, p) || hasName([it.motionBy, it.secondBy], p) || (it.quotes || []).some((q) => lastName(q.speaker) === lastName(p));
      if (!named) return false;
      if (a.vote && !(a.vote === "no" ? hasName(v.no, p) : a.vote === "yes" ? hasName(v.yes, p) : a.vote === "abstain" ? hasName(v.abstain, p) : a.vote === "moved" ? hasName([it.motionBy], p) : a.vote === "seconded" ? hasName([it.secondBy], p) : true)) return false;
    } else if (a.vote === "no" && !(v.no || []).length) return false;
    if (a.company) { const c = norm(a.company); if (!(it.parties || []).some((p) => norm(p.name).includes(c)) && !norm(it.recipient).includes(c)) return false; }
    if (w.length) { const t = textOf(x); if (!w.every((x) => t.includes(x))) return false; }
    return true;
  });
}
const row = (x, research) => {
  const it = x.it, v = it.vote || {};
  const r = { ref: x.ref, date: x.m.date, board: BODIES[x.m.body]?.short, title: it.title, category: it.category, stage: it.stage, result: v.result, vote: v.method, label: x.label };
  if (v.yes?.length) r.yes = v.yes; if (v.no?.length) r.no = v.no; if (v.abstain?.length) r.abstain = v.abstain;
  if (it.motionBy) r.moved = it.motionBy; if (it.secondBy) r.second = it.secondBy;
  if (it.amount != null) r.amount = it.amount;
  if (it.recipient) r.recipient = it.recipient; if (it.fundingSource) r.from = it.fundingSource;
  if (it.parties?.length) r.parties = it.parties.map((p) => p.name);
  if (it.issue?.key) r.issue = it.issue.key;
  r.about = short(it.whatItIs, 180);
  if (research && it.flags?.length) r.flags = it.flags.length;
  return r;
};

const TOOLS = [
  { name: "search_items", description: "Find agenda items (votes, spending, rezonings, contracts, public comments…) in published meeting records. All filters optional and combined with AND. Returns matching items (newest first) and the total count. Use group_by to get counts and dollar totals instead of rows, for trend questions.",
    input_schema: { type: "object", properties: {
      text: { type: "string", description: "Words that must all appear (title, description, notes, quotes, parties). Keep it to 1-3 distinctive words." },
      gov: { type: "string", enum: ["county", "city"] }, boards: { type: "array", items: { type: "string", enum: TRACKED } },
      categories: { type: "array", items: { type: "string" } }, from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string" },
      result: { type: "string", enum: ["passed", "failed", "tabled", "no vote", "unclear"] }, min_amount: { type: "number" }, issue: { type: "string", description: "issue key" },
      person: { type: "string", description: "Official's name: items where they moved, seconded, were named in a vote, or were quoted." },
      vote: { type: "string", enum: ["yes", "no", "abstain", "moved", "seconded"], description: "With person: only items where they did this. Without person, 'no' = items with any recorded no vote." },
      company: { type: "string", description: "A company, developer or organization (party or recipient)." },
      group_by: { type: "string", enum: ["board", "category", "month", "result", "recipient", "party", "funding", "mover"] },
      limit: { type: "integer", description: "Rows to return, default 40, max 80." },
    } } },
  { name: "get_item", description: "Full detail of one item by ref (meetingId#index): description, vote, quotes with video seconds, notes, next step, and (if allowed) research flags.", input_schema: { type: "object", required: ["ref"], properties: { ref: { type: "string" } } } },
  { name: "get_meeting", description: "One meeting by id: summary, attendance and its list of items.", input_schema: { type: "object", required: ["id"], properties: { id: { type: "string" } } } },
  { name: "attendance", description: "Attendance for board members: meetings, absences and absent dates. Filter by board, person, date range.", input_schema: { type: "object", properties: { board: { type: "string", enum: TRACKED }, person: { type: "string" }, from: { type: "string" }, to: { type: "string" } } } },
  { name: "officials", description: "The roster: every tracked board's members with title and party (party blank if not entered).", input_schema: { type: "object", properties: {} } },
  { name: "quotes", description: "Things said in meetings (from transcripts), with speaker, item ref and video seconds. Filter by speaker and/or words.", input_schema: { type: "object", properties: { speaker: { type: "string" }, text: { type: "string" }, from: { type: "string" }, to: { type: "string" }, limit: { type: "integer" } } } },
  { name: "issues", description: "Ongoing issues followed across meetings. With key: the full timeline. Without: list (optionally filtered by words).", input_schema: { type: "object", properties: { key: { type: "string" }, text: { type: "string" } } } },
  { name: "budgets", description: "Adopted budgets in the library: totals, tax rate, fund and General Fund department amounts, observations. Optional words to filter funds/departments.", input_schema: { type: "object", properties: { id: { type: "string" }, text: { type: "string" } } } },
  { name: "upcoming", description: "Upcoming meetings with posted agendas and their previewed items.", input_schema: { type: "object", properties: {} } },
];
const FLAGS_TOOL = { name: "research_flags", description: "INTERNAL research flags: statements that conflict with documents, changed positions, process shortcuts, repeated delays. Filter by kind or words.", input_schema: { type: "object", properties: { kind: { type: "string", enum: ["statement vs documents", "changed position", "process", "delay", "other"] }, text: { type: "string" }, from: { type: "string" }, to: { type: "string" } } } };

function runTool(d, name, a = {}) {
  const lim = (n, def = 40, max = 80) => Math.min(Math.max(1, n || def), max);
  switch (name) {
    case "search_items": {
      const rows = filterItems(d, a).sort((x, y) => y.m.date.localeCompare(x.m.date) || x.idx - y.idx);
      if (a.group_by) {
        const g = new Map();
        const keyOf = { board: (x) => [BODIES[x.m.body]?.short], category: (x) => [x.it.category], month: (x) => [x.m.date.slice(0, 7)], result: (x) => [x.it.vote?.result || "none"], recipient: (x) => [x.it.recipient || "(none)"], funding: (x) => [x.it.fundingSource || "(not stated)"], mover: (x) => [x.it.motionBy || "(not recorded)"], party: (x) => (x.it.parties?.length ? x.it.parties.map((p) => p.name) : ["(none)"]) }[a.group_by];
        for (const x of rows) for (const k of keyOf(x)) { const e = g.get(k) || { key: k, count: 0, dollars: 0, refs: [] }; e.count++; e.dollars += x.it.amount || 0; if (e.refs.length < 6) e.refs.push(x.ref); g.set(k, e); }
        return { total: rows.length, groups: [...g.values()].sort((p, q) => q.count - p.count || q.dollars - p.dollars).slice(0, 60) };
      }
      return { total: rows.length, shown: Math.min(rows.length, lim(a.limit)), items: rows.slice(0, lim(a.limit)).map((x) => row(x, d.research)) };
    }
    case "get_item": {
      const x = d.items.find((y) => y.ref === a.ref);
      if (!x) return { error: "No such item (or it isn't published)." };
      const it = x.it;
      const out = { ...row(x, false), about: it.whatItIs, officialTitle: it.officialTitle, docNumber: it.docNumber, whyItMatters: it.whyItMatters, voteNote: it.vote?.note, notes: it.notes, quotes: it.quotes, nextStep: it.nextStep, uncertain: x.label === "unclear" ? it.checkNote : undefined, videoId: x.m.videoId || null, videoSeconds: it.videoSeconds ?? null, parties: it.parties };
      if (d.research) { out.flags = it.flags; if (x.label === "held") out.heldBecause = it.hold?.reason || it.checkNote; }
      return out;
    }
    case "get_meeting": {
      const e = d.mtgs.get(a.id);
      if (!e?.rec) return { error: "No published meeting with that id." };
      return { id: a.id, board: BODIES[e.m.body]?.name, date: e.m.date, summary: e.rec.summary, attendance: e.rec.attendance, videoId: e.m.videoId || null, items: d.items.filter((x) => x.m.id === a.id).map((x) => ({ ref: x.ref, title: x.it.title, result: x.it.vote?.result, amount: x.it.amount ?? null, label: x.label })) };
    }
    case "attendance": {
      const out = [];
      for (const body of a.board ? [a.board] : TRACKED) for (const p of d.roster[body] || []) {
        if (a.person && lastName(a.person) !== lastName(p.name)) continue;
        let meetings = 0, absent = [];
        for (const { m, rec } of d.mtgs.values()) {
          if (!rec || m.body !== body || (a.from && m.date < a.from) || (a.to && m.date > a.to)) continue;
          meetings++;
          if (hasName(rec.attendance?.absent, p.name)) absent.push(m.date);
        }
        out.push({ name: p.name, board: BODIES[body].short, party: p.party || "", meetings, absences: absent.length, absentDates: absent.sort() });
      }
      return { members: out };
    }
    case "officials": return { boards: Object.fromEntries(TRACKED.map((b) => [BODIES[b].name, (d.roster[b] || []).map((p) => ({ name: p.name, title: p.title || "", party: p.party || "" }))])) };
    case "quotes": {
      const w = words(a.text), out = [];
      for (const x of d.items) {
        if ((a.from && x.m.date < a.from) || (a.to && x.m.date > a.to)) continue;
        for (const q of x.it.quotes || []) {
          if (a.speaker && !String(q.speaker || "").toLowerCase().includes(lastName(a.speaker))) continue;
          if (w.length && !w.every((y) => `${q.text} ${x.it.title}`.toLowerCase().includes(y))) continue;
          out.push({ ref: x.ref, date: x.m.date, board: BODIES[x.m.body]?.short, speaker: q.speaker, text: q.text, seconds: q.seconds, item: x.it.title });
        }
      }
      out.sort((p, q) => q.date.localeCompare(p.date));
      return { total: out.length, quotes: out.slice(0, lim(a.limit, 30, 60)) };
    }
    case "issues": {
      if (a.key) { const i = d.issues.find((x) => x.key === a.key); return i ? { key: i.key, title: i.title, events: (i.events || []).map((e) => ({ ref: `${e.meetingId}#${e.idx}`, date: e.date, board: BODIES[e.body]?.short, title: e.title, stage: e.stage, result: e.result, amount: e.amount })), nextStep: i.nextStep } : { error: "No such issue" }; }
      const w = words(a.text);
      return { issues: d.issues.filter((i) => i.events?.length && (!w.length || w.every((y) => `${i.title} ${i.key}`.toLowerCase().includes(y)))).map((i) => ({ key: i.key, title: i.title, steps: i.events.length, first: i.firstDate, last: i.lastDate, latestStage: i.latestStage })) };
    }
    case "budgets": {
      const refs = d.refs.filter((r) => !a.id || r.id === a.id);
      const w = words(a.text);
      return { budgets: refs.map((r) => ({ id: r.id, title: r.title, adopted: r.adopted, docNumber: r.docNumber, summary: r.summary, totals: r.totals, tax: r.tax, observations: (r.observations || []).map((o) => o.text || o),
        funds: (r.funds || []).filter((f) => !w.length || w.every((y) => f.name.toLowerCase().includes(y))).map((f) => ({ name: f.name, group: f.group, budget: f.budget, levy: f.levy, cashEnd2027: f.cashEnd2027, page: f.page })),
        generalFundDepartments: (r.generalFundDepartments || []).filter((x) => !w.length || w.every((y) => x.name.toLowerCase().includes(y))) })) };
    }
    case "upcoming": return { meetings: [...d.mtgs.values()].filter(({ m }) => m.preview && m.date >= today()).map(({ m }) => ({ id: m.id, board: BODIES[m.body]?.name, date: m.date, time: m.preview.time, summary: m.preview.summary, items: (m.preview.items || []).map((i) => ({ title: i.title, step: i.step, publicHearing: i.publicHearing, amount: i.amount, parties: (i.parties || []).map((p) => p.name) })) })) };
    case "research_flags": {
      if (!d.research) return { error: "Not available." };
      const w = words(a.text), out = [];
      for (const x of d.items) for (const f of x.it.flags || []) {
        if (a.kind && f.kind !== a.kind) continue;
        if ((a.from && x.m.date < a.from) || (a.to && x.m.date > a.to)) continue;
        if (w.length && !w.every((y) => `${f.text} ${x.it.title}`.toLowerCase().includes(y))) continue;
        out.push({ ref: x.ref, date: x.m.date, board: BODIES[x.m.body]?.short, kind: f.kind, text: f.text, seconds: f.seconds ?? null, item: x.it.title });
      }
      return { total: out.length, flags: out.sort((p, q) => q.date.localeCompare(p.date)).slice(0, 60) };
    }
    default: return { error: "Unknown tool" };
  }
}

const SYSTEM = (research) => `You answer questions from a small group of community organizers in Howard County, Indiana about what their local governments have done: Howard County (County Council, Board of Commissioners, County Plan Commission) and the City of Kokomo (Common Council, Plan Commission, Board of Zoning Appeals, Board of Public Works and Safety). Records start in January 2026. Today is ${today()}.

How to work:
- Use the tools to look things up. Never answer from memory about these governments. Start broad (search_items with a few words or filters, or group_by for trends), then get_item for the details you cite.
- Cite every factual claim with the item or meeting it came from, written exactly as [[ref]] (e.g. [[city-council-2026-09-28#4]] or [[council-2026-09-08]]). Only cite refs that tools returned.
- Each item has a label: "confirmed" (official minutes back it), "video" (from the meeting video; minutes not out or not checked)${research ? `, "held" (sources disagree; unverified, say so if you use it)` : ""}, "unclear". Mention when a key fact is only from video or unclear.
- Most votes on these boards are voice votes. When a vote has no yes list, individual votes were NOT recorded: never infer how someone voted. Recorded no votes and roll calls are the only per-member votes.
- Counts come only from what the records contain. Say so when the answer depends on coverage (e.g. "in the meetings recorded since January").
- Be direct and brief: lead with the answer, then the supporting facts. Use a short markdown table when comparing several things. No filler.
- Private residents are never named.
${research ? "- This user may see INTERNAL research flags (research_flags tool, flags on items). Facts only; label them as research notes. Don't speculate about motives." : "- This user sees published records only."}`;

// ---- Ask
export async function ask(member, question, mode = "quick") {
  question = String(question || "").trim().slice(0, 1500);
  if (question.length < 4) throw new Error("Ask a question.");
  const M = MODES[mode] ? MODES[mode] : MODES.quick;
  const st = await spendStatus(member);
  if (st.monthCents >= st.monthlyCents) throw Object.assign(new Error("The Ask page has reached this month's spending limit. Nolan can raise it in Settings."), { status: 429 });
  if (st.dailyCents != null && st.dayCents >= st.dailyCents) throw Object.assign(new Error("You've reached today's limit. It resets tomorrow."), { status: 429 });

  // Same question recently? Free.
  const ckey = `askcache:${crypto.createHash("sha256").update(`${mode}|${member.research}|${question.toLowerCase().replace(/\s+/g, " ")}`).digest("hex").slice(0, 32)}`;
  const cached = await getJSON(ckey);
  if (cached && Date.now() - Date.parse(cached.at) < 12 * 3600e3) return { ...cached, cached: true, costCents: 0 };

  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY isn't set in Vercel.");
  const d = await loadData(member.research);
  const tools = [...TOOLS, ...(member.research ? [FLAGS_TOOL] : [])];
  tools[tools.length - 1] = { ...tools[tools.length - 1], cache_control: { type: "ephemeral" } };
  const messages = [{ role: "user", content: question }];
  let cents = 0, answer = "", steps = [];
  for (let round = 0; round < M.rounds; round++) {
    const last = round === M.rounds - 1 || cents >= M.ceilingCents * 0.7;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: M.model(), max_tokens: M.maxTokens, system: [{ type: "text", text: SYSTEM(member.research), cache_control: { type: "ephemeral" } }], tools, tool_choice: { type: "auto" }, messages }),
    });
    if (!res.ok) {
      let detail = ""; try { detail = (await res.json()).error?.message || ""; } catch (e) {}
      if (res.status === 429 || res.status === 529) throw new Error("Claude is busy right now. Try again in a minute.");
      throw new Error(`Claude couldn't answer (${res.status}${detail ? ": " + detail.slice(0, 160) : ""}).`);
    }
    const data = await res.json();
    cents += costCents(data.usage || {}, M.price);
    const uses = (data.content || []).filter((b) => b.type === "tool_use");
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (!uses.length || last) { answer = text; break; }
    messages.push({ role: "assistant", content: data.content });
    const results = uses.map((u) => {
      steps.push({ tool: u.name, input: u.input });
      let out; try { out = runTool(d, u.name, u.input); } catch (e) { out = { error: e.message }; }
      return { type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out).slice(0, 60000) };
    });
    // Running out of rounds or budget: tell Claude to answer now with what it has.
    const nextIsLast = round + 1 === M.rounds - 1 || cents >= M.ceilingCents * 0.7;
    if (nextIsLast) results.push({ type: "text", text: "That's the last lookup for this question. Answer now with what you have, and say what you couldn't check." });
    messages.push({ role: "user", content: results });
  }
  if (!answer) answer = "I couldn't finish that one within the limit for a single question. Try narrowing it (a board, a date range, a name), or use Deep.";
  cents = Math.round(cents * 100) / 100;
  await addSpend(member, cents);

  // Refs the answer cites, resolved so the page can link them
  const refs = {};
  for (const [, ref] of answer.matchAll(/\[\[([a-z0-9-]+(?:#\d+)?)\]\]/g)) {
    const [mid, idx] = ref.split("#");
    const e = d.mtgs.get(mid);
    if (!e) continue;
    const x = idx != null ? d.items.find((y) => y.ref === ref) : null;
    refs[ref] = { meetingId: mid, idx: idx != null ? +idx : null, date: e.m.date, board: BODIES[e.m.body]?.short, title: x?.it.title || BODIES[e.m.body]?.name, label: x?.label || "", videoId: e.m.videoId || null, seconds: x?.it.videoSeconds ?? null };
  }
  const entry = { id: crypto.randomBytes(6).toString("hex"), at: new Date().toISOString(), memberId: member.id, memberName: member.name, question, mode, model: M.model(), answer, refs, steps: steps.length, costCents: cents, research: !!member.research };
  await redis(["SET", `ask:${entry.id}`, JSON.stringify(entry)], ["ZADD", "asklog", Date.now(), entry.id]);
  await setJSON(ckey, entry);
  return entry;
}

export async function askLog({ memberId = null, limit = 50 } = {}) {
  const [ids] = await redis(["ZRANGE", "asklog", 0, -1, "REV"]);
  const all = (await getMany(ids.slice(0, 600).map((id) => `ask:${id}`))).filter(Boolean);
  return all.filter((e) => !memberId || e.memberId === memberId).slice(0, limit);
}
export async function pinned(member) {
  const [ids] = await redis(["SMEMBERS", "askpinned"]);
  return (await getMany(ids.map((id) => `ask:${id}`))).filter((e) => e && (member.research || !e.research)).sort((a, b) => b.at.localeCompare(a.at));
}
export async function setPin(id, on) {
  const e = await getJSON(`ask:${id}`);
  if (!e) throw new Error("No such answer");
  e.pinned = !!on; await setJSON(`ask:${id}`, e);
  await redis([on ? "SADD" : "SREM", "askpinned", id]);
  return e;
}

export { runTool, loadData }; // for tests
