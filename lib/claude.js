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
          checkNote: { type: "string", description: "Anything the reviewer should double-check (unclear audio, minutes and video disagree, a name you weren't sure of). Empty if none." },
        },
      },
    },
    newTerms: {
      type: "array", description: "Jargon used in this meeting that is NOT in the provided glossary, with a plain one-sentence meaning.",
      items: { type: "object", properties: { term: { type: "string" }, plain: { type: "string" } } },
    },
  },
};

const SYSTEM = `You draft the public record of a Howard County, Indiana government meeting for a website that helps residents, community groups and organizers understand what their local government did. A person reviews every draft before it is published.

Rules:
- Facts only from the sources provided. Never guess. If something is unclear, say so in checkNote and lower confidence.
- Plain language a busy resident understands. Short sentences. Explain jargon the first time.
- Neutral: describe what happened and its effect. No opinions, no praise, no criticism.
- Votes: Indiana minutes usually just say "the motion carried" and boards usually vote by voice. Do not list names as voting yes unless there was a roll call or the source records each vote. Record anyone heard or recorded voting no, abstaining or absent. Say plainly in vote.note how the vote was taken.
- Official minutes outrank the video for outcomes, motions and attendance; the video adds what was said, timing, and dissent the minutes left out. Note disagreements in checkNote.
- An agenda packet also contains the minutes of the PREVIOUS meeting. Never treat those as this meeting.
- Captions are auto-generated and misspell names and places. Use the roster for board members; the minutes for staff names; and correct Howard County places you're sure of (Kokomo, Russiaville, Greentown, Jerome, Center/Clay/Ervin/Harrison/Honey Creek/Howard/Jackson/Liberty/Monroe/Taylor/Union Township). If unsure, keep the caption spelling and flag it.
- Members of the public: name people who are public officials, county staff, candidates who say so, or who speak for a business or organization. Describe other residents without names or home addresses ("a resident of 750 East").
- When the minutes describe an item but don't record a vote, use the video for the vote and say so in vote.note.
- The next meeting's packet can also be used for what's coming next (its agenda), but never for what happened at this meeting except its minutes.
- Always respond by calling the record_meeting tool.
${PRIMER}`;

export async function draftMeeting({ meeting, packetB64, minutesB64, minutesDate, transcriptText, roster, issues }) {
  const body = BODIES[meeting.body];
  const content = [];
  content.push({ type: "text", text:
`MEETING: ${body.name}, ${meeting.date}${meeting.title ? ` ("${meeting.title}")` : ""}
What this body does: ${body.role}
Board members (correct spellings): ${(roster[meeting.body] || []).map((r) => r.name + (r.title ? ` (${r.title})` : "")).join(", ") || "not listed; use names as given in the sources"}

Existing issues you can link to (key: title):
${issues.length ? issues.map((i) => `- ${i.key}: ${i.title}`).join("\n") : "(none yet)"}

Glossary terms available: ${Object.keys(GLOSSARY).join(", ")}

Sources follow: ${[packetB64 && "this meeting's agenda packet (PDF)", minutesB64 && `the next meeting's packet, which contains the OFFICIAL MINUTES of this ${meeting.date} meeting (PDF; dated ${minutesDate})`, transcriptText && "the meeting video transcript (auto-captions, [h:mm:ss] timestamps)"].filter(Boolean).join("; ")}.
${!minutesB64 ? "Official minutes are not available yet; base outcomes on the video and say so." : ""}` });
  if (packetB64) {
    content.push({ type: "text", text: `THIS MEETING'S AGENDA PACKET (${meeting.date}). Ignore the minutes inside it from an earlier meeting:` });
    content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: packetB64 } });
  }
  if (minutesB64) {
    content.push({ type: "text", text: `PACKET FOR THE ${minutesDate} MEETING. Use ONLY the minutes in it headed with ${meeting.date}; ignore its agenda and documents:` });
    content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: minutesB64 } });
  }
  if (transcriptText) content.push({ type: "text", text: `VIDEO TRANSCRIPT:\n${transcriptText}` });
  content.push({ type: "text", text: "Now call record_meeting with the complete record." });
  return callClaude(SYSTEM, content);
}

async function callClaude(system, content) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY isn't set in Vercel.");
  const messages = [{ role: "user", content }];
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.MODEL || "claude-sonnet-5-5",
        max_tokens: 16000,
        system,
        tools: [{ name: "record_meeting", description: "Save the structured meeting record. Call exactly once with the complete record.", input_schema: SCHEMA }],
        tool_choice: { type: "tool", name: "record_meeting" },
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
    const tool = (data.content || []).find((b) => b.type === "tool_use");
    if (tool) return { ...tool.input, _usage: data.usage, _model: data.model, _truncated: data.stop_reason === "max_tokens" };
    messages.push({ role: "assistant", content: data.content }, { role: "user", content: [{ type: "text", text: "Please call record_meeting now." }] });
  }
  throw new Error("Claude didn't return a record. Try again.");
}

export { SCHEMA, SYSTEM };
