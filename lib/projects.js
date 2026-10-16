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
const KIND_WORDS = new Set("street road avenue drive lane build demolition emergency rezoning rezone zoning ordinance resolution additional appropriations appropriation transfers transfer property unsafe hearing financing bond bonds budget salary amendment amendments contract contracts agreement agreements bid bids grant grants fund funds funding tax taxes rate rates plan plans plat variance variances permit permits lease loan loans payment payments study review approval services service department office board council commission commissioners county city kokomo howard public safety".split(" "));
const subjectTokens = (i) => [...tokens(`${i.title} ${i.key.replace(/-/g, " ")}`)].filter((w) => !KIND_WORDS.has(w) && !/^\d+$/.test(w));

export function findClusters(issues, dismissed = new Set()) {
  const live = issues.filter((i) => !isProject(i) && !i.projectKey && i.events?.length);
  const byWord = new Map();
  for (const i of live) for (const w of new Set(subjectTokens(i))) (byWord.get(w) || byWord.set(w, []).get(w)).push(i.key);
  // union-find over issues that share a subject word (in 2..12 issues: more than that is a word like "school"), or a "related" link
  const parent = new Map(live.map((i) => [i.key, i.key]));
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const union = (a, b) => { if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b)); };
  const why = new Map();
  for (const [w, keys] of byWord) if (keys.length >= 2 && keys.length <= 12) { for (let n = 1; n < keys.length; n++) union(keys[0], keys[n]); for (const k of keys) (why.get(k) || why.set(k, new Set()).get(k)).add(w); }
  for (const i of live) for (const r of i.related || []) union(i.key, r);
  const groups = new Map();
  for (const i of live) (groups.get(find(i.key)) || groups.set(find(i.key), []).get(find(i.key))).push(i.key);
  const out = [];
  for (const keys of groups.values()) {
    if (keys.length < 2) continue;
    const id = keys.slice().sort().join("|");
    if (dismissed.has(id)) continue;
    const words = [...new Set(keys.flatMap((k) => [...(why.get(k) || [])]))].slice(0, 6);
    out.push({ id, keys: keys.sort(), words, status: "pending" });
  }
  return out.sort((a, b) => b.keys.length - a.keys.length);
}

const brief = (i) => {
  const evs = (i.events || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const ex = [...evs.slice(0, 2), ...evs.slice(-2)].filter((e, k, arr) => arr.indexOf(e) === k);
  return { key: i.key, title: i.title, boards: (i.bodies || []).map((b) => BODIES[b]?.short || b), from: i.firstDate, to: i.lastDate, items: evs.length, examples: ex.map((e) => `${e.date}: ${e.title}`) };
};
const GROUP_SCHEMA = { type: "object", required: ["projects", "leave"], properties: {
  projects: { type: "array", items: { type: "object", required: ["title", "parts", "confidence", "reason"], properties: { title: { type: "string", description: "Plain name a resident would use, e.g. 'New Howard County jail', 'Kokomo Conference Center'. Not a kind of matter." }, parts: { type: "array", items: { type: "string" }, description: "Issue keys, at least 2" }, confidence: { type: "string", enum: ["high", "medium", "low"] }, reason: { type: "string" } } } },
  leave: { type: "array", items: { type: "string" }, description: "Keys that belong to no project here" },
} };

export async function confirmClusters(clusters, issues) {
  const byKey = new Map(issues.map((i) => [i.key, i]));
  const text = clusters.map((c, n) => `CLUSTER ${n + 1} (shared words: ${c.words.join(", ")})\n${c.keys.map((k) => JSON.stringify(brief(byKey.get(k)))).join("\n")}`).join("\n\n");
  const system = `You maintain the issue pages of a local-government tracker for Kokomo and Howard County, Indiana. Each issue is one matter followed across meetings. A PROJECT is one physical thing or program that residents think of as one story, which the government handles as several separate matters: a new jail is its land purchase, its rezoning, the tax that pays for it, its bonds, its construction contract and its site plan. Group issues into projects.
Rules:
- A project needs at least 2 issues that are pieces of the SAME thing. The current jail's nursing contract or HVAC repair is NOT part of the NEW jail project; a different building on the same street is not the same project; the 2026 and 2027 budgets are not one project.
- Routine recurring items (claims, transfers, annual budgets, salary ordinances) are never project parts unless they are specifically and only about that project.
- One cluster may contain zero, one or several projects. Put everything else in "leave".
- "high" confidence only when every part is unmistakably the same thing.`;
  const out = await askJSON(system, `${text}\n\nReturn projects and leave for every key.`, { name: "group_projects", description: "Your grouping.", input_schema: GROUP_SCHEMA });
  const valid = new Set(clusters.flatMap((c) => c.keys));
  return (out.projects || []).map((p) => ({ ...p, parts: [...new Set((p.parts || []).filter((k) => valid.has(k)))] })).filter((p) => p.parts.length >= 2 && p.title);
}

// One scan step, like dupeScan: build the queue on the first call, confirm a few clusters per call, apply the sure ones.
export async function projectScan({ restart = false, batch = 4 } = {}) {
  const issues = await listIssues();
  const dismissed = new Set((await getJSON("projects:dismissed")) || []);
  let queue = restart ? null : await getJSON("projects:queue");
  if (!queue) { queue = findClusters(issues, dismissed); await setJSON("projects:queue", queue); }
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
        try { const pr = await createProject({ title: p.title, parts: p.parts }); p.status = "applied"; p.key = pr.key; applied.push({ title: pr.title, key: pr.key, parts: pr.parts.length }); } catch (e) { p.error = e.message; }
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
  const pr = await createProject({ title: title || p.title, parts: parts || p.parts });
  p.status = "applied"; p.key = pr.key;
  if ((c.proposals || []).every((x) => x.status !== "pending")) c.status = "done";
  await setJSON("projects:queue", queue);
  return pr;
}
export async function dismissProposal(clusterId, index) {
  const queue = (await getJSON("projects:queue")) || [];
  const c = queue.find((x) => x.id === clusterId); const p = c?.proposals?.[index];
  if (p) { p.status = "dismissed"; if ((c.proposals || []).every((x) => x.status !== "pending")) c.status = "done"; await setJSON("projects:queue", queue); }
  return { ok: true };
}
export async function projectQueue() { return summary((await getJSON("projects:queue")) || [], await listIssues()); }

function summary(queue, issues) {
  const byKey = new Map(issues.map((i) => [i.key, i]));
  const t = (k) => ({ key: k, title: byKey.get(k)?.title || k, items: byKey.get(k)?.events?.length || 0, from: byKey.get(k)?.firstDate, to: byKey.get(k)?.lastDate, inProject: byKey.get(k)?.projectKey || "" });
  const review = [];
  for (const c of queue) for (const [n, p] of (c.proposals || []).entries()) if (p.status === "pending") review.push({ clusterId: c.id, index: n, title: p.title, confidence: p.confidence, reason: p.reason, parts: p.parts.map(t) });
  const projects = issues.filter(isProject).map((p) => ({ key: p.key, title: p.title, parts: (p.parts || []).map(t) })).sort((a, b) => b.parts.length - a.parts.length);
  return { pending: queue.filter((c) => c.status === "pending").length, review, projects, candidates: queue.length };
}
