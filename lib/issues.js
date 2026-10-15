// Issues that are really one issue. Keys are minted by the drafter, one meeting at a time, so the same project can end up
// under two or three keys ("north-side-interceptor-project" and "northside-interceptor-project"). This finds those pairs,
// asks Claude to confirm them, merges the sure ones and queues the rest for a person. A merged key lives on as an alias, so
// old links and future drafts that reuse it still land on the one page.
import { listIssues, saveIssue, redis, getJSON, setJSON } from "./store.js";
import { BODIES } from "./county.js";
import { askJSON } from "./claude.js";

// ---- Aliases
export const aliasMap = (issues) => { const m = new Map(); for (const i of issues) for (const a of i.aliases || []) m.set(a, i.key); return m; };
export const resolveKey = (key, map) => { let k = key, n = 0; while (map.has(k) && n++ < 5) k = map.get(k); return k; };
export const findIssue = (issues, key) => issues.find((i) => i.key === key) || issues.find((i) => (i.aliases || []).includes(key)) || null;

const pairKey = (a, b) => [a, b].sort().join("|");

// ---- Merge: everything on `other` moves to `into`; `other`'s key becomes an alias of `into`.
export async function mergeIssues(intoKey, otherKey) {
  if (intoKey === otherKey) throw new Error("Those are the same issue.");
  const issues = await listIssues();
  const into = findIssue(issues, intoKey), other = findIssue(issues, otherKey);
  if (!into || !other) throw new Error("No such issue.");
  if (into.key === other.key) throw new Error("Already merged.");
  into.events = into.events || [];
  const seen = new Set(into.events.map((e) => `${e.meetingId}#${e.idx}`));
  for (const e of other.events || []) if (!seen.has(`${e.meetingId}#${e.idx}`)) { into.events.push(e); seen.add(`${e.meetingId}#${e.idx}`); }
  into.aliases = [...new Set([...(into.aliases || []), other.key, ...(other.aliases || [])])].filter((a) => a !== into.key);
  into.related = [...new Set([...(into.related || []), ...(other.related || [])])].filter((k) => k !== into.key && k !== other.key);
  if (!into.kindOverride && other.kindOverride) into.kindOverride = other.kindOverride;
  into.mergedFrom = [...(into.mergedFrom || []), { key: other.key, title: other.title, at: new Date().toISOString() }];
  recount(into);
  await saveIssue(into);
  await redis(["DEL", `issue:${other.key}`], ["SREM", "issues", other.key]);
  // Anything that pointed at the old key now points at the new one
  for (const i of issues) if (i.key !== into.key && (i.related || []).includes(other.key)) { i.related = [...new Set(i.related.map((k) => (k === other.key ? into.key : k)))].filter((k) => k !== i.key); await saveIssue(i); }
  return into;
}

export function recount(i) {
  i.events = (i.events || []).slice().sort((a, b) => a.date.localeCompare(b.date) || a.idx - b.idx);
  const last = i.events[i.events.length - 1];
  i.lastDate = last?.date || null;
  i.firstDate = i.events[0]?.date || null;
  i.latestStage = last?.stage || null;
  i.nextStep = last?.nextStep || null;
  i.bodies = [...new Set(i.events.map((e) => e.body))];
  i.updatedAt = new Date().toISOString();
}

// ---- Related: same project, different matter (the jail's construction contract and its lease bonds). A link, not a merge.
export async function relateIssues(aKey, bKey, on = true) {
  const issues = await listIssues();
  const a = findIssue(issues, aKey), b = findIssue(issues, bKey);
  if (!a || !b || a.key === b.key) throw new Error("No such issue.");
  const set = (i, k) => { i.related = (i.related || []).filter((x) => x !== k); if (on) i.related.push(k); };
  set(a, b.key); set(b, a.key);
  await saveIssue(a); await saveIssue(b);
  return { a: a.key, b: b.key };
}

// ---- Finding candidates
const STOP = new Set("the of and for a an at in on to by with from new city county kokomo howard indiana project projects program approved approval update updates request requests inc llc co".split(" "));
// Numbers that name a thing: a year, an ordinance or resolution number. Two issues that each carry one, and don't share any, are two things.
const numbering = (i) => new Set((`${i.title} ${i.key}`.match(/\b(?:19|20)\d{2}\b|\b\d{4,5}\b|hcco-?\d+|res(?:olution)?\.? ?\d+|ord(?:inance)?\.? ?\d+/gi) || []).map((x) => x.toLowerCase().replace(/[^a-z0-9]/g, "")));
const SYN = [[/\bnorth ?side\b/g, "northside"], [/\bsouth ?side\b/g, "southside"], [/\beast ?side\b/g, "eastside"], [/\bwest ?side\b/g, "westside"], [/\b(re)?construction|reconstruction|rebuild(ing)?|renovation|remodel(ing)?|improvements?\b/g, "build"], [/\bst\b/g, "street"], [/\bave\b/g, "avenue"], [/\brd\b/g, "road"], [/\bhwy\b/g, "highway"], [/\bapts?\b|\bapartments?\b/g, "apartments"], [/\bconf(erence)? (center|centre)\b/g, "conferencecenter"], [/\bconvention center\b/g, "conferencecenter"], [/\bphase (\d|one|two|three|i+)\b/g, "phase$1"], [/\bjail\b|\bdetention (center|facility)\b/g, "jail"], [/\bsewer\b|\bsanitary\b|\binterceptor\b/g, "sewer"], [/\bwater main\b|\bwater line\b/g, "watermain"], [/\bmoratorium\b|\bpause\b/g, "moratorium"], [/\bdemo\b/g, "demolition"], [/\bmou\b/g, "agreement"], [/\bres\b/g, "resolution"], [/\bord\b/g, "ordinance"]];
export function tokens(s) {
  let t = String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ");
  for (const [re, to] of SYN) t = t.replace(re, to);
  return new Set(t.split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)));
}
// Words that describe a kind of matter rather than which one: two issues that share only these are not a pair.
const GENERIC = new Set("street road avenue drive lane build demolition emergency rezoning rezone zoning ordinance resolution additional appropriations appropriation transfers transfer property unsafe hearing financing bond bonds budget salary ordinance amendment amendments contract agreement grant match matching study extension phase phase1 phase2 phase3 sewer watermain water main lot parking variance variances plan development plat subdivision".split(" "));
const sharedTokens = (a, b) => [...a].filter((x) => b.has(x));
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n); };
const docNums = (i) => new Set((i.events || []).map((e) => String(e.docNumber || "").trim().toUpperCase()).filter((d) => d.length >= 4 && /\d/.test(d)));
const addresses = (i) => new Set(`${i.title} ${(i.events || []).map((e) => e.title).join(" ")}`.toLowerCase().match(/\b\d{3,5} [a-z]+\.? ?(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|boulevard|blvd|highway|hwy|court|ct|way|pike)\b/g) || []);
const gov = (i) => BODIES[(i.bodies || [])[0]]?.gov || "";

export function findCandidates(issues, dismissed = new Set()) {
  const live = issues.filter((i) => i.events?.length);
  const T = new Map(live.map((i) => [i.key, tokens(`${i.title} ${i.key.replace(/-/g, " ")}`)]));
  const D = new Map(live.map((i) => [i.key, docNums(i)]));
  const A = new Map(live.map((i) => [i.key, addresses(i)]));
  const out = [];
  for (let x = 0; x < live.length; x++) for (let y = x + 1; y < live.length; y++) {
    const a = live[x], b = live[y];
    if (dismissed.has(pairKey(a.key, b.key))) continue;
    const reasons = []; let score = 0;
    const j = jaccard(T.get(a.key), T.get(b.key));
    const specific = sharedTokens(T.get(a.key), T.get(b.key)).some((w) => !GENERIC.has(w));
    if (j >= 0.5 && specific) { reasons.push(`titles overlap (${Math.round(j * 100)}%)`); score = Math.max(score, j); }
    const shared = [...D.get(a.key)].filter((d) => D.get(b.key).has(d));
    if (shared.length) { reasons.push(`same document number: ${shared.slice(0, 3).join(", ")}`); score = Math.max(score, 0.95); }
    const addr = [...A.get(a.key)].filter((d) => A.get(b.key).has(d));
    if (addr.length) { reasons.push(`same address: ${addr[0]}`); score = Math.max(score, 0.8); }
    if (!reasons.length || score < 0.5) continue;
    if (gov(a) && gov(b) && gov(a) !== gov(b) && !shared.length) continue; // a city and a county matter with similar words are usually two things
    const na = numbering(a), nb = numbering(b);
    if (na.size && nb.size && ![...na].some((n) => nb.has(n)) && !shared.length) continue; // 2026 budget vs 2027 budget; Ordinance 7228 vs 7178
    out.push({ a: a.key, b: b.key, score: Math.round(score * 100) / 100, reasons, status: "pending" });
  }
  return out.sort((p, q) => q.score - p.score);
}

// ---- Confirming with Claude, in batches small enough for one request
const brief = (i) => {
  const evs = (i.events || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const pickEv = [...evs.slice(0, 3), ...evs.slice(-3)].filter((e, k, arr) => arr.indexOf(e) === k);
  return { key: i.key, title: i.title, boards: (i.bodies || []).map((b) => BODIES[b]?.name || b), from: i.firstDate, to: i.lastDate, items: evs.length, examples: pickEv.map((e) => `${e.date}: ${e.title}${e.docNumber ? ` [${e.docNumber}]` : ""}`) };
};
const VERDICT_SCHEMA = { type: "object", required: ["pairs"], properties: { pairs: { type: "array", items: { type: "object", required: ["a", "b", "verdict", "confidence", "reason"], properties: { a: { type: "string" }, b: { type: "string" }, verdict: { type: "string", enum: ["same", "related", "different"] }, confidence: { type: "string", enum: ["high", "medium", "low"] }, reason: { type: "string" }, keep: { type: "string", description: "For 'same': which key should be the page's address, the one whose title best names the whole matter." }, title: { type: "string", description: "For 'same': the best plain title for the merged page, or empty to keep the kept issue's title." } } } } } };

export async function confirmPairs(pairs, issues) {
  const byKey = new Map(issues.map((i) => [i.key, i]));
  const text = pairs.map((p, n) => `PAIR ${n + 1}\nA: ${JSON.stringify(brief(byKey.get(p.a)))}\nB: ${JSON.stringify(brief(byKey.get(p.b)))}\nWhy flagged: ${p.reasons.join("; ")}`).join("\n\n");
  const system = `You maintain the issue pages of a local-government tracker for Kokomo and Howard County, Indiana. Each "issue" is one matter followed across meetings: a project, an ordinance, a property, a contract. Two issue keys sometimes get made for one matter. For each pair below, decide:
- "same": one matter under two keys (the same construction project and its bills; the same ordinance through its readings; the same property's rezoning). Merge them.
- "related": the same project but a different decision that deserves its own page (a jail's construction contract vs. the bonds that pay for it vs. a heat-pump purchase for it; a building's rezoning vs. its later site plan). Link, don't merge.
- "different": separate matters that happen to share words (two different sewer extensions; a street rebuild and an unrelated sidewalk on the same street).
Be strict about "same": the payments, invoices and change orders for one construction project ARE the same matter as that project. A different phase or a different street segment is "related" at most. Confidence is "high" only when the titles and items leave no doubt.`;
  const out = await askJSON(system, `${text}\n\nReturn every pair.`, { name: "judge_pairs", description: "Your verdict on every pair.", input_schema: VERDICT_SCHEMA });
  const verdicts = new Map((out.pairs || []).map((v) => [pairKey(v.a, v.b), v]));
  return pairs.map((p) => { const v = verdicts.get(pairKey(p.a, p.b)); return v ? { ...p, verdict: v.verdict, confidence: v.confidence, reason: v.reason, keep: v.keep && (v.keep === p.a || v.keep === p.b) ? v.keep : "", title: v.title || "" } : { ...p, verdict: "unsure", confidence: "low", reason: "Claude gave no verdict." }; });
}

// One scan step: find candidates (first call), confirm a batch, apply the sure ones. Returns what's left for a person.
// Called repeatedly by the review screen until `pending` is 0: each call stays well inside one request.
export async function dupeScan({ restart = false, batch = 20 } = {}) {
  const issues = await listIssues();
  const dismissed = new Set(((await getJSON("dupes:dismissed")) || []).map((p) => pairKey(p.a, p.b)));
  let queue = restart ? null : await getJSON("dupes:queue");
  if (!queue) { queue = findCandidates(issues, dismissed); await setJSON("dupes:queue", queue); await setJSON("dupes:scan", { at: new Date().toISOString(), issues: issues.length, candidates: queue.length }); }
  const have = new Set(issues.map((i) => i.key));
  for (const p of queue) if (p.status === "pending" && !(have.has(p.a) && have.has(p.b))) p.status = "dropped";
  const todo = queue.filter((p) => p.status === "pending").slice(0, batch);
  const applied = [];
  if (todo.length) {
    let judged = [];
    try { judged = await confirmPairs(todo, issues); } catch (e) { return { error: e.message, queue: summary(queue, issues) }; }
    for (const v of judged) { const q = queue.find((p) => p.a === v.a && p.b === v.b); if (q) Object.assign(q, v, { status: "judged", judgedAt: new Date().toISOString() }); }
    await setJSON("dupes:queue", queue);
    // Apply what's sure. A merge removes a key, so anything else that named it is dropped afterward.
    for (const v of judged) {
      const q = queue.find((p) => p.a === v.a && p.b === v.b); if (!q || q.status !== "judged") continue;
      try {
        if (q.verdict === "same" && q.confidence === "high") {
          const keep = q.keep || (await betterKey(q.a, q.b));
          const other = keep === q.a ? q.b : q.a;
          const into = await mergeIssues(keep, other);
          if (q.title && q.title.length > 6) { into.title = q.title; await saveIssue(into); }
          q.status = "merged"; q.into = into.key; applied.push({ kind: "merged", into: into.key, from: other, title: into.title });
          for (const p of queue) if (p !== q && p.status === "pending" && (p.a === other || p.b === other)) p.status = "dropped";
        } else if (q.verdict === "related" && q.confidence === "high") {
          await relateIssues(q.a, q.b, true); q.status = "related"; applied.push({ kind: "related", a: q.a, b: q.b });
        } else if (q.verdict === "different" && q.confidence === "high") {
          q.status = "dismissed"; await rememberDismissed(q.a, q.b, "Claude: " + q.reason);
        }
      } catch (e) { q.error = e.message; }
    }
    await setJSON("dupes:queue", queue);
  }
  return { applied, queue: summary(queue, await listIssues()) };
}

async function betterKey(a, b) {
  const issues = await listIssues();
  const A = findIssue(issues, a), B = findIssue(issues, b);
  // The one with more on its page, then the shorter, plainer key
  if ((A?.events?.length || 0) !== (B?.events?.length || 0)) return (A?.events?.length || 0) > (B?.events?.length || 0) ? a : b;
  return a.length <= b.length ? a : b;
}

async function rememberDismissed(a, b, why = "") {
  const d = (await getJSON("dupes:dismissed")) || [];
  if (!d.some((p) => pairKey(p.a, p.b) === pairKey(a, b))) { d.push({ a, b, why, at: new Date().toISOString() }); await setJSON("dupes:dismissed", d); }
}
export async function dismiss(a, b, why = "") {
  await rememberDismissed(a, b, why);
  const q = (await getJSON("dupes:queue")) || [];
  for (const p of q) if (pairKey(p.a, p.b) === pairKey(a, b)) p.status = "dismissed";
  await setJSON("dupes:queue", q);
}

export async function settlePair(a, b, status, into = "") {
  const q = (await getJSON("dupes:queue")) || [];
  for (const p of q) if (pairKey(p.a, p.b) === pairKey(a, b)) { p.status = status; if (into) p.into = into; }
  await setJSON("dupes:queue", q);
}
export async function dupeQueue() { return summary((await getJSON("dupes:queue")) || [], await listIssues()); }

function summary(queue, issues) {
  const byKey = new Map(issues.map((i) => [i.key, i]));
  const live = queue.filter((p) => byKey.has(p.a) && byKey.has(p.b));
  const t = (k) => ({ key: k, title: byKey.get(k)?.title || k, items: byKey.get(k)?.events?.length || 0, from: byKey.get(k)?.firstDate, to: byKey.get(k)?.lastDate });
  return {
    pending: live.filter((p) => p.status === "pending").length,
    review: live.filter((p) => p.status === "judged").map((p) => ({ ...p, A: t(p.a), B: t(p.b) })),
    done: queue.filter((p) => ["merged", "related", "dismissed"].includes(p.status)).length,
    recent: queue.filter((p) => ["merged", "related"].includes(p.status)).slice(-30).reverse(),
  };
}
