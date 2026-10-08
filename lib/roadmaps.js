// Roadmaps: the road a kind of matter takes through Howard County and Kokomo government, so an issue page can show
// where something is, what's next, who decides it, and whether the public can speak. Written from the Indiana Code
// (IC 36-7-4 planning and zoning; 6-1.1-18-5 additional appropriations; 36-4-6 and 36-2-4 ordinances; 6-1.1-12.1
// abatements; 36-1-12 bidding; 6-1.1-17 budgets) and the Kokomo and Howard County codes. Observed events always win;
// the roadmap only sets expectations.
import { BODIES } from "./county.js";

// speak: "right" = a public hearing the law requires, "custom" = the board usually takes comment but needn't, "none" = no comment, "staff" = not a meeting
const S = (key, body, title, what, speak, extra = {}) => ({ key, body, title, what, speak, ...extra });

export const ROADMAPS = {
  "city-rezoning": {
    label: "Changing what land can be used for", gov: "city",
    intro: "A rezoning changes the rules for a piece of land inside Kokomo: what can be built there and how. Two boards look at it.",
    steps: [
      S("hearing", "city-plan", "Public hearing and recommendation", "The Plan Commission holds the one hearing the law requires. Neighbors can object here. It sends the Council a favorable, unfavorable or no recommendation.", "right"),
      S("first", "city-council", "First reading", "The ordinance is introduced. Usually no vote yet.", "custom"),
      S("final", "city-council", "Final vote", "Second reading and the vote. The Council usually takes comment, though the law doesn't require it. If the Council does nothing for 90 days after a favorable recommendation, the rezoning passes by default; after an unfavorable one, it dies.", "custom", { final: true }),
    ],
    after: "Takes effect when adopted. The mayor can't veto a zoning ordinance. Building still needs a site plan and permits.",
    law: "Indiana Code 36-7-4-602 to -610; Kokomo Code 30A.28",
  },
  "county-rezoning": {
    label: "Changing what land can be used for", gov: "county",
    intro: "A rezoning changes the rules for land outside city limits. The Plan Commission hears it; the Commissioners decide.",
    steps: [
      S("hearing", "plan", "Public hearing and recommendation", "The County Plan Commission holds the one hearing the law requires. Neighbors can object here. It sends the Commissioners a favorable, unfavorable or no recommendation.", "right"),
      S("final", "commissioners", "Commissioners vote", "The Commissioners usually decide at a single meeting. If they do nothing for 90 days after a favorable recommendation, it passes by default; after an unfavorable one, it dies.", "custom", { final: true }),
    ],
    after: "Takes effect when adopted. Building still needs permits, and for a big project a development plan.",
    law: "Indiana Code 36-7-4-602 to -610",
  },
  variance: {
    label: "An exception to the zoning rules",
    intro: "When a project doesn't fit the zoning rules exactly, the owner asks the Board of Zoning Appeals for specific exceptions (variances) or a special permission the rules allow (special exception).",
    steps: [
      S("hearing", ["city-bza", "bza"], "Hearing and decision", "The BZA hears the request and the neighbors, then votes. Its decision is final. Anyone who spoke or filed at the hearing has 30 days to challenge it in court; people who stayed silent can't.", "right", { final: true }),
    ],
    after: "If approved, the project moves to a site plan (for bigger projects) or straight to permits, which city staff issue without a meeting.",
    law: "Indiana Code 36-7-4-918.2 to -918.5, -1600 series (court review)",
  },
  "development-plan": {
    label: "A new building on a lot",
    intro: "A commercial project needs several approvals before anything is built. Each board decides a different piece.",
    steps: [
      S("variance", ["city-bza", "bza"], "Zoning exceptions (if needed)", "If the project doesn't fit the rules exactly, the BZA decides the exceptions first. Final; 30 days to challenge in court for people who spoke at the hearing.", "right", { optional: true }),
      S("plan", ["city-plan", "plan"], "Site plan (development plan)", "The detailed drawings: where the building, driveways, lights and landscaping go, and how traffic gets in and out. This is where neighbors have the most practical say on how it's built.", "right"),
      S("works", ["city-works", "commissioners"], "Streets and utilities", "Driveway openings, right-of-way, sewer and water connections, drainage agreements. Usually routine once the plan is approved.", "none"),
      S("permits", "staff", "Building permits and construction", "Permits come from the building department, not a board, so this step won't show up in a meeting.", "staff", { final: true, who: "City or county building department" }),
    ],
    after: "",
    law: "Indiana Code 36-7-4-1400 series",
  },
  subdivision: {
    label: "Splitting land into lots",
    intro: "Dividing land into lots for sale or building. Two approvals, only the first with a hearing.",
    steps: [
      S("primary", ["city-plan", "plan"], "Primary plat hearing", "The Plan Commission hears the layout: lots, streets, drainage. Skipped for small splits that add no street.", "right"),
      S("secondary", ["city-plan", "plan", "staff"], "Secondary plat", "The final drawings, usually approved by staff or a plat committee without a hearing, then recorded with the county.", "staff", { final: true }),
    ],
    after: "Once recorded, lots can be sold and built on with ordinary permits.",
    law: "Indiana Code 36-7-4-700 series",
  },
  appropriation: {
    label: "Spending beyond the budget",
    intro: "Spending money the yearly budget didn't include. Notice goes up at least 14 days ahead; the fiscal body holds a hearing and votes; for property-tax money the state then has 15 days to approve.",
    steps: [
      S("hearing", ["council", "city-council"], "Public hearing and vote", "The Council hears the request and anyone who wants to speak, then votes. It can't approve more than the amount advertised.", "right", { final: true }),
      S("state", "staff", "State approval", "For property-tax funds, the state (DLGF) checks that the money exists, within 15 days. Other funds are just reported.", "staff", { who: "Indiana Department of Local Government Finance" }),
    ],
    after: "",
    law: "Indiana Code 6-1.1-18-5",
  },
  "city-ordinance": {
    label: "A new city law or rule", gov: "city",
    intro: "Kokomo's Council reads every ordinance twice before voting, unless every member present agrees to pass it the same night.",
    steps: [
      S("first", "city-council", "First reading", "The ordinance is introduced. Usually no vote yet.", "custom"),
      S("final", "city-council", "Second reading and vote", "The vote. The Council usually takes comment first, though the law doesn't require it.", "custom", { final: true }),
      S("mayor", "staff", "Mayor signs or vetoes", "The mayor has 10 days. Silence counts as a veto; the Council can override with two-thirds.", "staff", { who: "The mayor" }),
    ],
    after: "",
    law: "Indiana Code 36-4-6-12 to -16; Kokomo Code 30A.27 to 30A.30",
  },
  "county-ordinance": {
    label: "A new county law or rule", gov: "county",
    intro: "The Commissioners pass ordinances, usually at a single meeting.",
    steps: [
      S("final", "commissioners", "Commissioners vote", "Introduced and adopted, usually the same meeting. An ordinance with a penalty is published before it takes effect.", "custom", { final: true }),
    ],
    after: "",
    law: "Indiana Code 36-2-4-7 and -8",
  },
  "tax-abatement": {
    label: "A property tax break for a business",
    intro: "A company asks to pay less property tax on a new building or equipment for several years, in exchange for jobs and investment it promises in writing.",
    steps: [
      S("prelim", ["council", "city-council"], "Preliminary resolution", "The Council declares the area eligible and takes the company's statement of benefits: the jobs, wages and investment it promises.", "custom"),
      S("confirm", ["council", "city-council"], "Public hearing and confirming resolution", "After notice to every taxing unit affected, the Council hears objections and confirms, changes or drops the abatement.", "right", { final: true }),
      S("comply", ["council", "city-council"], "Yearly check", "Each May the company reports whether it kept its promises. The Council can review and end the abatement if it didn't.", "custom", { recurring: true }),
    ],
    after: "",
    law: "Indiana Code 6-1.1-12.1",
  },
  contract: {
    label: "Hiring a contractor",
    intro: "Public work over $300,000 goes out for sealed bids, advertised twice; $50,000 to $300,000 takes quotes opened at a meeting; under $50,000, three quotes.",
    steps: [
      S("open", ["city-works", "commissioners", "council", "city-council"], "Bids opened", "Bids are opened and read aloud in public, then usually \"taken under advisement\" while staff check them.", "none"),
      S("award", ["city-works", "commissioners", "council", "city-council"], "Contract awarded", "Goes to the lowest responsible bidder, or all bids are rejected. Must happen within 60 days or bidders can walk away.", "none", { final: true }),
    ],
    after: "Work starts once the contract is signed. Change orders come back to the same board.",
    law: "Indiana Code 36-1-12",
  },
  budget: {
    label: "The yearly budget",
    intro: "Every year each unit adopts next year's budget: hearings, a public hearing, an adoption vote by November 1, then state certification.",
    steps: [
      S("hearing", ["council", "city-council"], "Public hearing", "After a notice to taxpayers, the Council hears the budget and anyone who wants to speak. Ten or more taxpayers can file a written objection within 7 days.", "right"),
      S("adopt", ["council", "city-council"], "Adoption vote", "The Council adopts the budget, by November 1 at the latest. For the city, the mayor then signs.", "custom", { final: true }),
      S("state", "staff", "State certification", "The state (DLGF) reviews and certifies the budget, levy and tax rate, usually by the end of December. It can cut but not raise what was adopted.", "staff", { who: "Indiana Department of Local Government Finance" }),
    ],
    after: "Takes effect January 1.",
    law: "Indiana Code 6-1.1-17",
  },
  appointment: {
    label: "Naming someone to a board",
    intro: "One vote. The term length is the only \"what's next.\"",
    steps: [S("vote", ["council", "city-council", "commissioners"], "Appointment", "The board nominates and votes.", "custom", { final: true })],
    after: "",
    law: "",
  },
};

// Which road an issue is on, from its events. Returns a kind or null when there's no safe guess. Admin can override.
export function classifyIssue(issue) {
  if (issue.kindOverride) return issue.kindOverride === "none" ? null : issue.kindOverride;
  const evs = issue.events || [];
  if (!evs.length) return null;
  const text = (issue.title + " " + evs.map((e) => `${e.title || ""} ${e.docNumber || ""}`).join(" ")).toLowerCase();
  const bodies = new Set(evs.map((e) => e.body));
  const cats = new Set(evs.map((e) => e.category).filter(Boolean));
  const gov = BODIES[evs[0].body]?.gov;
  const has = (re) => re.test(text);
  if (has(/\bbudget\b/) && (cats.has("budget") || has(/adopt|hearing/))) return "budget";
  if (has(/abatement|economic revitalization|statement of benefits/) || cats.has("tax abatement")) return "tax-abatement";
  if (has(/\b(plat|subdivision|replat)\b/)) return "subdivision";
  if (has(/variance|special exception|special use|zoning appeals/) || bodies.has("city-bza") || bodies.has("bza")) {
    // a variance that's part of a bigger build (site plan mentioned, or a development plan event) is a development-plan road
    return has(/development plan|site plan|planned development|\bpud\b/) ? "development-plan" : "variance";
  }
  const legislative = bodies.has("city-council") || bodies.has("commissioners");
  if (has(/rezon|zone map|zoning change|zoning amendment|from .{1,30} to .{1,30} zon/) || (cats.has("land use") && (bodies.has("plan") || bodies.has("city-plan") || legislative)) || (legislative && has(/planned development|\bpud\b/))) return gov === "county" || bodies.has("commissioners") || bodies.has("plan") ? "county-rezoning" : "city-rezoning";
  if (has(/development plan|site plan|planned development|\bpud\b/)) return "development-plan";
  if (has(/additional appropriation|appropriat/) || (cats.has("spending") && (bodies.has("council") || bodies.has("city-council")))) return "appropriation";
  if (has(/\b(bid|bids|contract award|awarded|low bid|quotes?)\b/) || cats.has("contract")) return "contract";
  if (has(/appoint|reappoint/) || cats.has("appointment")) return "appointment";
  if (cats.has("ordinance") || has(/\bordinance\b/) || /\bord\.? ?\d/.test(text)) return bodies.has("commissioners") ? "county-ordinance" : bodies.has("city-council") ? "city-ordinance" : null;
  return null;
}

const bodyMatches = (step, body) => step.body === "staff" ? false : (Array.isArray(step.body) ? step.body : [step.body]).includes(body);
const stageOf = (e) => String(e.stage || "").toLowerCase() + " " + String(e.result || "").toLowerCase();
const isFinalish = (e) => /adopted|approved|passed|denied|failed|recommended/.test(stageOf(e));
const isFirstReading = (e) => /introduced|first reading|\bread\b/.test(stageOf(e)) || /first reading/i.test(e.title || "");

// Place an issue's events on its road. Returns null when the issue has no kind.
export function roadmapFor(issue, { today, scheduled = [] } = {}) {
  const kind = classifyIssue(issue);
  const road = kind && ROADMAPS[kind];
  if (!road) return null;
  const evs = (issue.events || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const issueBodies = new Set(evs.map((e) => e.body));
  const issueGov = BODIES[evs[0]?.body]?.gov || road.gov || null;
  const pickBody = (list) => list.find((b) => issueBodies.has(b)) || list.find((b) => BODIES[b]?.gov === issueGov) || list[0];
  const steps = road.steps.map((s) => {
    const list = s.body === "staff" ? [] : Array.isArray(s.body) ? s.body : [s.body];
    const body = list.length ? pickBody(list) : null;
    return { key: s.key, title: s.title, what: s.what, speak: s.speak, optional: !!s.optional, final: !!s.final, recurring: !!s.recurring, body, bodies: list, bodyName: s.who || (body ? BODIES[body]?.name || "" : issueGov === "city" ? "City staff" : issueGov === "county" ? "County staff" : "Staff"), state: "later", event: null, scheduled: null };
  });
  // Walk events in order and assign each to the earliest unfilled step its board matches (first-reading events go to a "first" step when there is one).
  for (const e of evs) {
    const candidates = steps.filter((st) => st.bodies.includes(e.body));
    if (!candidates.length) continue;
    // Prefer the step whose meaning matches the event: a hearing to a "hearing" step, an adoption/approval to the deciding step, an introduction to "first".
    const st = stageOf(e) + " " + String(e.title || "").toLowerCase();
    const byKey = (k) => candidates.find((c) => c.key === k);
    let target = null;
    if (/public hearing/.test(st) && byKey("hearing") && !byKey("hearing").event) target = byKey("hearing");
    else if (/introduced|first reading/.test(st) && !isFinalish(e) && byKey("first")) target = byKey("first");
    else if (isFinalish(e)) target = candidates.find((c) => c.final) || candidates.find((c) => !c.event) || candidates[candidates.length - 1];
    else target = candidates.find((c) => !c.event) || candidates[candidates.length - 1];
    if (!target.event || target.recurring || e.date >= target.event.date) target.event = { date: e.date, meetingId: e.meetingId, idx: e.idx, title: e.title, result: e.result || "", stage: e.stage || "", label: e.label || "" };
    target.state = "done";
  }
  // The same-night two-readings case: a final vote with no first-reading event means the first step happened too.
  const fi = steps.findIndex((s) => s.key === "first"), fn = steps.findIndex((s) => s.key === "final");
  if (fi >= 0 && fn >= 0 && steps[fn].state === "done" && steps[fi].state !== "done") { steps[fi].state = "done"; steps[fi].event = { ...steps[fn].event, sameNight: true }; }
  // Scheduled: an upcoming agenda that mentions this issue fills the next step's date
  for (const sc of scheduled) { const st = steps.find((s) => s.state !== "done" && s.bodies.includes(sc.body)); if (st) { st.scheduled = { date: sc.date, meetingId: sc.id, bodyName: BODIES[sc.body]?.name }; } }
  // Next = first step after the last done one (skipping optional steps that didn't happen if a later one did)
  const lastDone = Math.max(-1, ...steps.map((s, i) => (s.state === "done" ? i : -1)));
  for (let i = 0; i < steps.length; i++) if (i < lastDone && steps[i].state !== "done") steps[i].state = steps[i].optional ? "skipped" : "missed";
  const nextIdx = steps.findIndex((s, i) => i > lastDone && s.state === "later");
  if (nextIdx >= 0) steps[nextIdx].state = "next";
  // Outcome: a final step that failed ends the road
  const finalStep = steps.find((s) => s.final);
  const failed = finalStep?.event && /failed|denied/.test(String(finalStep.event.result + " " + finalStep.event.stage).toLowerCase());
  const doneSteps = steps.filter((s) => s.state === "done").length;
  const total = steps.filter((s) => s.state !== "skipped").length;
  const lastDate = evs.length ? evs[evs.length - 1].date : null;
  const daysSince = lastDate && today ? Math.round((Date.parse(today + "T12:00:00Z") - Date.parse(lastDate + "T12:00:00Z")) / 864e5) : 0;
  let status = "active";
  if (failed) status = "failed";
  else if (finalStep?.state === "done" && (!steps.some((s) => s.state === "next") || steps.find((s) => s.state === "next")?.body == null)) status = "done";
  else if (nextIdx < 0) status = "done";
  else if (daysSince > 180) status = "stalled";
  let next = steps.find((s) => s.state === "next") || null;
  let nextOut = next ? { key: next.key, title: next.title, bodyName: next.bodyName, speak: next.speak, scheduled: next.scheduled } : null;
  // On an upcoming agenda even though the road looked finished: it's back (a second reading, a change, an appeal). Say so rather than "done".
  const unplaced = scheduled.filter((sc) => !steps.some((s) => s.scheduled?.meetingId === sc.id));
  if (unplaced.length && (status === "done" || status === "stalled" || !nextOut)) {
    const sc = unplaced.sort((a, b) => a.date.localeCompare(b.date))[0];
    status = "active";
    nextOut = { key: "again", title: "Back on the agenda", bodyName: BODIES[sc.body]?.name || "", speak: "custom", scheduled: { date: sc.date, meetingId: sc.id, bodyName: BODIES[sc.body]?.name } };
  }
  return { kind, label: road.label, intro: road.intro, after: road.after, law: road.law, steps, done: doneSteps, total, status, next: nextOut, daysSince };
}

export const KINDS = Object.entries(ROADMAPS).map(([k, r]) => ({ kind: k, label: r.label + (r.gov ? ` (${r.gov})` : "") }));
