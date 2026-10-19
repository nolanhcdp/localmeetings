// What the public sees. Every drafted meeting publishes automatically; each item carries a label:
//   confirmed  – the official minutes back it up (or Nolan approved the meeting)
//   video      – from the meeting video; minutes not out yet (or this board has no minutes online)
//   unclear    – Claude wasn't sure (shown with a plain note)
//   held       – kept off the public site until Nolan publishes, fixes or hides it
import { BODIES } from "./county.js";

const CONFLICT = /(disagree|conflict|contradict|mismatch|differ|inconsisten|but the (video|minutes)|minutes say .* video|video .* minutes say)/i;

export function itemLabel(m, it) {
  if (it.hidden) return "hidden";
  if (it.hold && !it.released) return "held";
  if (m.status === "approved") return "confirmed";
  // Drafts made before the hold rules existed: hold only the ones whose own note says the sources disagree.
  if (!m.draftMeta?.schema && it.confidence === "low" && CONFLICT.test(it.checkNote || "") && !it.released) return "held";
  if (it.verified === "minutes") return "confirmed";
  if (it.confidence === "low") return "unclear";
  if (m.draftMeta?.hadMinutes) return "confirmed";
  return "video";
}

// ---- Residents' personal details never reach the site. Claude is told to leave them out; this catches what slips through.
// Street words for an address like "1234 N. Washington St." and county-road addresses like "3402 E 300 S".
const STREET = "(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Blvd|Boulevard|Way|Pl|Place|Pike|Hwy|Highway|Cir|Circle|Trl|Trail|Pkwy|Parkway|Ter|Terrace|Row)";
const HOUSE = new RegExp(`\\b\\d{1,6}\\s+((?:[NSEW]\\.?|North|South|East|West)\\s+)?((?:[A-Z][\\w'.-]*\\s+){1,3}${STREET}\\b\\.?)`, "g");
const COUNTY_ROAD = /\b\d{3,5}\s+([NSEW]\.?\s+\d{2,4}(?:\s+[NSEW]\b\.?)?)/g;
const PHONE = /(?:\+?1[-.\s]?)?(?:\(\d{3}\)\s?|\b\d{3}[-.\s])\d{3}[-.\s]\d{4}\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
export function scrubText(t) {
  if (typeof t !== "string" || !t) return t;
  return t.replace(EMAIL, "[email removed]").replace(PHONE, "[phone removed]").replace(HOUSE, (_, dir, street) => `${dir || ""}${street}`).replace(COUNTY_ROAD, "$1");
}
const RESIDENT = /resident|member of the public|citizen|neighbor|speaker|caller|homeowner|commenter/i;
// Scrub where a private speaker's details can appear: every field of a public-comment item, quotes from residents anywhere,
// and notes. Agenda items keep their own property addresses (the subject of a rezoning or variance is public record).
export function scrubRecord(record) {
  for (const it of record?.items || []) {
    if (it.category === "public comment") for (const k of ["title", "whatItIs", "whyItMatters", "checkNote"]) it[k] = scrubText(it[k]);
    it.notes = (it.notes || []).map((n) => (it.category === "public comment" || RESIDENT.test(n) ? scrubText(n) : n));
    for (const q of it.quotes || []) if (it.category === "public comment" || !q.speaker || RESIDENT.test(q.speaker)) q.text = scrubText(q.text);
    for (const f of it.flags || []) f.text = scrubText(f.text).replace(EMAIL, "[email removed]");
  }
  return record;
}
// A hold that's only about a resident's name or address isn't needed: the details are removed instead.
const PRIVACY_ONLY = /private (resident|citizen|individual|person)|resident'?s? (name|address)|home address|street address|personal (information|details)|names? (a|an|the) (resident|member of the public)|phone number|email address/i;
const NEEDS_PERSON = /disagree|conflict|minutes|video|unsure|unclear which|which official|attribut|accus|crime|criminal|wrongdoing|stole|fraud|abuse/i;
export const privacyOnlyHold = (reason) => PRIVACY_ONLY.test(reason || "") && !NEEDS_PERSON.test(reason || "");

// Holds come from Claude's holdReason (new drafts) or from a minutes check that found a conflict.
export function applyHolds(record) {
  scrubRecord(record);
  for (const it of record?.items || []) {
    if (it.holdReason && privacyOnlyHold(it.holdReason)) { it.privacyNote = it.holdReason; delete it.holdReason; }
    if (it.holdReason && !it.hold && !it.released) it.hold = { reason: it.holdReason, at: new Date().toISOString() };
  }
  return record;
}

export const recordOf = (m) => (m.status === "approved" ? m.record : ["drafted"].includes(m.status) ? m.draft : null);
export const isPublic = (m) => !!recordOf(m) && !m.unpublished;

// Apply a minutes check (from the API or imported from a chat session) to a meeting's draft.
export function applyChecks(m, out, by = "claude") {
  const rec = m.status === "approved" ? m.record : m.draft;
  if (!rec) throw new Error(`${m.id} has no draft to check`);
  let matched = 0, conflicts = 0;
  for (const c of out.checks || []) {
    const it = rec.items?.[c.idx];
    if (!it) continue;
    if (c.status === "matches") { it.verified = "minutes"; matched++; if (it.confidence === "medium") it.confidence = "high"; }
    else if (c.status === "conflict") {
      conflicts++;
      it.minutesFix = { ...(c.fix || {}), minutesSay: c.minutesSay || "" };
      if (m.status !== "approved") it.hold = { reason: `Minutes disagree: ${c.minutesSay || "see suggested fix"}`, at: new Date().toISOString(), fromMinutes: true };
      delete it.released;
    } else it.notInMinutes = true;
  }
  if (out.attendance?.present?.length) { rec.attendance = { ...out.attendance, source: rec.attendance?.source === "video" ? "minutes and video" : "minutes" }; }
  if (out.missingItems?.length) rec.missingFromDraft = out.missingItems;
  m.minutesCheck = { at: new Date().toISOString(), by, matched, conflicts, missing: out.missingItems?.length || 0 };
  if (m.draftMeta) m.draftMeta.hadMinutes = true;
  delete m.minutesArrivedAfterDraft;
  return m;
}

// Use the minutes' version of a held item.
export function useMinutesFix(it) {
  const f = it.minutesFix || {};
  it.vote = it.vote || {};
  for (const k of ["result", "method", "yes", "no", "abstain"]) if (f[k] !== undefined) it.vote[k] = f[k];
  for (const k of ["amount", "motionBy", "secondBy", "stage"]) if (f[k] !== undefined) it[k] = f[k];
  if (f.minutesSay) it.vote.note = `Corrected to match the official minutes: ${f.minutesSay.replace(/\.$/, "")}.`;
  if (f.result === "failed" && it.nextStep) it.nextStep = null; // a failed item has no next reading
  it.verified = "minutes"; delete it.hold; delete it.minutesFix; it.released = true;
  return it;
}

// Public shape of one meeting: internal fields removed, held/hidden items left out.
export function publicMeeting(m, { full = true } = {}) {
  const rec = recordOf(m);
  const items = [];
  let held = 0;
  (rec?.items || []).forEach((it, idx) => {
    const label = itemLabel(m, it);
    if (label === "hidden") return;
    if (label === "held") { held++; return; }
    const base = { idx, label, title: it.title, category: it.category, stage: it.stage, amount: it.amount ?? null, docNumber: it.docNumber || "", issue: it.issue?.key ? { key: it.issue.key, title: it.issue.title || "" } : null, result: it.vote?.result || "" };
    if (!full) return items.push(base);
    items.push({
      ...base, officialTitle: it.officialTitle || "", whatItIs: it.whatItIs || "", whyItMatters: it.whyItMatters || "",
      vote: it.vote ? { method: it.vote.method, result: it.vote.result, yes: it.vote.yes || [], no: it.vote.no || [], abstain: it.vote.abstain || [], note: it.vote.note || "" } : null,
      motionBy: it.motionBy || "", secondBy: it.secondBy || "", videoSeconds: it.videoSeconds ?? null,
      quotes: it.quotes || [], notes: it.notes || [], nextStep: it.nextStep || null, terms: it.terms || [],
      parties: it.parties || [], recipient: it.recipient || "", fundingSource: it.fundingSource || "", fund: it.fund || "",
      uncertain: label === "unclear" ? (it.checkNote || "Some details of this item were hard to confirm from the sources.") : "",
    });
  });
  const b = BODIES[m.body];
  return {
    id: m.id, body: m.body, bodyName: b?.name, gov: b?.gov, date: m.date, summary: rec?.summary || "", archive: !!m.archive, sources: { minutes: !!m.draftMeta?.hadMinutes, video: !!m.draftMeta?.hadVideo, packet: !!m.draftMeta?.hadPacket },
    attendance: full ? rec?.attendance || null : undefined, items, held,
    videoId: m.videoId || null, moreVideoIds: m.moreVideoIds || [], packetUrl: m.packetUrl || null, minutesUrl: m.minutesUrl || null,
    minutesKind: b?.docs === "city" ? "separate" : b?.docs ? "next-packet" : "none",
    hasMinutesCheck: !!(m.minutesCheck || m.draftMeta?.hadMinutes || m.status === "approved"),
    references: m.references || [], newTerms: full ? rec?.newTerms || [] : undefined,
  };
}
