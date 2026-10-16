// Projects: one page above several issues. A jail is land, a tax, bonds, a construction contract and a site plan; each is a
// real matter with its own road, but a resident wants one page. A project is stored like an issue (issue:<key>) with
// isProject and a list of parts; each part carries projectKey. The project has no events of its own: its timeline is the
// union of its parts, computed when read. Grouping is suggested by word clusters and "related" links, confirmed by Claude,
// applied when sure, and otherwise queued for a person, the same way duplicate merges work.
import { listIssues, saveIssue, redis, getJSON, setJSON } from "./store.js";
import { BODIES } from "./county.js";
import { askJSON } from "./claude.js";
import { findIssue, tokens, recount } from "./issues.js";

export const isProject = (i) => !!i?.isProject;
export const partsOf = (project, issues) => (project.parts || []).map((k) => findIssue(issues, k)).filter((x) => x && !isProject(x) && x.events?.length);
export const projectOf = (issue, issues) => issue?.projectKey ? issues.find((p) => p.key === issue.projectKey && isProject(p)) || null : null;

// A project seen as one issue: every part's events, in order
export function flatten(project, issues) {
  const parts = partsOf(project, issues);
  const seen = new Set(); const events = [];
  for (const p of parts) for (const e of p.events || []) { const id = `${e.meetingId}#${e.idx}`; if (!seen.has(id)) { seen.add(id); events.push({ ...e, partKey: p.key, partTitle: p.title }); } }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.idx - b.idx);
  return { ...project, kindOverride: "none", events, bodies: [...new Set(events.map((e) => e.body))], firstDate: events[0]?.date || null, lastDate: events[events.length - 1]?.date || null, latestStage: events[events.length - 1]?.stage || null, nextStep: null, parts };
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

export async function createProject({ title, parts = [], key = "" }) {
  title = String(title || "").trim();
  if (!title) throw new Error("Give the project a name.");
  const issues = await listIssues();
  key = slug(key || title) || "project";
  if (issues.some((i) => i.key === key || (i.aliases || []).includes(key))) key = `${key}-project`;
  if (issues.some((i) => i.key === key)) throw new Error("That key is taken.");
  const project = { key, title, isProject: true, parts: [], events: [], kindOverride: "none", createdAt: new Date().toISOString() };
  await saveIssue(project);
  return addParts(key, parts);
}

export async function addParts(projectKey, keys) {
  const issues = await listIssues();
  const project = issues.find((i) => i.key === projectKey && isProject(i));
  if (!project) throw new Error("No such project.");
  for (const k of keys || []) {
    const part = findIssue(issues, k);
    if (!part || isProject(part) || part.key === project.key) continue;
    if (part.projectKey && part.projectKey !== project.key) { // move it out of the other project
      const other = issues.find((i) => i.key === part.projectKey && isProject(i));
      if (other) { other.parts = (other.parts || []).filter((x) => x !== part.key); await saveIssue(other); }
    }
    part.projectKey = project.key; await saveIssue(part);
    if (!project.parts.includes(part.key)) project.parts.push(part.key);
  }
  project.updatedAt = new Date().toISOString();
  await saveIssue(project);
  return project;
}

export async function removePart(key) {
  const issues = await listIssues();
  const part = findIssue(issues, key);
  if (!part?.projectKey) return { ok: true };
  const project = issues.find((i) => i.key === part.projectKey && isProject(i));
  delete part.projectKey; await saveIssue(part);
  if (project) { project.parts = (project.parts || []).filter((x) => x !== part.key); await saveIssue(project); }
  return { ok: true };
}

export async function deleteProject(key) {
  const issues = await listIssues();
  const project = issues.find((i) => i.key === key && isProject(i));
  if (!project) throw new Error("No such project.");
  for (const k of project.parts || []) { const p = findIssue(issues, k); if (p && p.projectKey === key) { delete p.projectKey; await saveIssue(p); } }
  await redis(["DEL", `issue:${key}`], ["SREM", "issues", key]);
  return { ok: true };
}

export async function renameProject(key, title) {
  const issues = await listIssues();
  const project = issues.find((i) => i.key === key && isProject(i));
  if (!project) throw new Error("No such project.");
  project.title = String(title || "").trim() || project.title; await saveIssue(project);
  return project;
}

// ---- Suggesting groups
// Words that pick out one project rather than a kind of matter. Two or more issues sharing one are a candidate cluster.
const KIND_WORDS = new Set("street road avenue drive lane build demolition emergency rezoning rezone zoning ordinance resolution additional appropriations appropriation transfers transfer property unsafe hearing financing bond bonds budget salary amendment amendments contract contracts agreement agreements bid bids grant grants fund funds funding tax taxes rate rates plan plans plat variance variances permit permits lease loan loans payment payments study review approval services service department office board council commission commissioners county city kokomo howard public safety center development building subdivision garage abatement abatements storage bcco hcco apartments apartment community sewer industrial north south east west street streets line extension replacement reconstruction repair program annual year".split(" "));
const subjectTokens = (i) => [...tokens(`${i.title} ${i.key.replace(/-/g, " ")}`)].filter((w) => !KIND_WORDS.has(w) && !/^\d+$/.test(w));

// Two issues are candidates for one project when they share something specific: a rare subject word (one that names
// this thing, not a street or a kind of matter), two or more subject words, the same address, or a "related" link.
// Clusters are the connected groups of those pairs, capped in size so one common word can't chain the whole county together.
const ADDR = /\b\d{2,5} [nsew]\.? ?\d{2,4}\b|\b\d{3,5} [a-z]+\.? ?(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|boulevard|blvd|court|ct|way|pike)\b/g;
const STREET_WORDS = /\b(street|st|avenue|ave|road|rd|lane|ln|drive|dr|boulevard|blvd|court|ct|way|pike|north|south|east|west)\b/;
export function findClusters(issues, dismissed = new Set(), { rare = 6, cap = 12 } = {}) {
  const live = issues.filter((i) => !isProject(i) && !i.projectKey && i.events?.length);
  const T = new Map(live.map((i) => [i.key, new Set(subjectTokens(i))]));
  const A = new Map(live.map((i) => [i.key, new Set((`${i.title} ${(i.events || []).map((e) => e.title).join(" ")}`.toLowerCase().match(ADDR) || []).map((x) => x.replace(/\./g, "")))]));
  const freq = new Map();
  for (const t of T.values()) for (const w of t) freq.set(w, (freq.get(w) || 0) + 1);
  // A street name is not a subject: "jefferson" in "1240 E. Jefferson St." links nothing
  const streety = new Set();
  for (const i of live) for (const m of i.title.toLowerCase().matchAll(/\b\d+\s+(?:[nsew]\.?\s+)?([a-z]+)\s+(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|boulevard|blvd|court|ct|way|pike)\b/g)) streety.add(m[1]);
  const pairs = new Map(); // "a|b" -> words
  const link = (a, b, why) => { const k = [a, b].sort().join("|"); (pairs.get(k) || pairs.set(k, new Set()).get(k)).add(why); };
  for (let x = 0; x < live.length; x++) for (let y = x + 1; y < live.length; y++) {
    const a = live[x].key, b = live[y].key;
    const shared = [...T.get(a)].filter((w) => T.get(b).has(w) && !streety.has(w));
    const rareShared = shared.filter((w) => freq.get(w) <= rare && w.length >= 4);
    if (rareShared.length) link(a, b, rareShared[0]);
    else if (shared.length >= 2) link(a, b, shared.slice(0, 2).join("+"));
    const addr = [...A.get(a)].find((d) => A.get(b).has(d));
    if (addr) link(a, b, addr);
  }
  for (const i of live) for (const r of i.related || []) if (T.has(r)) link(i.key, r, "related");
  // Connected groups, split again with a stricter rule when a group is too big to be one thing
  const groups = components(live.map((i) => i.key), [...pairs.keys()].map((k) => k.split("|")));
  const out = [];
  // A word that names one big thing shows up in many issues ("jail" in 20): everything carrying it goes to Claude as one
  // cluster, uncapped, so the pieces of the jail aren't split apart just because the word is common.
  if (rare >= 6) for (const [w, n] of freq) {
    if (n <= rare || n > 30 || w.length < 4 || streety.has(w)) continue;
    const keys = live.filter((i) => T.get(i.key).has(w)).map((i) => i.key).sort();
    const id = keys.join("|");
    if (!dismissed.has(id)) out.push({ id, keys, words: [w], status: "pending", anchor: true });
  }
  for (const keys of groups) {
    if (keys.length < 2) continue;
    const sets = keys.length > cap && rare > 2 ? findClusters(issues.filter((i) => keys.includes(i.key)), dismissed, { rare: Math.max(2, rare - 2), cap }) : null;
    if (sets) { out.push(...sets); continue; }
    const id = keys.slice().sort().join("|");
    if (dismissed.has(id)) continue;
    const words = [...new Set([...pairs].filter(([k]) => { const [a, b] = k.split("|"); return keys.includes(a) && keys.includes(b); }).flatMap(([, w]) => [...w]))].slice(0, 6);
    out.push({ id, keys: keys.sort(), words, status: "pending" });
  }
  return out.sort((a, b) => b.keys.length - a.keys.length);
}
function components(nodes, edges) {
  const parent = new Map(nodes.map((n) => [n, n]));
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  for (const [a, b] of edges) if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b));
  const g = new Map();
  for (const n of nodes) (g.get(find(n)) || g.set(find(n), []).get(find(n))).push(n);
  return [...g.values()];
}

const brief = (i) => {
  const evs = (i.events || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const ex = [...evs.slice(0, 2), ...evs.slice(-2)].filter((e, k, arr) => arr.indexOf(e) === k);
  return { key: i.key, title: i.title, boards: (i.bodies || []).map((b) => BODIES[b]?.short || b), from: i.firstDate, to: i.lastDate, items: evs.length, examples: ex.map((e) => `${e.date}: ${e.title}`) };
};
const GROUP_SCHEMA = { type: "object", required: ["projects", "leave"], properties: {
  projects: { type: "array", items: { type: "object", required: ["title", "parts", "confidence", "reason"], properties: { title: { type: "string", description: "Plain name a resident would use, e.g. 'New Howard County jail', 'Kokomo Conference Center'. Not a kind of matter." }, existing: { type: "string", description: "If these are pieces of a project that ALREADY EXISTS (listed under EXISTING PROJECTS), that project's key; the parts are added to it. Empty for a new project." }, parts: { type: "array", items: { type: "string" }, description: "Issue keys to group. At least 2 for a new project; 1 or more when adding to an existing one." }, confidence: { type: "string", enum: ["high", "medium", "low"] }, reason: { type: "string" } } } },
  leave: { type: "array", items: { type: "string" }, description: "Keys that belong to no project here" },
} };

export async function confirmClusters(clusters, issues) {
  const byKey = new Map(issues.map((i) => [i.key, i]));
  const existing = issues.filter(isProject).map((p) => `- ${p.key}: ${p.title} (parts: ${partsOf(p, issues).slice(0, 5).map((x) => x.title).join("; ")}${(p.parts || []).length > 5 ? "; …" : ""})`);
  const text = `${existing.length ? `EXISTING PROJECTS (add to these when a cluster's pieces belong to one of them):\n${existing.join("\n")}\n\n` : ""}` + clusters.map((c, n) => `CLUSTER ${n + 1} (shared words: ${c.words.join(", ")})\n${c.keys.map((k) => JSON.stringify(brief(byKey.get(k)))).join("\n")}`).join("\n\n");
  const system = `You maintain the issue pages of a local-government tracker for Kokomo and Howard County, Indiana. Each issue is one matter followed across meetings. A PROJECT is one physical thing or program that residents think of as one story, which the government handles as several separate matters: a new jail is its land purchase, its rezoning, the tax that pays for it, its bonds, its construction contract and its site plan. Group issues into projects.
Rules:
- A project needs at least 2 issues that are pieces of the SAME thing. The current jail's nursing contract or HVAC repair is NOT part of the NEW jail project; a different building on the same street is not the same project; the 2026 and 2027 budgets are not one project.
- Routine recurring items (claims, transfers, annual budgets, salary ordinances) are never project parts unless they are specifically and only about that project.
- One cluster may contain zero, one or several projects. Put everything else in "leave".
- "high" confidence only when every part is unmistakably the same thing.`;
  const out = await askJSON(system, `${text}\n\nReturn projects and leave for every key.`, { name: "group_projects", description: "Your grouping.", input_schema: GROUP_SCHEMA });
  const valid = new Set(clusters.flatMap((c) => c.keys));
  const projKeys = new Set(issues.filter(isProject).map((p) => p.key));
  return (out.projects || []).map((p) => ({ ...p, existing: projKeys.has(p.existing) ? p.existing : "", parts: [...new Set((p.parts || []).filter((k) => valid.has(k)))] })).filter((p) => p.title && p.parts.length >= (p.existing ? 1 : 2));
}

// Groupings we already know are right. Applied once; after that the scan and the review list own the data.
const SEEDS = [
  { key: "new-howard-county-jail", title: "New Howard County jail", parts: ["county-jail-project", "jail-construction-project", "new-jail-project", "new-county-jail", "county-jail-lit-interlocal", "kokomo-lit-jail-interlocal", "jail-bond-financing", "jail-construction-financing", "new-jail-bond", "jail-lease-bonds", "county-jail-project-financing", "new-jail-funding", "howard-county-jail-rezoning", "new-county-jail-site-rezoning", "markland-ave-jail-variances", "jail-property-mowing-contract"] },
];
export async function ensureSeeds() {
  const done = (await getJSON("projects:seeded")) || {};
  const issues = await listIssues();
  for (const sd of SEEDS) {
    if (done[sd.key]) continue;
    const have = sd.parts.filter((k) => { const i = findIssue(issues, k); return i && !isProject(i); });
    if (have.length < 2) continue;
    const existing = issues.find((i) => i.key === sd.key && isProject(i));
    if (existing) await addParts(sd.key, have); else await createProject({ title: sd.title, key: sd.key, parts: have });
    done[sd.key] = new Date().toISOString();
  }
  await setJSON("projects:seeded", done);
}

// One scan step, like dupeScan: build the queue on the first call, confirm a few clusters per call, apply the sure ones.
export async function projectScan({ restart = false, batch = 4 } = {}) {
  await ensureSeeds();
  const issues = await listIssues();
  const dismissed = new Set((await getJSON("projects:dismissed")) || []);
  let queue = await getJSON("projects:queue");
  if (!queue || restart) {
    // A fresh look at every ungrouped issue; suggestions still waiting for a person are kept
    const keep = (queue || []).filter((c) => (c.proposals || []).some((p) => p.status === "pending"));
    const keepIds = new Set(keep.map((c) => c.id));
    queue = [...keep, ...findClusters(issues, dismissed).filter((c) => !keepIds.has(c.id))];
    await setJSON("projects:queue", queue); await setJSON("projects:scan", { at: new Date().toISOString(), clusters: queue.length });
  }
  const todo = queue.filter((c) => c.status === "pending").slice(0, batch);
  const applied = [];
  if (todo.length) {
    let proposals = [];
    try { proposals = await confirmClusters(todo, issues); } catch (e) { return { error: e.message, queue: summary(queue, issues) }; }
    for (const c of todo) {
      const mine = proposals.filter((p) => p.parts.some((k) => c.keys.includes(k)));
      c.status = "judged"; c.proposals = mine.map((p) => ({ ...p, status: "pending" })); c.judgedAt = new Date().toISOString();
      if (!mine.length) { c.status = "dismissed"; dismissed.add(c.id); }
    }
    await setJSON("projects:dismissed", [...dismissed]);
    for (const c of todo) for (const p of c.proposals || []) {
      if (p.confidence === "high" && p.status === "pending") {
        const fresh = await listIssues();
        const free = p.parts.filter((k) => !findIssue(fresh, k)?.projectKey);
        if (free.length < (p.existing ? 1 : 2)) { p.status = "dismissed"; p.error = "already grouped"; continue; }
        try { const pr = p.existing ? await addParts(p.existing, free) : await createProject({ title: p.title, parts: free }); p.status = "applied"; p.key = pr.key; applied.push({ title: pr.title, key: pr.key, parts: free.length, added: !!p.existing }); } catch (e) { p.error = e.message; }
      }
    }
    for (const c of todo) if (c.status === "judged" && (c.proposals || []).every((p) => p.status !== "pending")) c.status = "done";
    await setJSON("projects:queue", queue);
  }
  return { applied, queue: summary(queue, await listIssues()) };
}

export async function applyProposal(clusterId, index, { title, parts } = {}) {
  const queue = (await getJSON("projects:queue")) || [];
  const c = queue.find((x) => x.id === clusterId); const p = c?.proposals?.[index];
  if (!p) throw new Error("That suggestion is gone.");
  const pr = p.existing ? await addParts(p.existing, parts || p.parts) : await createProject({ title: title || p.title, parts: parts || p.parts });
  p.status = "applied"; p.key = pr.key;
  if ((c.proposals || []).every((x) => x.status !== "pending")) c.status = "done";
  await setJSON("projects:queue", queue);
  return pr;
}
export async function dismissProposal(clusterId, index) {
  const queue = (await getJSON("projects:queue")) || [];
  const c = queue.find((x) => x.id === clusterId); const p = c?.proposals?.[index];
  if (p) {
    p.status = "dismissed"; if ((c.proposals || []).every((x) => x.status !== "pending")) c.status = "done"; await setJSON("projects:queue", queue);
    const d = new Set((await getJSON("projects:dismissed")) || []); d.add(c.id); await setJSON("projects:dismissed", [...d]); // don't ask again unless the cluster changes
  }
  return { ok: true };
}
export async function projectQueue() { await ensureSeeds(); return summary((await getJSON("projects:queue")) || [], await listIssues()); }
// For the daily run: a fresh scan, a few clusters at a time, inside a time budget. Returns what it made.
export async function projectScanAuto({ timeLeft = () => true, maxCalls = 8 } = {}) {
  let r = await projectScan({ restart: true }); const applied = [...(r.applied || [])]; let n = 1;
  while (r.queue && r.queue.pending > 0 && !r.error && n++ < maxCalls && timeLeft()) { r = await projectScan(); applied.push(...(r.applied || [])); }
  return { applied, review: r.queue?.review?.length || 0, pending: r.queue?.pending || 0, error: r.error || "" };
}

function summary(queue, issues) {
  const byKey = new Map(issues.map((i) => [i.key, i]));
  const t = (k) => ({ key: k, title: byKey.get(k)?.title || k, items: byKey.get(k)?.events?.length || 0, from: byKey.get(k)?.firstDate, to: byKey.get(k)?.lastDate, inProject: byKey.get(k)?.projectKey || "" });
  const review = [];
  for (const c of queue) for (const [n, p] of (c.proposals || []).entries()) if (p.status === "pending") review.push({ clusterId: c.id, index: n, title: p.title, existing: p.existing || "", existingTitle: p.existing ? byKey.get(p.existing)?.title || p.existing : "", confidence: p.confidence, reason: p.reason, parts: p.parts.map(t) });
  const projects = issues.filter(isProject).map((p) => ({ key: p.key, title: p.title, parts: (p.parts || []).map(t) })).sort((a, b) => b.parts.length - a.parts.length);
  return { pending: queue.filter((c) => c.status === "pending").length, review, projects, candidates: queue.length };
}
