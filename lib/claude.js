// Drafting a meeting record with Claude. Environment: ANTHROPIC_API_KEY, MODEL (optional)
import { PRIMER, BODIES, GLOSSARY } from "./county.js";

const STAGES = ["introduced", "read", "public hearing", "adopted", "approved", "denied", "failed", "tabled", "continued", "discussed", "requested", "received", "withdrawn", "recommended favorably", "recommended unfavorably", "sent without recommendation"];
const CATEGORIES = ["spending", "transfer", "salaries", "taxes", "budget", "ordinance", "resolution", "contract", "purchase", "land use", "tax abatement", "appointment", "claims", "minutes", "report", "public comment", "board member business", "other"];

const SCHEMA = {
  type: "object",
  required: ["summary", "attendance", "items"],
  properties: {
    summary: { type: "string", description: "3-5 plain sentences: what this meeting decided and why it matters to residents. Lead with the most consequential decision. No filler like 'The meeting began with the pledge'." },
    attendance: {
      type: "object",
      properties: {
        present: { type: "array", items: { type: "string" }, description: "Board members present (last name is fine if that's all the source gives)." },
        absent: { type: "array", items: { type: "string" } },
        source: { type: "string", enum: ["minutes", "video", "minutes and video", "unknown"] },
      },
    },
    items: {
      type: "array",
      description: "Every item the board acted on or discussed in substance, in meeting order. Skip pledge, prayer and pure ceremony (recognitions, thank-yous). Put salary claims, payroll and operating claims together in ONE claims item: list each motion and vote in vote.note, and use the operating-claims total as amount (payroll and salary are the same money listed twice; mention them in whatItIs).",
      items: {
        type: "object",
        required: ["title", "whatItIs", "category", "stage", "vote", "confidence"],
        properties: {
          title: { type: "string", description: "Short plain title that says what it is, e.g. 'One-year pause on new data centers' or '$200,000 more for stormwater projects'. Not the bureaucratic name." },
          officialTitle: { type: "string", description: "The name as it appears on the agenda or minutes." },
          docNumber: { type: "string", description: "Ordinance/resolution number like 2026-HCCO-36, or empty." },
          category: { type: "string", enum: CATEGORIES },
          whatItIs: { type: "string", description: "1-3 plain sentences a resident with no government background understands. Explain jargon inline." },
          whyItMatters: { type: "string", description: "Optional, 1-2 neutral sentences on the real-world effect (money, services, land, taxes). Empty if routine." },
          stage: { type: "string", enum: STAGES, description: "What happened to it at THIS meeting. continued = the board put off a decision to a later meeting or asked for more information first; discussed = talked about with no decision expected; requested = someone (resident, member, staff) asked for something with no action yet; read = presented but not yet adopted." },
          amount: { type: ["number", "null"], description: "Total dollars approved, or requested if not decided. Null if no money is involved, the cost wasn't stated, or the figure is unreadable (explain in checkNote)." },
          motionBy: { type: "string" },
          secondBy: { type: "string" },
          vote: {
            type: "object",
            required: ["method", "result"],
            properties: {
              method: { type: "string", enum: ["roll call", "voice", "consensus", "none", "unclear"] },
              result: { type: "string", enum: ["passed", "failed", "tabled", "no vote", "unclear"] },
              yes: { type: "array", items: { type: "string" }, description: "ONLY names you can confirm voted yes (roll call, or the source says so). Never fill this in for a voice vote." },
              no: { type: "array", items: { type: "string" }, description: "Names heard or recorded voting no." },
              abstain: { type: "array", items: { type: "string" } },
              note: { type: "string", description: "e.g. 'Voice vote; no one was heard voting no.' or 'Minutes say the motion carried; video audio unclear.'" },
            },
          },
          videoSeconds: { type: ["integer", "null"], description: "Seconds from the start of the video (the transcript [h:mm:ss] timestamps) where this item starts. Use the chunk where it begins." },
          quotes: {
            type: "array", maxItems: 3,
            description: "Up to 3 notable things said about this item, copied from the transcript. Fix obvious caption typos; use [brackets] to clarify a word. speaker: name and role if clear, else \"a commissioner\", \"a resident\", etc. Never guess a name.",
            items: { type: "object", required: ["text", "seconds"], properties: { speaker: { type: "string" }, text: { type: "string" }, seconds: { type: "integer" } } },
          },
          issue: {
            type: ["object", "null"],
            description: "The ongoing issue this item belongs to, so it can be followed across meetings. Reuse an existing key from the list when it's the same matter (same ordinance number, same property, same project). Otherwise make a new short key. Null for minutes, claims, routine reports and anything that isn't an ongoing matter.",
            properties: { key: { type: "string", description: "lowercase-hyphenated, e.g. data-center-moratorium or 2026-budget" }, title: { type: "string" }, isNew: { type: "boolean" } },
          },
          nextStep: {
            type: ["object", "null"],
            description: "What happens next and when the public can weigh in, ONLY if the sources say so or it follows directly from the process (e.g. a Plan Commission recommendation goes to the Commissioners). Null if finished or unknown.",
            properties: { text: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD or empty" }, publicCanSpeak: { type: "boolean", description: "True only if a public hearing or comment on this item is scheduled or required. Leave out if unknown." } },
          },
          terms: { type: "array", items: { type: "string" }, description: "Glossary terms used in this item (from the provided list, exact spelling)." },
          notes: { type: "array", items: { type: "string" }, description: "Short factual observations an organizer would want: a split vote, a member raising concerns, a request cut or denied, a public commenter, an item delayed again, a large or unusual amount. Facts only, no opinions." },
          sources: { type: "array", items: { type: "string", enum: ["minutes", "agenda", "document", "video"] } },
          confidence: { type: "string", enum: ["high", "medium", "low"], description: "How sure you are of the outcome, the vote and the amount. high = minutes and video agree; medium = one source only, or small gaps; low = sources conflict or audio unclear." },
          checkNote: { type: "string", description: "Anything uncertain, in one plain sentence a resident could read (e.g. 'The vote count was hard to hear on the recording.'). Shown publicly on low-confidence items. Empty if none." },
          holdReason: { type: "string", description: "Fill ONLY if this item must be checked by a person before it is public: (a) the minutes and the video disagree about the outcome, who voted how, or the dollar amount; (b) the item names a private resident or describes wrongdoing by a named person; (c) you are unsure WHICH official said or did something you attribute to them. One sentence. Empty otherwise (most items)." },
          parties: {
            type: "array", description: "Businesses, developers, organizations, attorneys, contractors and consultants involved (the petitioner, the company getting a contract/abatement/loan, its attorney or engineer). Never private residents. Empty if none.",
            items: { type: "object", required: ["name", "role"], properties: { name: { type: "string", description: "As written in the documents, e.g. 'St. Joan Development LLC'." }, role: { type: "string", enum: ["developer", "business", "property owner", "attorney", "engineer or consultant", "contractor or vendor", "nonprofit", "government agency", "other"] } } },
          },
          recipient: { type: "string", description: "Who receives the money, contract, abatement or benefit (a company, developer or city/county department). Empty if none." },
          fundingSource: { type: "string", description: "Where the money comes from if stated, e.g. 'General Fund', 'TIF (Consolidated TIF fund)', 'ARP', 'state grant', 'bond'. Empty if not stated." },
          flags: {
            type: "array", description: "Internal research notes, facts only: an official's statement that conflicts with the documents (quote it with the timestamp), a member changing position from an earlier vote, a process shortcut (rules suspended, item added late, no public hearing), an item delayed again. Empty if none.",
            items: { type: "object", required: ["kind", "text"], properties: { kind: { type: "string", enum: ["statement vs documents", "changed position", "process", "delay", "other"] }, text: { type: "string" }, seconds: { type: ["integer", "null"] } } },
          },
        },
      },
    },
    newTerms: {
      type: "array", description: "Jargon used in this meeting that is NOT in the provided glossary, with a plain one-sentence meaning.",
      items: { type: "object", properties: { term: { type: "string" }, plain: { type: "string" } } },
    },
  },
};

const SYSTEM = `You draft the public record of a local government meeting in Howard County, Indiana (Howard County government or the City of Kokomo) for a website that helps residents, community groups and organizers understand what their local government did. Items are published automatically with a label (confirmed by minutes, from video, or unclear); only items you put on hold (holdReason) are checked by a person first, so be accurate and conservative.

Rules:
- Facts only from the sources provided. Never guess. If something is unclear, say so in checkNote and lower confidence.
- Plain language a busy resident understands. Short sentences. Explain jargon the first time.
- Neutral: describe what happened and its effect. No opinions, no praise, no criticism.
- Votes: Indiana minutes usually just say "the motion carried" and boards usually vote by voice. Do not list names as voting yes unless there was a roll call or the source records each vote. Record anyone heard or recorded voting no, abstaining or absent. Say plainly in vote.note how the vote was taken.
- Official minutes outrank the video for outcomes, motions and attendance; the video adds what was said, timing, and dissent the minutes left out. Note disagreements in checkNote.
- An agenda packet also contains the minutes of the PREVIOUS meeting. Never treat those as this meeting.
- Captions are auto-generated and misspell names and places. Use the roster for board members; the minutes for staff names; and correct Howard County places you're sure of (Kokomo, Russiaville, Greentown, Jerome, Center/Clay/Ervin/Harrison/Honey Creek/Howard/Jackson/Liberty/Monroe/Taylor/Union Township). If unsure, keep the caption spelling and flag it.
- Members of the public: name people who are public officials, county staff, candidates who say so, or who speak for a business or organization. Describe other residents without names or home addresses ("a resident of 750 East").
- If the transcript has more than one PART, only Part 1 timestamps match the main video: for items in later parts set videoSeconds to null and say "Part 2 at h:mm:ss" in checkNote.
- When the minutes describe an item but don't record a vote, use the video for the vote and say so in vote.note.
- The next meeting's packet can also be used for what's coming next (its agenda), but never for what happened at this meeting except its minutes.
- The items list is the record. It must never be empty when the board acted on anything: every decision, vote, approval or request your summary mentions must appear as its own item, and the summary must not describe anything the items leave out. A transcript alone is enough to write items (sources: ["video"], confidence medium or low as warranted).
- Always respond by calling the record_meeting tool.
${PRIMER}`;

export async function draftMeeting({ meeting, packetB64, minutesB64, minutesDate, minutesSeparate, transcriptText, roster, issues, refText, retryNote, jsonMode = false }) {
  const body = BODIES[meeting.body];
  const content = [];
  content.push({ type: "text", text:
`MEETING: ${body.name}, ${meeting.date}${meeting.title ? ` ("${meeting.title}")` : ""}
What this body does: ${body.role}
Board members (correct spellings): ${(roster[meeting.body] || []).map((r) => r.name + (r.title ? ` (${r.title})` : "")).join(", ") || "not listed; use names as given in the sources"}

Existing issues you can link to (key: title):
${issues.length ? issues.map((i) => `- ${i.key}: ${i.title}`).join("\n") : "(none yet)"}

Glossary terms available: ${Object.keys(GLOSSARY).join(", ")}
${refText ? `\nREFERENCE (already-adopted documents; use to put amounts in context, e.g. how big an appropriation is relative to its fund's budget):\n${refText}\n` : ""}

Sources follow: ${[packetB64 && "this meeting's agenda packet (PDF)", minutesB64 && (minutesSeparate ? `the OFFICIAL MINUTES of this ${meeting.date} meeting (PDF)` : `the next meeting's packet, which contains the OFFICIAL MINUTES of this ${meeting.date} meeting (PDF; dated ${minutesDate})`), transcriptText && "the meeting video transcript (auto-captions, [h:mm:ss] timestamps)"].filter(Boolean).join("; ")}.
${!minutesB64 ? "Official minutes are not available yet; base outcomes on the video and say so." : ""}` });
  if (packetB64) {
    content.push({ type: "text", text: `THIS MEETING'S AGENDA PACKET (${meeting.date}). Ignore the minutes inside it from an earlier meeting:` });
    content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: packetB64 } });
  }
  if (minutesB64) {
    content.push({ type: "text", text: minutesSeparate
      ? `OFFICIAL MINUTES OF THIS ${meeting.date} MEETING${meeting.minutesName && /draft/i.test(meeting.minutesName) ? " (marked DRAFT; not yet approved by the board)" : ""}:`
      : `PACKET FOR THE ${minutesDate} MEETING. Use ONLY the minutes in it headed with ${meeting.date}; ignore its agenda and documents:` });
    content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: minutesB64 } });
  }
  if (transcriptText) content.push({ type: "text", text: `VIDEO TRANSCRIPT:\n${transcriptText}` });
  content.push({ type: "text", text: `${retryNote ? retryNote + "\n\n" : ""}${jsonMode ? "Now reply with the complete record as one JSON object." : "Now call record_meeting with the complete record."}` });
  return callClaude(SYSTEM, content, undefined, { jsonMode });
}

// Pull the first complete JSON object out of a text reply (code fences and prose around it are ignored).
function extractJSON(text) {
  const start = text.indexOf("{"); if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === "{") depth++; else if (ch === "}") { depth--; if (depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch (e) { return null; } } }
  }
  return null;
}
// Does a tool reply look mangled? (The model sometimes writes its tool-call XML as literal text inside the JSON.)
export const looksMangled = (rec) => JSON.stringify(rec || {}).includes("<parameter") || Object.values(rec || {}).some((v) => typeof v === "string" && /^\s*<\w/.test(v));

async function callClaude(system, content, tool = { name: "record_meeting", description: "Save the structured meeting record. Call exactly once with the complete record.", input_schema: SCHEMA }, { jsonMode = false } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY isn't set in Vercel.");
  const messages = [{ role: "user", content }];
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.MODEL || "claude-sonnet-5-5",
        max_tokens: 32000,
        system: jsonMode ? `${system}\n\nOUTPUT FORMAT: do not call any tool. Reply with ONLY one JSON object (no prose, no code fence) that matches this JSON schema exactly:\n${JSON.stringify(tool.input_schema)}` : system,
        ...(jsonMode ? {} : { tools: [tool], tool_choice: { type: "auto" } }), // newer models reject forced tool choice; the prompt and a retry make sure the tool is called
        messages,
      }),
    });
    if (!res.ok) {
      let detail = ""; try { detail = (await res.json()).error?.message || ""; } catch (e) {}
      if (res.status === 401) throw new Error("The Claude key isn't being accepted. Check ANTHROPIC_API_KEY in Vercel and redeploy.");
      if (res.status === 429 || res.status === 529) throw new Error("Claude is busy right now. Try again in a minute.");
      throw new Error(`Claude couldn't run (${res.status}${detail ? ": " + detail.slice(0, 200) : ""}).`);
    }
    const data = await res.json();
    const textOut = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    if (jsonMode) {
      const obj = extractJSON(textOut);
      if (obj) return { ...obj, _usage: data.usage, _model: data.model, _truncated: data.stop_reason === "max_tokens", _toolUses: 0, _stop: data.stop_reason, _mode: "json", _text: textOut.slice(0, 2000), _rawInput: JSON.stringify(obj).slice(0, 3000) };
      messages.push({ role: "assistant", content: data.content }, { role: "user", content: [{ type: "text", text: "That wasn't a JSON object. Reply with only the JSON object." }] });
      continue;
    }
    // Take the most complete tool call: on long inputs a model can emit a stub call and then the real one.
    const uses = (data.content || []).filter((b) => b.type === "tool_use");
    const use = uses.sort((a, b) => JSON.stringify(b.input || {}).length - JSON.stringify(a.input || {}).length)[0];
    if (use) return { ...use.input, _usage: data.usage, _model: data.model, _truncated: data.stop_reason === "max_tokens", _toolUses: uses.length, _stop: data.stop_reason, _text: (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").slice(0, 2000), _rawInput: JSON.stringify(use.input).slice(0, 3000) };
    messages.push({ role: "assistant", content: data.content }, { role: "user", content: [{ type: "text", text: `Please call ${tool.name} now.` }] });
  }
  throw new Error("Claude didn't return a record. Try again.");
}



// ---- Checking a draft against official minutes that arrived later (much cheaper than redrafting)
export const VERIFY_SCHEMA = {
  type: "object", required: ["checks"],
  properties: {
    attendance: { type: "object", properties: { present: { type: "array", items: { type: "string" } }, absent: { type: "array", items: { type: "string" } } }, description: "Attendance as the minutes record it." },
    checks: {
      type: "array", description: "One entry per draft item, by idx.",
      items: {
        type: "object", required: ["idx", "status"],
        properties: {
          idx: { type: "integer" },
          status: { type: "string", enum: ["matches", "conflict", "not in minutes"], description: "matches = the minutes agree on the outcome, the vote and the amount (minutes that just say 'carried' agree with a passed voice vote). conflict = they disagree on outcome, who voted how, motion/second, or amount." },
          minutesSay: { type: "string", description: "For a conflict: what the minutes say, briefly." },
          fix: { type: "object", description: "For a conflict: the corrected fields per the minutes (only those that differ).", properties: { result: { type: "string", enum: ["passed", "failed", "tabled", "no vote", "unclear"] }, method: { type: "string" }, yes: { type: "array", items: { type: "string" } }, no: { type: "array", items: { type: "string" } }, abstain: { type: "array", items: { type: "string" } }, amount: { type: ["number", "null"] }, motionBy: { type: "string" }, secondBy: { type: "string" }, stage: { type: "string" } } },
        },
      },
    },
    missingItems: { type: "array", items: { type: "string" }, description: "Actions in the minutes that the draft left out, one line each." },
  },
};

export async function verifyWithMinutes({ meeting, record, minutesB64, minutesDate, minutesSeparate }) {
  const items = (record.items || []).map((it, idx) => ({ idx, title: it.title, officialTitle: it.officialTitle, docNumber: it.docNumber, stage: it.stage, amount: it.amount, motionBy: it.motionBy, secondBy: it.secondBy, vote: it.vote }));
  const content = [
    { type: "text", text: `Here is a draft record of the ${BODIES[meeting.body].name} meeting on ${meeting.date}, written from the video before the official minutes were available, and the official minutes. Compare each draft item with the minutes.\n\nDRAFT ITEMS:\n${JSON.stringify(items)}\n\nDraft attendance: ${JSON.stringify(record.attendance || {})}` },
    { type: "text", text: minutesSeparate ? `OFFICIAL MINUTES OF THE ${meeting.date} MEETING:` : `PACKET FOR THE ${minutesDate} MEETING. Use ONLY the minutes in it headed with ${meeting.date}:` },
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: minutesB64 } },
    { type: "text", text: "Call check_against_minutes. Indiana minutes often just say 'motion carried': that matches a passed voice vote. Only call it a conflict when the minutes clearly say something different." },
  ];
  return callClaude("You check meeting records against official minutes. Be precise and literal. Always respond by calling the check_against_minutes tool.", content,
    { name: "check_against_minutes", description: "Report how each draft item compares with the official minutes.", input_schema: VERIFY_SCHEMA });
}

// ---- Previewing an upcoming meeting from its agenda packet ("Coming up")
export const PREVIEW_SCHEMA = {
  type: "object", required: ["summary", "items"],
  properties: {
    time: { type: "string", description: "Start time as printed, e.g. '6:00 p.m.' Empty if not in the packet." },
    location: { type: "string", description: "Room and address as printed. Empty if not in the packet." },
    howToComment: { type: "string", description: "How a resident can speak or send comments, ONLY from the packet (public comment period, hearing, sign-up, email). Empty if not stated." },
    summary: { type: "string", description: "2-3 plain sentences: the most consequential things on this agenda for residents." },
    items: {
      type: "array", description: "Agenda items worth knowing about, in agenda order. Skip pledge, prayer, routine approval of minutes and recognitions. Group routine claims into one item.",
      items: {
        type: "object", required: ["title", "whatItIs", "category"],
        properties: {
          title: { type: "string", description: "Short plain title that says what it is." },
          officialTitle: { type: "string" }, docNumber: { type: "string" },
          category: { type: "string", enum: CATEGORIES },
          whatItIs: { type: "string", description: "1-3 plain sentences." },
          whyItMatters: { type: "string", description: "1-2 neutral sentences on the effect, or empty." },
          step: { type: "string", description: "Where it is in the process at this meeting, e.g. 'First reading (no final vote yet)', 'Final vote', 'Public hearing, then a vote', 'Recommendation to the Common Council'." },
          publicHearing: { type: "boolean", description: "True if a public hearing on this item is scheduled at this meeting." },
          speak: { type: "string", enum: ["right", "custom", "none"], description: "Whether the public can speak on this item at THIS meeting: 'right' when the law requires a public hearing here (Plan Commission rezoning or plat hearing, BZA variance or special exception, additional appropriation, budget hearing, tax-abatement confirming resolution) or the agenda lists a public hearing; 'custom' when the board usually allows comment but needn't (ordinary ordinances at the Common Council, the Commissioners' public-comment period); 'none' for Board of Works items, bid openings, claims, and anything that is only a report." },
          amount: { type: ["number", "null"] },
          recipient: { type: "string" }, fundingSource: { type: "string" },
          parties: { type: "array", items: { type: "object", properties: { name: { type: "string" }, role: { type: "string" } } } },
          location: { type: "string", description: "Street address or area for land-use items, else empty." },
          issue: { type: ["object", "null"], properties: { key: { type: "string" }, title: { type: "string" }, isNew: { type: "boolean" } } },
          page: { type: ["integer", "null"], description: "PDF page where this item's documents start." },
        },
      },
    },
  },
};

export async function previewAgenda({ meeting, packetB64, issues }) {
  const body = BODIES[meeting.body];
  const content = [
    { type: "text", text: `UPCOMING MEETING: ${body.name}, ${meeting.date}\nWhat this body does: ${body.role}\n\nExisting issues you can link to (key: title):\n${issues.length ? issues.map((i) => `- ${i.key}: ${i.title}`).join("\n") : "(none yet)"}\n\nThis is the agenda packet. It may also contain minutes of an EARLIER meeting: ignore those.` },
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: packetB64 } },
    { type: "text", text: "Call preview_agenda with what residents should know before this meeting." },
  ];
  return callClaude(`You preview upcoming local government meetings in Howard County, Indiana for residents and organizers who want to know what's coming and how to show up. Plain language, neutral, facts only from the packet. Never name private residents. Always respond by calling the preview_agenda tool.\n${PRIMER}`, content,
    { name: "preview_agenda", description: "Save the preview of the upcoming meeting.", input_schema: PREVIEW_SCHEMA });
}

// ---- Filling in the newer fields on drafts made before they existed (text only, no PDFs: cheap)
const ENRICH_SCHEMA = {
  type: "object", required: ["items"],
  properties: { items: { type: "array", description: "One entry per draft item that has anything to add, by idx. Skip items with nothing to add.", items: {
    type: "object", required: ["idx"],
    properties: {
      idx: { type: "integer" },
      parties: SCHEMA.properties.items.items.properties.parties,
      recipient: SCHEMA.properties.items.items.properties.recipient,
      fundingSource: SCHEMA.properties.items.items.properties.fundingSource,
      flags: SCHEMA.properties.items.items.properties.flags,
      holdReason: { type: "string", description: "ONLY if the item names a private resident (not an official, staff member, business or organization rep) or states that a named person did something wrong. One sentence. Otherwise leave empty." },
    } } } },
};
export async function enrichRecord({ meeting, record }) {
  const items = (record.items || []).map((it, idx) => ({ idx, title: it.title, officialTitle: it.officialTitle, docNumber: it.docNumber, category: it.category, stage: it.stage, amount: it.amount, whatItIs: it.whatItIs, whyItMatters: it.whyItMatters, motionBy: it.motionBy, secondBy: it.secondBy, vote: it.vote, notes: it.notes, quotes: it.quotes, checkNote: it.checkNote, videoSeconds: it.videoSeconds }));
  const content = [{ type: "text", text: `This is a finished record of the ${BODIES[meeting.body].name} meeting on ${meeting.date}. For each item, fill in ONLY what the record itself states: the businesses/developers/organizations involved (never private residents), who receives the money or benefit, where the money comes from, and internal research flags (facts only: a quoted statement that conflicts with what the item says the documents show, a process shortcut like rules suspended or an item added late, an item delayed again, a member changing position). Don't invent anything that isn't in the text. Skip items with nothing to add.\n\nSUMMARY: ${record.summary || ""}\n\nITEMS:\n${JSON.stringify(items)}` }];
  return callClaude("You extract structured facts from local government meeting records. Literal and conservative. Always respond by calling the enrich_items tool.", content,
    { name: "enrich_items", description: "Save the added fields for each item.", input_schema: ENRICH_SCHEMA });
}

// Dollar cost of one call, for showing what a run spent (Sonnet 5.5: $2 in / $10 out per million tokens; override with MODEL_PRICE="in,out")
export function callCents(usage = {}) {
  const [inP, outP] = (process.env.MODEL_PRICE || "2,10").split(",").map(Number);
  return ((usage.input_tokens || 0) * inP + (usage.cache_creation_input_tokens || 0) * inP * 1.25 + (usage.cache_read_input_tokens || 0) * inP * 0.1 + (usage.output_tokens || 0) * outP) / 1e4;
}

export { SCHEMA, SYSTEM };


// ---- The dateline: one short written paragraph for the top of the home page, once a day (a few cents).
export const DATELINE_SCHEMA = {
  type: "object", required: ["segments"],
  properties: {
    segments: { type: "array", description: "The paragraph in order, split so that linked phrases are their own segments. 2 to 4 segments carry a link.", items: { type: "object", required: ["text"], properties: { text: { type: "string" }, link: { type: "string", description: "Route for this phrase: #/m/<meeting id> or #/i/<issue key>. Omit for plain text." } } } },
  },
};
export async function writeDateline({ today, weekday, upcoming, recent, issues }) {
  const system = `You write the opening paragraph for Second Reading, a site that records every meeting and vote of Howard County and Kokomo, Indiana government. The paragraph sits under today's date. It is 2 or 3 sentences, under 75 words, in the voice of a careful local reporter: plain, specific, a little dry, never promotional. Never say welcome, never describe the site, never use exclamation points.
Order: what's soonest (a meeting today or tomorrow, with its biggest item and dollar figure), then the most consequential recent decision (what, which board, the vote), then one thing coming up or still moving. Skip any of these that has nothing worth saying. Use the data exactly; invent nothing. Day words are relative to today, ${weekday} ${today}: "tonight", "tomorrow", "Monday", "last Tuesday". Name boards the way people say them: County Council, the Commissioners, Kokomo City Council, the Plan Commission, the zoning board (BZA).
Link the phrase that names each meeting or issue (2 to 4 links), using the ids given. Plain segments carry the connecting words. Do not link whole sentences.`;
  const content = [{ type: "text", text: JSON.stringify({ today, upcoming, recent, issues }, null, 1) }];
  const out = await callClaude(system, content, { name: "write_dateline", description: "Save the paragraph as ordered segments.", input_schema: DATELINE_SCHEMA });
  const segments = (out.segments || []).map((s) => ({ text: String(s.text || ""), link: /^#\/(m|i)\/[\w-]+$/.test(String(s.link || "")) ? s.link : "" })).filter((s) => s.text);
  if (!segments.length) throw new Error("Empty dateline");
  return { segments, usage: out._usage, model: out._model };
}
