// Second Reading as an MCP server: the public record of Kokomo and Howard County meetings, votes, issues and budgets,
// as tools any MCP client (Claude, ChatGPT, Cursor, …) can call. Read-only, public, no login: it serves exactly what
// the public site serves, nothing from the admin side.
//
// Transport: MCP "streamable HTTP" in its simplest, stateless form. The client POSTs a JSON-RPC message, we answer with
// a JSON body (the spec allows plain JSON instead of an SSE stream). No sessions, no SDK, nothing to keep alive on
// Vercel. Connect it at https://www.secondreading.org/api/mcp
import { json } from "../lib/http.js";
import { runTool, loadData, TOOLS } from "../lib/ask.js";
import { ROADMAPS } from "../lib/roadmaps.js";
import { redis } from "../lib/store.js";
import * as P from "../lib/public.js";
import fs from "node:fs"; import path from "node:path";
export const config = { maxDuration: 30 };

const SITE = "https://www.secondreading.org";
const PROTOCOL = "2025-03-26";
const SERVER = { name: "second-reading", version: "1.0.0" };
const INSTRUCTIONS = `Second Reading follows every public meeting of Howard County and the City of Kokomo, Indiana: agendas before, votes after, where each decision goes next, plus the budgets both governments file with the state. Everything comes from the official record (packets, minutes, video) and is written in plain language. Kokomo (the city) and Howard County are separate governments; don't mix their boards or funds. Give the secondreading.org link that comes back with each result so people can read the source. Say when the record doesn't answer a question rather than guessing.`;

// ---- Tools: the Ask page's record tools, plus budgets from the state forms and "how a decision works"
const GATEWAY = {};
const gw = (name) => { if (GATEWAY[name]) return GATEWAY[name]; const p = path.join(process.cwd(), "public", "gateway", `${name}.json`); return (GATEWAY[name] = JSON.parse(fs.readFileSync(p, "utf8"))); };
const unitOf = (gov) => (gov === "county" ? "howard" : "kokomo");
const $ = (n) => (n == null ? null : Math.round(n));
const RECORD_TOOLS = TOOLS.filter((t) => t.name !== "budgets"); // the library "budgets" tool is superseded by the state-form tools below
const EXTRA = [
  { name: "budget_overview", description: "A government's budget by year from the forms it files with the state (2012 onward): adopted total, the day-to-day 'core' total (funds budgeted every year, for like-for-like trends), TIF total, tax rate, levy, categories, and actual spending on operations vs money passed through. Use for 'how much does the city/county spend', trends, tax rate.",
    input_schema: { type: "object", required: ["gov"], properties: { gov: { type: "string", enum: ["city", "county"] }, year: { type: "integer", description: "One year; omit for every year 2018 onward." } } } },
  { name: "budget_funds", description: "Every fund a government budgets in a year: name, state code, adopted amount, tax rate share, levy, and what it actually spent that year when the financial report is in. Optional words to filter fund names (e.g. 'TIF', 'park', 'jail').",
    input_schema: { type: "object", required: ["gov"], properties: { gov: { type: "string", enum: ["city", "county"] }, year: { type: "integer" }, text: { type: "string" } } } },
  { name: "budget_fund", description: "One fund in depth by state code (from budget_funds): history by year (adopted, actually spent), departments, kinds of spending, and the biggest line items for recent years.",
    input_schema: { type: "object", required: ["gov", "code"], properties: { gov: { type: "string", enum: ["city", "county"] }, code: { type: "string", description: "State fund code, e.g. 0101 for General" } } } },
  { name: "budget_departments", description: "Every department a government budgets by line (police, fire, sheriff, parks…) across all funds, with budget and actual spending. Optional words to filter.",
    input_schema: { type: "object", required: ["gov"], properties: { gov: { type: "string", enum: ["city", "county"] }, text: { type: "string" } } } },
  { name: "budget_department", description: "One department in depth: budget vs actual by year since 2016, which funds pay for it, kinds of spending, and its line items (salaries, overtime, equipment…) for recent years with the same line in earlier years.",
    input_schema: { type: "object", required: ["gov", "key"], properties: { gov: { type: "string", enum: ["city", "county"] }, key: { type: "string", description: "Department key from budget_departments, e.g. 'fire department'" } } } },
  { name: "debt", description: "What a government owes: every bond and loan on its books at year end, with outstanding principal and next year's payment, from its annual financial report.",
    input_schema: { type: "object", required: ["gov"], properties: { gov: { type: "string", enum: ["city", "county"] }, year: { type: "integer" } } } },
  { name: "how_it_works", description: "How a kind of local decision is made in Kokomo or Howard County (a rezoning, an additional appropriation, a tax abatement, a bond, hiring a contractor…): the steps, which board takes each, where the public can speak, who has the final say, and the Indiana law behind it. List all kinds with no arguments.",
    input_schema: { type: "object", properties: { kind: { type: "string", description: "Kind key from the list, e.g. 'city-rezoning'" } } } },
  { name: "projects_and_issues", description: "Issues followed across meetings (one matter, every step) and projects (one page above several issues, e.g. the new jail). With key: the full page as the site shows it, including timeline and what's next. Without: the list, optionally filtered by words or status.",
    input_schema: { type: "object", properties: { key: { type: "string" }, text: { type: "string" }, status: { type: "string", enum: ["coming", "progress", "decided", "stalled", "failed"] } } } },
];
const ALL_TOOLS = [...RECORD_TOOLS, ...EXTRA];

async function callTool(name, a = {}) {
  const gov = a.gov === "county" ? "county" : "city"; const u = unitOf(gov); const link = (p) => `${SITE}/#/${p}`;
  switch (name) {
    case "budget_overview": {
      const d = gw(`site-${u}`); const years = d.years.filter((y) => (a.year ? y.year === a.year : y.year >= 2018));
      return { government: d.label, source: d.source, link: link(`budget/${gov}`), note: "'core' counts only funds budgeted every year since 2020; the full total includes funds added to or dropped from the forms (e.g. Kokomo began including TIF districts in 2025).",
        years: years.map((y) => ({ year: y.year, adopted_total: $(y.total), core_total: $(y.coreTotal), tif_total: $(y.tifTotal), tax_rate_per_100: y.rate, levy: $(y.levy), fund_count: y.fundCount, categories: Object.fromEntries(Object.entries(y.categories || {}).map(([k, v]) => [k, $(v)])), funds_added: y.fundChanges?.added || [], funds_dropped: y.fundChanges?.dropped || [], actual: y.actual ? { spent_on_operations: $(y.actual.operations), passed_through: $(y.actual.passThrough), receipts: $(y.actual.receipts), receipts_by_class: Object.fromEntries(Object.entries(y.actual.byReceiptClass || {}).map(([k, v]) => [k, $(v)])), debt_outstanding: $(y.actual.debtOutstanding) } : null })) };
    }
    case "budget_funds": {
      const d = gw(`site-${u}`); const y = (a.year && d.years.find((x) => x.year === a.year)) || d.years.at(-1); const w = String(a.text || "").toLowerCase().split(/\s+/).filter(Boolean);
      const funds = y.funds.filter((f) => f.adopted > 0 && (!w.length || w.every((x) => f.name.toLowerCase().includes(x))));
      return { government: d.label, year: y.year, total: funds.length, link: link(`budget/${gov}${y.year === d.years.at(-1).year ? "" : `?y=${y.year}`}`), funds: funds.map((f) => ({ code: f.code, name: f.name, adopted: $(f.adopted), tax_rate_share: f.rate || 0, levy: $(f.levy), tif: !!f.tif, spent_this_year: $(f.spent), link: link(`budget/${gov}/fund/${f.code}`) })) };
    }
    case "budget_fund": {
      const f = gw(`funds-${u}`)[String(a.code || "").trim()]; if (!f) return { error: `No fund with code ${a.code}. Use budget_funds to find codes.` };
      return { name: f.name, code: f.code, tif: !!f.tif, link: link(`budget/${gov}/fund/${f.code}`), history: f.history.map((h) => ({ year: h.year, adopted: $(h.adopted), published: $(h.published), tax_rate_share: h.rate, categories: Object.fromEntries(Object.entries(h.categories || {}).map(([k, v]) => [k, $(v)])), departments: (h.departments || []).slice(0, 15).map((d) => ({ name: d.name, total: $(d.total) })), actual: h.actual ? { spent: $(h.actual.disbursements), received: $(h.actual.receipts), cash_at_year_end: $(h.actual.endCash), by_class: Object.fromEntries(Object.entries(h.actual.byClass || {}).map(([k, v]) => [k, $(v)])) } : null })), biggest_lines: f.lines.map((L) => ({ year: L.year, lines: L.lines.slice().sort((p, q) => q.adopted - p.adopted).slice(0, 25).map((l) => ({ department: l.department, item: l.item, category: l.category, published: $(l.published), adopted: $(l.adopted) })) })) };
    }
    case "budget_departments": {
      const d = gw(`depts-${u}`); const w = String(a.text || "").toLowerCase().split(/\s+/).filter(Boolean);
      return { link: link(`budget/${gov}/departments`), note: gov === "county" ? "The county books insurance and retirement under 'no department'; a department's number is its direct costs." : "Police and fire pensions are separate funds. Actual spending by department is reported for the general fund only.", departments: d.index.filter((i) => !w.length || w.every((x) => i.name.toLowerCase().includes(x))).map((i) => ({ key: i.key, name: i.name, year: i.year, adopted: $(i.adopted), funds: i.funds, actual_year: i.actualYear, actual: $(i.actual), link: link(`budget/${gov}/dept/${encodeURIComponent(i.key)}`) })) };
    }
    case "budget_department": {
      const dep = gw(`depts-${u}`).depts[String(a.key || "").toLowerCase().trim()]; if (!dep) return { error: `No department '${a.key}'. Use budget_departments to find keys.` };
      return { name: dep.name, link: link(`budget/${gov}/dept/${encodeURIComponent(dep.key)}`), years: dep.years.filter((y) => y.year >= 2016).map((y) => ({ year: y.year, adopted: $(y.adopted), actual: $(y.actual), by_fund: y.byFund.map((f) => ({ fund: f.name, code: f.code, amount: $(f.amount) })), categories: Object.fromEntries(Object.entries(y.categories || {}).map(([k, v]) => [k, $(v)])), lines: y.lines.slice(0, 30).map((l) => ({ item: l.item, category: l.category, fund: l.fundName, adopted: $(l.adopted), published: $(l.published) })) })) };
    }
    case "debt": {
      const d = gw(`site-${u}`); const y = (a.year && d.debt.find((x) => x.year === a.year)) || d.debt.at(-1); if (!y) return { error: "No debt report on file." };
      return { government: d.label, year: y.year, outstanding_total: $(y.outstanding), link: link(`budget/${gov}/debt`), note: gov === "county" ? "The county jail is financed through a building corporation lease rather than county bonds, so it isn't county debt here." : "", by_year: d.debt.filter((x) => x.year >= 2016).map((x) => ({ year: x.year, outstanding: $(x.outstanding), count: x.items.length })), items: y.items.slice().sort((p, q) => q.outstanding - p.outstanding).map((x) => ({ description: x.description, kind: x.cls, enterprise: x.enterprise, outstanding: $(x.outstanding), due_next_year: $(x.dueNextYear) })) };
    }
    case "how_it_works": {
      if (!a.kind) return { kinds: Object.entries(ROADMAPS).map(([k, r]) => ({ kind: k, label: r.label, government: r.gov || "both" })) };
      const r = ROADMAPS[a.kind]; if (!r) return { error: `Unknown kind '${a.kind}'. Call with no arguments for the list.` };
      const flat = (v) => typeof v === "string" || !v ? v || "" : r.gov ? v[r.gov] || "" : `County: ${v.county} City: ${v.city}`;
      return { kind: a.kind, label: r.label, government: r.gov || "both (wording differs; say which you mean)", intro: flat(r.intro), steps: r.steps.map((s) => ({ step: flat(s.title), board: Array.isArray(s.body) ? s.body.join(" or ") : s.body, what: flat(s.what), public_can_speak: s.speak, final_say: !!s.final })), after: flat(r.after), why: flat(r.why), detour: flat(r.detour), law: r.law, link: link("about") };
    }
    case "projects_and_issues": {
      if (a.key) { const i = await P.issue(a.key); if (!i) return { error: `No issue or project '${a.key}'.` }; return { ...i, link: link(`i/${i.canonical || i.key}`) }; }
      const L = await P.issuesList(); const w = String(a.text || "").toLowerCase().split(/\s+/).filter(Boolean);
      const rows = L.issues.filter((i) => (!w.length || w.every((x) => `${i.title} ${i.q || ""}`.toLowerCase().includes(x))) && (!a.status || i.status === a.status));
      return { total: rows.length, issues: rows.slice(0, 60).map((i) => ({ key: i.key, title: i.title, project: !!i.isProject, parts: i.partCount || undefined, status: i.status, boards: i.bodies, first: i.firstDate, last: i.lastDate, steps: i.count, link: link(`i/${i.key}`) })) };
    }
    default: {
      if (!RECORD_TOOLS.some((t) => t.name === name)) throw Object.assign(new Error(`Unknown tool ${name}`), { code: -32602 });
      const d = await loadData(false);
      const out = runTool(d, name, a);
      return addLinks(out);
    }
  }
}
// Every record result carries its page on the site
function addLinks(out) {
  const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") { if (typeof v.ref === "string" && /^[\w-]+#\d+$/.test(v.ref) && !v.link) { const [id, idx] = v.ref.split("#"); v.link = `${SITE}/#/m/${id}#item-${idx}`; } else if (typeof v.id === "string" && /^[a-z-]+-\d{4}-\d{2}-\d{2}$/.test(v.id) && !v.link) v.link = `${SITE}/#/m/${v.id}`; else if (typeof v.key === "string" && v.title && !v.link) v.link = `${SITE}/#/i/${v.key}`; for (const x of Object.values(v)) walk(x); } };
  walk(out); return out;
}

// ---- Rate limit: 60 calls a minute per address, counted in Redis (one INCR per call)
async function limited(request) {
  try {
    const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "anon";
    const key = `mcp:rl:${ip}:${Math.floor(Date.now() / 60000)}`;
    const [n] = await redis(["INCR", key], ["EXPIRE", key, "90"]);
    return n > 60;
  } catch (e) { return false; }
}

// ---- JSON-RPC over HTTP
const rpc = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcErr = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
async function handle(msg) {
  const { id, method, params = {} } = msg || {};
  if (!method) return rpcErr(id ?? null, -32600, "Invalid request");
  switch (method) {
    case "initialize": return rpc(id, { protocolVersion: PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER, instructions: INSTRUCTIONS });
    case "ping": return rpc(id, {});
    case "tools/list": return rpc(id, { tools: ALL_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })) });
    case "tools/call": {
      try { const out = await callTool(params.name, params.arguments || {}); return rpc(id, { content: [{ type: "text", text: JSON.stringify(out) }], isError: !!out?.error }); }
      catch (e) { if (e.code === -32602) return rpcErr(id, -32602, e.message); return rpc(id, { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true }); }
    }
    case "resources/list": return rpc(id, { resources: [] });
    case "prompts/list": return rpc(id, { prompts: [] });
    default: return id === undefined ? null : rpcErr(id, -32601, `Method not found: ${method}`); // notifications get no reply
  }
}

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, mcp-session-id, mcp-protocol-version, authorization", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-expose-headers": "mcp-protocol-version" };
export async function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }
export async function GET() { // no server-initiated stream in this stateless server; say what this is for people who open it in a browser
  return new Response(JSON.stringify({ name: SERVER.name, what: "Second Reading MCP server: the public record of Kokomo and Howard County meetings, votes, issues and budgets.", connect: `${SITE}/api/mcp`, tools: ALL_TOOLS.map((t) => t.name), site: SITE }), { status: 405, headers: { "content-type": "application/json", allow: "POST, OPTIONS", ...CORS } });
}
export async function POST(request) {
  if (await limited(request)) return new Response(JSON.stringify(rpcErr(null, -32000, "Too many requests; try again in a minute.")), { status: 429, headers: { "content-type": "application/json", ...CORS } });
  let body; try { body = await request.json(); } catch (e) { return new Response(JSON.stringify(rpcErr(null, -32700, "Parse error")), { status: 400, headers: { "content-type": "application/json", ...CORS } }); }
  const msgs = Array.isArray(body) ? body : [body];
  const replies = (await Promise.all(msgs.map(handle))).filter(Boolean);
  if (!replies.length) return new Response(null, { status: 202, headers: CORS });
  return new Response(JSON.stringify(Array.isArray(body) ? replies : replies[0]), { status: 200, headers: { "content-type": "application/json", "mcp-protocol-version": PROTOCOL, ...CORS } });
}
