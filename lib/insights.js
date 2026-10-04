// Internal research views: every quote, every flag, every dollar, every outside party. Includes held items (it's your side).
import { BODIES } from "./county.js";
import { listMeetings } from "./store.js";
import { normalizeRecord } from "./pipeline.js";
import { recordOf, itemLabel } from "./publish.js";

export async function insights() {
  const quotes = [], flags = [], money = [], parties = [];
  for (const m of await listMeetings()) {
    normalizeRecord(m.draft); normalizeRecord(m.record);
    const rec = recordOf(m);
    if (!rec) continue;
    const gov = BODIES[m.body]?.gov;
    rec.items.forEach((it, idx) => {
      const base = { meetingId: m.id, body: m.body, gov, date: m.date, idx, itemTitle: it.title, videoId: m.videoId || null, label: itemLabel(m, it), issue: it.issue?.key || "" };
      for (const q of it.quotes || []) if (q?.text) quotes.push({ ...base, speaker: q.speaker || "", text: q.text, seconds: q.seconds ?? null });
      for (const f of it.flags || []) if (f?.text) flags.push({ ...base, kind: f.kind || "other", text: f.text, seconds: f.seconds ?? it.videoSeconds ?? null });
      if (it.amount != null && it.amount !== 0 && it.category !== "claims" && it.category !== "minutes") money.push({ ...base, title: it.title, category: it.category, stage: it.stage, result: it.vote?.result || "", amount: it.amount, recipient: it.recipient || "", fundingSource: it.fundingSource || "", parties: it.parties || [], docNumber: it.docNumber || "" });
      for (const p of it.parties || []) if (p?.name) parties.push({ ...base, name: p.name, role: p.role || "", amount: it.amount ?? null, category: it.category, result: it.vote?.result || "", stage: it.stage });
    });
  }
  const by = (a, b) => b.date.localeCompare(a.date);
  return { quotes: quotes.sort(by), flags: flags.sort(by), money: money.sort(by), parties: parties.sort(by), bodies: BODIES };
}
