// Projects: one page above several issues. A jail is land, a tax, bonds, a construction contract and a site plan; each is a
// real matter with its own road, but a resident wants one page. A project is stored like an issue (issue:<key>) with
// isProject and a list of parts; each part carries projectKey. The project has no events of its own: its timeline is the
// union of its parts, computed when read. Grouping is suggested by word clusters and "related" links, confirmed by Claude,
// applied when sure, and otherwise queued for a person, the same way duplicate merges work.
import { listIssues, saveIssue, redis, getJSON, setJSON, listMeetings, getMeeting, saveMeeting } from "./store.js";
import { BODIES } from "./county.js";
import { askJSON } from "./claude.js";
import { findIssue, tokens, recount, aliasMap, resolveKey } from "./issues.js";

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

export async function confirmClusters(clusters, issues, { timeoutMs = 40000, hint = "" } = {}) {
  const byKey = new Map(issues.map((i) => [i.key, i]));
  const existing = issues.filter(isProject).map((p) => `- ${p.key}: ${p.title} (parts: ${partsOf(p, issues).slice(0, 5).map((x) => x.title).join("; ")}${(p.parts || []).length > 5 ? "; …" : ""})`);
  const text = `${existing.length ? `EXISTING PROJECTS (add to these when a cluster's pieces belong to one of them):\n${existing.join("\n")}\n\n` : ""}` + clusters.map((c, n) => `CLUSTER ${n + 1} (shared words: ${c.words.join(", ")})\n${c.keys.filter((k) => byKey.has(k)).map((k) => JSON.stringify({ ...brief(byKey.get(k)), ...(c.why?.[k] ? { matched: c.why[k] } : {}) })).join("\n")}`).join("\n\n") + (hint ? `\n\nNOTE: ${hint}` : ""); // a key can vanish after a merge; skip it rather than fail the cluster
  const system = `You maintain the issue pages of a local-government tracker for Kokomo and Howard County, Indiana. Each issue is one matter followed across meetings. A PROJECT is one physical thing or program that residents think of as one story, which the government handles as several separate matters: a new jail is its land purchase, its rezoning, the tax that pays for it, its bonds, its construction contract and its site plan. Group issues into projects.
Rules:
- A project needs at least 2 issues that are pieces of the SAME thing. The current jail's nursing contract or HVAC repair is NOT part of the NEW jail project; a different building on the same street is not the same project; the 2026 and 2027 budgets are not one project.
- Routine recurring items (claims, transfers, annual budgets, salary ordinances) are never project parts unless they are specifically and only about that project.
- One cluster may contain zero, one or several projects. Put everything else in "leave".
- "high" confidence only when every part is unmistakably the same thing.`;
  const out = await askJSON(system, `${text}\n\nReturn projects and leave for every key.`, { name: "group_projects", description: "Your grouping.", input_schema: GROUP_SCHEMA }, { timeoutMs, maxTokens: 4000 });
  const valid = new Set(clusters.flatMap((c) => c.keys));
  const projKeys = new Set(issues.filter(isProject).map((p) => p.key));
  return (out.projects || []).map((p) => ({ ...p, existing: projKeys.has(p.existing) ? p.existing : "", parts: [...new Set((p.parts || []).filter((k) => valid.has(k)))] })).filter((p) => p.title && p.parts.length >= (p.existing ? 1 : 2));
}

// Groupings we already know are right. Applied once per version; after that the scan, the handles and the review list own the data.
// Only fields the project doesn't have yet are filled, so edits made in the admin are kept.
const SEEDS = [
  { key: "new-howard-county-jail", v: 1, title: "New Howard County jail", parts: ["county-jail-project", "jail-construction-project", "new-jail-project", "new-county-jail", "county-jail-lit-interlocal", "kokomo-lit-jail-interlocal", "jail-bond-financing", "jail-construction-financing", "new-jail-bond", "jail-lease-bonds", "county-jail-project-financing", "new-jail-funding", "howard-county-jail-rezoning", "new-county-jail-site-rezoning", "markland-ave-jail-variances", "jail-property-mowing-contract"],
    handles: ["new jail", "jail project", "jail construction", "jail bonds", "jail bond", "lit interlocal", "jail site"] },
  { key: "northeast-industrial-park", v: 1, title: "Northeast industrial park (north of US 31)",
    about: "Land north and east of US 31 that Kokomo annexed and rezoned for heavy industry in early 2026, and the steps around it since. Each piece below is its own matter; this page keeps them in one place and in order.",
    parts: ["ne-howard-county-industrial-development", "north-of-samsung-rezoning-annexation", "p04-z-26-north-industrial-park-rezoning", "kokomo-annexation-northeast-county", "northeast-annexation-746-acres", "northeast-industrial-rezoning-654-acres", "north-industrial-park-annexation", "high-industrial-park-zoning", "omicron-delta-annexed-property", "whitmore-blackwell-rezonings-north-of-us-31"],
    related: ["data-center-moratorium", "battery-storage-and-data-center-moratorium", "data-center-moratorium-study", "zoning-ordinance-amendments", "zoning-ordinance-7250-data-centers", "kokomo-zoning-ordinance-7250-data-centers"],
    handles: ["whitmore", "blackwell", "digital realty", "omicron delta", "ordinance 7229", "ord 7229", "ordinance 7234", "ord 7234", "p04 z 26", "746 acres", "654 acres", "north and east of us 31", "3660 n us 31", "high industrial park zone", "northeast annexation", "annexed land"] },
];
// Items filed under the wrong issue by the drafter. Matched by meeting and title so an idx shuffle can't hit the wrong item.
const FIXUPS = [
  { id: "ne-park-oct13", meetingId: "city-plan-2026-10-13", match: /^(55|335) acres\b.*(industrial|annexation)/i, issue: { key: "whitmore-blackwell-rezonings-north-of-us-31", title: "New rezonings north of US 31: 55 and 335 acres (Whitmore & Blackwell)" } },
];
async function applyFixups(done) {
  for (const f of FIXUPS) {
    if (done[f.id]) continue;
    const m = await getMeeting(f.meetingId); if (!m) continue;
    let n = 0;
    for (const rec of [m.record, m.draft]) for (const it of rec?.items || []) if (f.match.test(it.title || "") && it.issue?.key !== f.issue.key) { it.issue = { ...(it.issue || {}), ...f.issue }; n++; }
    if (n) { await saveMeeting(m); const { rebuildIssuesFor } = await import("./pipeline.js"); await rebuildIssuesFor(m); }
    done[f.id] = new Date().toISOString();
  }
}
export async function ensureSeeds() {
  const done = (await getJSON("projects:seeded")) || {};
  try { await applyFixups(done); } catch (e) { /* a refile that fails shouldn't block the page; it's retried next time */ }
  const issues = await listIssues();
  for (const sd of SEEDS) {
    const mark = `${sd.key}@${sd.v}`;
    if (done[mark]) continue;
    const have = sd.parts.filter((k) => { const i = findIssue(issues, k); return i && !isProject(i); });
    let project = issues.find((i) => i.key === sd.key && isProject(i));
    if (!project && have.length < 2) continue;
    if (project) await addParts(sd.key, have.filter((k) => !findIssue(issues, k)?.projectKey)); else await createProject({ title: sd.title, key: sd.key, parts: have });
    project = (await listIssues()).find((i) => i.key === sd.key && isProject(i));
    if (project) {
      let changed = false;
      if (sd.about && !project.about) { project.about = sd.about; changed = true; }
      if (sd.handles && !(project.handles || []).length) { project.handles = cleanHandles(sd.handles); changed = true; }
      if (sd.related && !(project.related || []).length) { project.related = sd.related.filter((k) => findIssue(issues, k)); changed = true; }
      if (changed) await saveIssue(project);
    }
    done[mark] = new Date().toISOString(); delete done[sd.key];
  }
  await setJSON("projects:seeded", done);
}

// One scan step, like dupeScan: build the queue on the first call, confirm a few clusters per call, apply the sure ones.
export async function projectScan({ restart = false, batch = 1 } = {}) {
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
    // Count the attempt BEFORE asking Claude: if the platform kills this request outright (a 504), the next call still
    // knows this cluster already failed once and will skip it after the second try instead of hitting the same wall forever.
    for (const c of todo) { c.tries = (c.tries || 0) + 1; c.error = "The request was cut off before Claude answered."; if (c.tries >= 2) c.status = "error"; }
    await setJSON("projects:queue", queue);
    try { proposals = await confirmClusters(todo, issues, { timeoutMs: 40000 }); }
    catch (e) {
      for (const c of todo) c.error = e.message;
      await setJSON("projects:queue", queue);
      return { error: `Couldn't check ${todo.length} cluster${todo.length === 1 ? "" : "s"} (${e.message}). ${todo.some((c) => c.status === "error") ? "Skipped them." : "Will try once more."}`, queue: summary(queue, issues) };
    }
    for (const c of todo) { delete c.error; if (c.status === "error") c.status = "pending"; }
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
  if (p.handles?.length) { const fresh = (await listIssues()).find((i) => i.key === pr.key); if (fresh && !(fresh.handles || []).length) { fresh.handles = cleanHandles(p.handles); await saveIssue(fresh); } }
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
  const errors = []; if (r.error) errors.push(r.error);
  while (r.queue && r.queue.pending > 0 && n++ < maxCalls && timeLeft()) { r = await projectScan(); applied.push(...(r.applied || [])); if (r.error) errors.push(r.error); }
  let h = { applied: [], review: 0 };
  if (timeLeft()) { try { h = await handleScan({ timeLeft, maxCalls: Math.max(2, maxCalls - n) }); applied.push(...h.applied); } catch (e) { errors.push(e.message); } }
  return { applied, review: (r.queue?.review?.length || 0) + (h.review || 0), pending: r.queue?.pending || 0, error: errors.slice(-1)[0] || "", errors: errors.length };
}

function summary(queue, issues) {
  const byKey = new Map(issues.map((i) => [i.key, i]));
  const t = (k) => ({ key: k, title: byKey.get(k)?.title || k, items: byKey.get(k)?.events?.length || 0, from: byKey.get(k)?.firstDate, to: byKey.get(k)?.lastDate, inProject: byKey.get(k)?.projectKey || "" });
  const review = [];
  for (const c of queue) for (const [n, p] of (c.proposals || []).entries()) if (p.status === "pending") review.push({ clusterId: c.id, index: n, title: p.title, existing: p.existing || "", existingTitle: p.existing ? byKey.get(p.existing)?.title || p.existing : "", confidence: p.confidence, reason: p.reason, parts: p.parts.map(t), handles: p.handles || [], why: p.why || {} });
  const projects = issues.filter(isProject).map((p) => ({ key: p.key, title: p.title, about: p.about || "", handles: p.handles || [], related: (p.related || []).map(t), note: p.note || null, parts: (p.parts || []).map(t) })).sort((a, b) => b.parts.length - a.parts.length);
  return { pending: queue.filter((c) => c.status === "pending").length, review, projects, candidates: queue.length, errors: queue.filter((c) => c.status === "error").map((c) => ({ keys: c.keys.map((k) => byKey.get(k)?.title || k), error: c.error })) };
}

// ---- Handles: the names, numbers and places that tie a project's pieces together when the titles don't.
// The jail says "jail" in every title. An industrial park is "746 acres" in one item, "Ordinance 7234" in the next and a
// company name in the one after that. Each project keeps a short list of those handles; every item in the archive is
// checked against them by plain text search (free), and only the matches go to Claude for a yes or no.
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
export const cleanHandles = (list) => [...new Set((Array.isArray(list) ? list : String(list || "").split(/[,\n;]/)).map((h) => norm(h)).filter((h) => h.length >= 4 && !/^\d{1,3}$/.test(h)))].slice(0, 40);
const itemText = (it) => [it.title, it.officialTitle, it.docNumber, it.whatItIs, it.whyItMatters, it.location, it.recipient, it.fundingSource, ...(it.parties || []).map((p) => p.name), ...(it.notes || []), ...(it.quotes || []).map((x) => `${x.speaker || ""} ${x.text}`), ...(it.detail ? [it.detail] : [])].filter(Boolean).join(" ");
// Every public item as searchable text, with the issue it's filed under
async function corpus(issues) {
  const { recordOf, isPublic } = await import("./publish.js");
  const aliases = aliasMap(issues);
  const out = [];
  for (const m of await listMeetings()) {
    const rec = recordOf(m); if (!rec || !isPublic(m)) continue;
    (rec.items || []).forEach((it, idx) => out.push({ meetingId: m.id, date: m.date, idx, key: resolveKey((it.issue?.key || "").trim(), aliases), title: it.title, text: ` ${norm(itemText(it))} ` }));
  }
  return out;
}
const hits = (handles, text) => handles.filter((h) => text.includes(` ${h} `) || text.includes(` ${h}s `));
// Which issues' items mention any of these handles: key -> { handles: Set, items: n }
function matchHandles(handles, items) {
  const by = new Map();
  for (const it of items) {
    if (!it.key) continue;
    const h = hits(handles, it.text); if (!h.length) continue;
    const e = by.get(it.key) || by.set(it.key, { handles: new Set(), items: 0 }).get(it.key);
    for (const x of h) e.handles.add(x); e.items++;
  }
  return by;
}

const HANDLE_SCHEMA = { type: "object", required: ["handles"], properties: {
  handles: { type: "array", items: { type: "string" }, description: "6 to 20 short search strings, each specific to THIS thing: company or LLC names, petitioners, ordinance/resolution/case numbers written as they appear ('Ordinance 7234', 'P04-Z-26', '2026-BCCO-29'), acreages ('654 acres'), addresses and place descriptions ('north and east of US 31', '3660 N. US 31'), the project's own name if it has one. Never a kind of matter (rezoning, annexation, bond), a board, the city or county, or a lone number." },
  title: { type: "string", description: "What a resident would call the whole thing, if the pieces are clearly one project. Plain, from the record's own words; don't coin a name." },
} };
// Pull the handles out of one issue's full text
export async function handlesFor(issue, items) {
  const mine = items.filter((it) => it.key === issue.key).slice(-12);
  const text = `ISSUE: ${issue.title}\n${mine.map((it) => `${it.date} ${it.title}: ${it.text.trim().slice(0, 700)}`).join("\n")}`;
  const out = await askJSON("You index a local-government tracker for Kokomo and Howard County, Indiana. From one issue's meeting items, pull out the handles that identify this specific matter so other items about the same thing can be found by text search.", text, { name: "handles", description: "The handles.", input_schema: HANDLE_SCHEMA }, { timeoutMs: 20000, maxTokens: 1500 });
  return { handles: cleanHandles([...(out.handles || []), issue.title]).filter((h) => h !== norm(issue.title) || h.split(" ").length <= 4), title: String(out.title || "").trim() };
}

// "Start a project here": one issue in, a proposal out. Claude names the handles, the archive is searched for them,
// Claude says which matches are pieces of the same thing, and the result waits in the review list like any other proposal.
export async function projectFrom(key, { apply = false } = {}) {
  const issues = await listIssues();
  const issue = findIssue(issues, key);
  if (!issue || isProject(issue)) throw new Error("No such issue.");
  const items = await corpus(issues);
  const { handles, title } = await handlesFor(issue, items);
  if (!handles.length) throw new Error("Couldn't find anything specific enough in this issue to search for.");
  const found = matchHandles(handles, items);
  found.delete(issue.key);
  const cands = [...found.entries()].filter(([k]) => { const i = issues.find((x) => x.key === k); return i && !isProject(i); }).sort((a, b) => b[1].handles.size - a[1].handles.size || b[1].items - a[1].items).slice(0, 14);
  for (const r of issue.related || []) if (!found.has(r) && findIssue(issues, r) && !isProject(findIssue(issues, r))) cands.push([r, { handles: new Set(["related"]), items: 0 }]);
  const keys = [issue.key, ...cands.map(([k]) => k)];
  const why = Object.fromEntries(cands.map(([k, v]) => [k, [...v.handles]]));
  const queue = (await getJSON("projects:queue")) || [];
  const id = `from:${issue.key}:${keys.slice().sort().join("|")}`;
  let proposals = [];
  if (keys.length >= 2) {
    const cluster = { id, keys, words: handles.slice(0, 8), status: "pending", why };
    proposals = await confirmClusters([cluster], issues, { timeoutMs: 32000, hint: `Cluster 1 was built by searching the archive for the handles of "${issue.title}" (${handles.slice(0, 10).join("; ")}). Each candidate lists which handles it matched. ${title ? `A reasonable name for the whole thing, from the record: "${title}". ` : ""}Keep the pieces that are the same physical thing or program; leave policy responses about the subject in general (a moratorium, new standards) out of the parts.` });
  }
  if (!proposals.length) proposals = [{ title: title || issue.title, existing: "", parts: [issue.key], confidence: "low", reason: keys.length >= 2 ? "Claude didn't think the matches were pieces of one thing. You can still start the project from this issue alone and add parts by hand." : "Nothing else in the archive mentions these handles yet. The nightly check will keep looking." }];
  for (const p of proposals) { p.handles = handles; p.why = why; p.status = "pending"; p.seedKey = issue.key; }
  const c = { id, keys, words: handles.slice(0, 8), status: "judged", proposals, judgedAt: new Date().toISOString(), from: issue.key };
  const rest = queue.filter((x) => x.id !== id);
  rest.unshift(c);
  await setJSON("projects:queue", rest);
  if (apply && proposals[0]?.parts?.length >= (proposals[0].existing ? 1 : 2)) return { project: await applyProposal(id, 0), queue: summary(rest, await listIssues()) };
  return { clusterId: id, proposals: summary(rest, issues).review.filter((r) => r.clusterId === id), handles, candidates: cands.length };
}

// Nightly: new items that mention a project's handles. Zero cost unless something matched; then one Claude call per project.
export async function handleScan({ timeLeft = () => true, maxCalls = 4, sinceDays = 60 } = {}) {
  const issues = await listIssues();
  const projects = issues.filter((p) => isProject(p) && (p.handles || []).length);
  if (!projects.length) return { checked: 0, applied: [], review: 0 };
  const items = await corpus(issues);
  const since = new Date(Date.now() - sinceDays * 864e5).toISOString().slice(0, 10);
  const dismissed = new Set((await getJSON("projects:dismissed")) || []);
  let queue = (await getJSON("projects:queue")) || [];
  const applied = []; let calls = 0, review = 0;
  for (const p of projects) {
    if (calls >= maxCalls || !timeLeft()) break;
    const have = new Set([p.key, ...(p.parts || []), ...(p.related || [])]);
    const found = matchHandles(p.handles, items.filter((it) => it.date >= since));
    const cands = [...found.keys()].filter((k) => { const i = issues.find((x) => x.key === k); return i && !isProject(i) && !have.has(k) && !i.projectKey; }).slice(0, 10);
    if (!cands.length) continue;
    const id = `handles:${p.key}:${cands.slice().sort().join("|")}`;
    if (dismissed.has(id) || queue.some((c) => c.id === id)) continue;
    const why = Object.fromEntries(cands.map((k) => [k, [...found.get(k).handles]]));
    calls++;
    let proposals = [];
    try { proposals = await confirmClusters([{ id, keys: cands, words: p.handles.slice(0, 8), why }], issues, { timeoutMs: 40000, hint: `These issues mention handles that belong to the existing project "${p.title}" (${p.handles.slice(0, 10).join("; ")}). Decide which are pieces of that project (use existing="${p.key}"); leave the rest.` }); }
    catch (e) { queue.push({ id, keys: cands, words: p.handles.slice(0, 8), status: "error", error: e.message, tries: 2 }); continue; }
    const mine = proposals.filter((x) => x.existing === p.key || x.parts.length >= 2).map((x) => ({ ...x, existing: x.existing || p.key, status: "pending", why }));
    const c = { id, keys: cands, words: p.handles.slice(0, 8), status: mine.length ? "judged" : "dismissed", proposals: mine, judgedAt: new Date().toISOString(), handlesOf: p.key };
    if (!mine.length) dismissed.add(id);
    for (const x of mine) {
      if (x.confidence === "high") { try { await addParts(p.key, x.parts); x.status = "applied"; applied.push({ title: p.title, key: p.key, parts: x.parts.length, added: true }); } catch (e) { x.error = e.message; } }
      else review++;
    }
    if (c.proposals.every((x) => x.status !== "pending") && c.status === "judged") c.status = "done";
    queue.push(c);
  }
  await setJSON("projects:queue", queue); await setJSON("projects:dismissed", [...dismissed]);
  return { checked: projects.length, applied, review, calls };
}

// Admin edits to a project's own fields (never its parts; those have their own actions)
export async function editProject(key, patch = {}) {
  const issues = await listIssues();
  const project = issues.find((i) => i.key === key && isProject(i));
  if (!project) throw new Error("No such project.");
  if ("title" in patch) project.title = String(patch.title || "").trim() || project.title;
  if ("about" in patch) project.about = String(patch.about || "").trim().slice(0, 600);
  if ("handles" in patch) project.handles = cleanHandles(patch.handles);
  if ("related" in patch) project.related = [...new Set((Array.isArray(patch.related) ? patch.related : String(patch.related || "").split(/[,\s]+/)).map((k) => findIssue(issues, k.trim())?.key).filter((k) => k && k !== key))].slice(0, 20);
  if ("note" in patch) {
    const n = patch.note || {};
    const text = String(n.text || "").trim().slice(0, 500);
    project.note = text ? { text, url: String(n.url || "").trim().slice(0, 500), source: String(n.source || "").trim().slice(0, 120), date: /^\d{4}-\d{2}-\d{2}$/.test(n.date || "") ? n.date : "" } : null;
  }
  project.updatedAt = new Date().toISOString();
  await saveIssue(project);
  return project;
}
