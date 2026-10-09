// Public site: a small hash-routed app over /api/public.
const view = document.getElementById("view");
const cache = new Map();
async function api(params) {
  const qs = new URLSearchParams(params).toString();
  if (cache.has(qs)) return cache.get(qs);
  const res = await fetch(`/api/public?${qs}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong"), { status: res.status });
  cache.set(qs, data);
  return data;
}

// ---- helpers
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => {
  if (n == null || isNaN(n)) return "";
  const a = Math.abs(n), sign = n < 0 ? "−" : "";
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace(/\.0$/, "")} million`;
  return `${sign}$${Math.round(a).toLocaleString("en-US")}`;
};
const compact = (n) => { if (n == null || isNaN(n)) return ""; const a = Math.abs(n); return a >= 1e6 ? `$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M` : a >= 1e3 ? `$${Math.round(a / 1e3)}K` : `$${Math.round(a)}`; };
const tshort = (t) => String(t || "").replace(/:00(?=\s*[ap])/i, "").replace(/\s+/, " ");
const exact = (n) => (n == null ? "" : `${n < 0 ? "−" : ""}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`);
const dt = (d, opts = { weekday: "short", month: "short", day: "numeric", year: "numeric" }) => new Date(d + "T12:00:00").toLocaleDateString("en-US", opts);
const dLong = (d) => dt(d, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const daysUntil = (d) => Math.round((new Date(d + "T12:00:00") - new Date(new Date().toDateString() + " 12:00")) / 864e5);
const relDay = (d) => { const n = daysUntil(d); return n === 0 ? "Today" : n === 1 ? "Tomorrow" : n > 1 && n < 7 ? `This ${dt(d, { weekday: "long" })}` : ""; };
const ts = (s) => { s = Math.max(0, s | 0); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(x).padStart(2, "0")}`; };
const yt = (id, s) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}${s != null ? `&t=${s | 0}s` : ""}`;
const title = (t) => (document.title = t ? `${t} · Second Reading` : "Second Reading · Every meeting. Every vote. Kokomo and Howard County.");
const list = (a) => (a.length <= 2 ? a.join(" and ") : `${a.slice(0, -1).join(", ")} and ${a.at(-1)}`);

const LABEL = {
  confirmed: ["confirmed", "Confirmed by the record"],
  video: ["", "From the meeting video"],
  unclear: ["unclear", "Not fully clear"],
};
function labelTag(label, m) {
  const [cls, text] = LABEL[label] || LABEL.video;
  const t = label !== "video" || !m || m.minutesKind === "none" ? text : m.minutesUrl ? "From the video · being checked against minutes" : "From the video · minutes not out yet";
  return `<span class="tag ${cls}">${t}</span>`;
}
const STAGE = { introduced: "Introduced", read: "First reading", "public hearing": "Public hearing", adopted: "Adopted", approved: "Approved", denied: "Denied", failed: "Failed", tabled: "Tabled", continued: "Put off to a later meeting", discussed: "Discussed", requested: "Requested", received: "Received", withdrawn: "Withdrawn", "recommended favorably": "Recommended for approval", "recommended unfavorably": "Recommended against", "sent without recommendation": "Sent on without a recommendation" };
const stageText = (s) => STAGE[s] || (s ? s[0].toUpperCase() + s.slice(1) : "");

function voteLine(v, it, m, label) {
  if (!v || v.method === "none" || v.result === "no vote") return label ? `<div class="vote"><span class="muted">No vote taken</span><span class="muted">${labelTag(label, m)}</span></div>` : "";
  const r = v.result === "passed" ? "passed" : v.result === "failed" ? "failed" : v.result === "tabled" ? "tabled" : "none";
  const word = { passed: "Passed", failed: "Failed", tabled: "Tabled", none: "Outcome unclear" }[r];
  const parts = [];
  const how = v.method === "roll call" ? "Roll call" : v.method === "voice" ? "Voice vote" : v.method === "consensus" ? "By consensus" : "";
  if (how) parts.push(how + (v.method === "voice" && !v.no?.length && !v.note ? ", no one heard voting no" : ""));
  if (v.method === "roll call" && v.yes?.length) parts.push(`Yes: ${esc(list(v.yes))}`);
  if (v.no?.length) parts.push(`No: ${esc(list(v.no))}`);
  if (v.abstain?.length) parts.push(`Abstained: ${esc(list(v.abstain))}`);
  if (it?.motionBy) parts.push(`Moved by ${esc(it.motionBy)}${it.secondBy ? `, seconded by ${esc(it.secondBy)}` : ""}`);
  return `<div class="vote ${r}"><span class="outcome ${r}"><span class="dot ${r}"></span>${word}</span>${parts.map((x) => `<span>${x}</span>`).join("")}${label ? labelTag(label, m) : ""}${v.note ? `<div class="muted small" style="flex-basis:100%">${esc(v.note)}</div>` : ""}</div>`;
}

const bcls = (body) => `b-${body}`;
const speakTag = (it) => it.publicHearing || it.speak === "right" ? ` <span class="tag hearing" title="The law requires a public hearing on this item: anyone can speak before the vote.">Public hearing · you can speak</span>` : it.speak === "custom" ? ` <span class="tag" title="The board usually takes comment on items like this, though the law doesn't require it.">Comment usually allowed</span>` : "";
const BOARD_SHORT = { council: "County Council", commissioners: "Commissioners", plan: "County Plan Commission", "city-council": "Kokomo Council", "city-plan": "Kokomo Plan Commission", "city-bza": "Kokomo Zoning Appeals", "city-works": "Kokomo Board of Works" };
const legend = () => `<div class="legend"><span class="b-council"><i class="swatch"></i>County Council</span><span class="b-commissioners"><i class="swatch"></i>Commissioners</span><span class="b-plan"><i class="swatch"></i>County Plan Commission</span><span class="b-city-council"><i class="swatch"></i>Kokomo Council</span><span class="b-city-works"><i class="swatch"></i>Other Kokomo boards</span></div>`;
const resultOf = (it) => (it.result === "passed" || ["adopted", "approved"].includes(it.stage)) && it.result !== "failed" ? "passed" : it.result === "failed" || it.stage === "denied" ? "failed" : it.result === "tabled" || it.stage === "continued" ? "tabled" : "none";
function setNav(name) {
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("on", a.dataset.nav === name));
  document.getElementById("nav").classList.remove("open");
  document.querySelector(".menu").setAttribute("aria-expanded", "false");
}
document.querySelector(".menu").addEventListener("click", (e) => {
  const n = document.getElementById("nav"); n.classList.toggle("open");
  e.currentTarget.setAttribute("aria-expanded", n.classList.contains("open"));
});

// ---- pages
const STATE_NOTE = {
  cancelled: "Canceled.",
  scheduled: "Agenda not posted yet. Boards usually post it a few days ahead.",
  agenda: "The agenda is posted. A plain-language summary is on its way.",
};
function stateTags(u) {
  return [u.cancelled ? `<span class="tag failed">Canceled</span>` : "", u.maybeCanceled ? `<span class="tag unclear">May be canceled</span>` : "", u.special ? `<span class="tag act">${esc(u.special)}</span>` : "", u.estimated ? `<span class="tag">Usual date, not confirmed</span>` : ""].filter(Boolean).join(" ");
}
function stateWord(u) {
  if (u.cancelled) return `<span class="tag failed">Canceled</span>`;
  if (u.maybeCanceled) return `<span class="tag unclear">May be canceled</span>`;
  if (u.special) return `<span class="tag act">${esc(u.special)}</span>`;
  if (u.state === "previewed") return "Agenda summary ready";
  if (u.state === "agenda") return "Agenda posted";
  if (u.estimated) return "Usual date, not confirmed";
  return "No agenda yet";
}

function leadFacts(u) {
  const items = u.items || [];
  if (!items.length) return [];
  const total = items.reduce((a, i) => a + (i.amount || 0), 0);
  const hearings = items.filter((i) => i.publicHearing).length;
  const facts = [{ value: String(items.length), label: items.length === 1 ? "item on the agenda" : "items on the agenda" }];
  if (total) facts.push({ value: money(total), label: "up for a decision" });
  if (hearings) facts.push({ value: String(hearings), label: hearings === 1 ? "public hearing" : "public hearings" });
  const land = items.filter((i) => i.category === "land use").length;
  if (land) facts.push({ value: String(land), label: land === 1 ? "rezoning or land item" : "rezoning or land items" });
  return facts.slice(0, 4);
}
function leadBlock(u) {
  const items = (u.items || []).slice(0, 4);
  const hearings = (u.items || []).some((i) => i.publicHearing);
  const title = u.special ? `${esc(u.special[0].toUpperCase() + u.special.slice(1))}` : u.summary ? `${esc(u.bodyName)} meets ${esc(dt(u.date, { weekday: "long" }))}` : `${esc(u.bodyName)} meets ${esc(dt(u.date, { weekday: "long" }))}`;
  return `<section class="lead ${bcls(u.body)}">
    <div class="main">
      <div class="meta" style="align-items:center;margin-bottom:8px"><span class="tag board">${esc(u.bodyName)}</span><span class="when" style="color:var(--ink)">${esc(dt(u.date, { weekday: "long", month: "short", day: "numeric" }))}${u.time ? ` · ${esc(u.time)}` : ""}</span>${u.location ? `<span>${esc(u.location)}</span>` : ""}</div>
      <h1>${title}</h1>
      ${u.summary ? `<p>${esc(u.summary)}</p>` : `<p class="muted">${STATE_NOTE[u.state] || ""}</p>`}
      ${items.length ? `<ul class="agenda">${items.map((i) => `<li><span class="t">${esc(i.title)}</span>${speakTag(i)}${i.amount ? ` <span class="muted">· ${money(i.amount)}</span>` : ""}</li>`).join("")}</ul>` : ""}
      ${hearings && u.howToComment ? `<div class="how"><b>How to weigh in:</b> ${esc(u.howToComment)}</div>` : ""}
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:14px"><a class="btn solid" href="#/m/${esc(u.id)}">${u.items?.length ? "What's on the agenda" : "Meeting details"}</a>${u.packetUrl ? `<a class="btn" href="${esc(u.packetUrl)}" target="_blank" rel="noopener">Agenda packet (PDF)</a>` : ""}</div>
    </div>
    ${u.facts?.length ? `<div class="facts">${u.facts.map((f) => `<div class="fact"><b>${esc(f.value)}</b><span>${esc(f.label)}</span></div>`).join("")}</div>` : ""}
  </section>`;
}

function upcomingCard(u) {
  return `<a class="card board ${bcls(u.body)} ${daysUntil(u.date) <= 1 ? "hot" : ""}" href="#/m/${esc(u.id)}">
    <div class="when">${esc(dt(u.date, { weekday: "short", month: "short", day: "numeric" }))}${u.time ? ` · ${esc(tshort(u.time))}` : ""}</div>
    <div class="who">${esc(u.bodyName)}</div>
    <div class="small muted" style="margin-top:4px">${stateWord(u)}</div>
  </a>`;
}

function decidedList(m, items) {
  return `<div class="list">${items.map((it) => { const r = resultOf(it); return `<a class="row" href="#/m/${esc(m.id)}#item-${it.idx}"><span class="mark ${r}"></span><span><b>${esc(it.title)}</b><div class="sub">${esc(stageText(it.stage))}${it.vote?.method && it.vote.method !== "none" ? ` · ${esc(it.vote.method)} vote` : ""}${it.issue ? ` · ${esc(it.issue.title || "")}` : ""}</div></span><span class="${it.amount ? "amt" : "sub"}">${it.amount ? money(it.amount) : esc(it.category === "land use" ? "Rezoning" : "")}</span></a>`; }).join("")}</div>`;
}

const issueCard = (i, bodies) => {
  const lastBody = i.bodies?.[i.bodies.length - 1] || "";
  const p = i.progress;
  if (p && p.total) {
    const states = p.states || [];
    const dots = states.map((st, k) => `<span class="s ${st}"></span>${k < states.length - 1 ? `<span class="l ${st === "done" && states[k + 1] === "done" ? "" : "next"}"></span>` : ""}`).join("");
    const line = p.status === "done" ? `Decided${i.lastDate ? ` · ${esc(stageText(i.latestStage) || "finished")} ${esc(dt(i.lastDate, { month: "short", day: "numeric" }))}` : ""}` : p.status === "failed" ? "Voted down" : p.status === "stalled" ? `Step ${Math.min(p.done + 1, p.total)} of ${p.total} · nothing since ${esc(dt(i.lastDate, { month: "short", day: "numeric" }))}` : `Step ${Math.min(p.done + 1, p.total)} of ${p.total}${p.next ? ` · Next: ${esc(p.next.title.toLowerCase())}${p.next.scheduled ? `, ${esc(dt(p.next.scheduled.date, { month: "short", day: "numeric" }))}` : ""}` : ""}`;
    return `<a class="card ${bcls(lastBody)} ${p.status}" href="#/i/${esc(i.key)}">
  <b style="font-size:1.05rem">${esc(i.title)}</b>
  <div class="small muted">${esc(i.kindLabel)}</div>
  <div class="steps">${dots}</div>
  <div class="small muted" style="margin-top:6px">${line}</div>
</a>`;
  }
  const steps = (i.bodies || []).length ? Math.min(i.count, 8) : 0;
  return `<a class="card ${bcls(lastBody)}" href="#/i/${esc(i.key)}">
  <b style="font-size:1.05rem">${esc(i.title)}</b>
  <div class="steps">${Array.from({ length: steps }, (_, k) => `<span class="s"></span>${k < steps - 1 ? `<span class="l"></span>` : ""}`).join("")}${i.nextStep?.text ? `<span class="l next"></span><span class="s next"></span>` : ""}</div>
  <div class="small muted" style="margin-top:6px">${i.count} step${i.count === 1 ? "" : "s"}${i.firstDate ? ` since ${esc(dt(i.firstDate, { month: "short", day: "numeric" }))}` : ""}${i.nextStep?.text ? ` · Next: ${esc(i.nextStep.text)}` : ""}</div>
</a>`;
};

function meetingRow(m) {
  const passed = m.items.filter((i) => i.result === "passed").length;
  const top = m.items.filter((i) => !["minutes", "claims", "public comment"].includes(i.category)).sort((a, b) => (b.amount || 0) - (a.amount || 0) || a.idx - b.idx).slice(0, 3).sort((a, b) => a.idx - b.idx);
  return `<a class="card board ${bcls(m.body)}" href="#/m/${esc(m.id)}">
    <div class="when">${esc(dt(m.date))}</div><div class="who">${esc(m.bodyName)}</div>
    ${top.length ? `<ul class="agenda">${top.map((i) => `<li><span class="dot ${resultOf(i)}"></span> ${esc(i.title)}${i.amount ? ` <span class="muted">· ${money(i.amount)}</span>` : ""}</li>`).join("")}</ul>` : `<p class="muted">${esc((m.summary || "").slice(0, 160))}</p>`}
    <div class="meta small" style="margin-top:6px"><span>${m.items.length} item${m.items.length === 1 ? "" : "s"}</span>${passed ? `<span>${passed} passed</span>` : ""}</div>
  </a>`;
}

async function pageHome() {
  setNav("home"); title("");
  const d = await api({ view: "home" });
  const up = d.upcoming.filter((u) => !u.cancelled);
  const lead = up.find((u) => u.special) || up.find((u) => u.state === "previewed") || up[0];
  if (lead) lead.facts = leadFacts(lead);
  const strip = d.upcoming.filter((u) => daysUntil(u.date) <= 14 && u.id !== lead?.id);
  const recent = d.recent.find((m) => m.items.length) || d.recent[0];
  const decided = recent ? recent.items.filter((i) => !["minutes", "claims", "report"].includes(i.category)).sort((a, b) => (b.amount || 0) - (a.amount || 0) || a.idx - b.idx).slice(0, 5) : [];
  view.innerHTML = `
    ${lead ? leadBlock(lead) : `<div class="card muted">Nothing scheduled in the next two weeks.</div>`}
    <div class="sechead"><h2>This week and next</h2><a href="#/calendar">Full calendar</a></div>
    ${strip.length ? `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(210px,1fr))">${strip.map(upcomingCard).join("")}</div>${legend()}` : `<p class="muted">Nothing else scheduled in the next two weeks.</p>`}
    ${d.ahead.length ? `<div class="sechead"><h2>Dates to watch</h2></div><div class="tablewrap"><table><tbody>${d.ahead.map((a) => `<tr><td style="white-space:nowrap"><b>${esc(dt(a.date, { weekday: "short", month: "short", day: "numeric" }))}</b></td><td><a href="#/i/${esc(a.key)}">${esc(a.title)}</a><div class="small muted">${esc(a.text)}</div></td><td>${a.publicCanSpeak ? `<span class="tag hearing">Public can speak</span>` : ""}</td></tr>`).join("")}</tbody></table></div>` : ""}
    <div class="two" style="margin-top:8px;gap:28px 32px;grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">
      <div>
        <div class="sechead"><h2>Latest decisions</h2><a href="#/meetings">All meetings</a>${recent ? `<span class="sub">${esc(recent.bodyName)}, ${esc(dt(recent.date, { month: "short", day: "numeric" }))} · ${recent.items.length} items, ${recent.items.filter((i) => i.result === "passed").length} passed</span>` : ""}</div>
        ${recent ? decidedList(recent, decided) + `<div class="legend"><span><i class="swatch" style="background:var(--pass)"></i>Passed</span><span><i class="swatch" style="background:var(--fail)"></i>Failed</span><span><i class="swatch" style="background:var(--gold)"></i>Tabled</span><span><i class="swatch" style="background:var(--none)"></i>No vote</span></div>` : `<p class="muted">Nothing yet.</p>`}
      </div>
      <div>
        <div class="sechead"><h2>Issues to follow</h2><a href="#/issues">All ${d.counts.issues}</a><span class="sub">One matter, every board, in order</span></div>
        <div style="display:flex;flex-direction:column;gap:10px">${d.issues.slice(0, 4).map((i) => issueCard(i, d.bodies)).join("")}</div>
      </div>
    </div>
    <div class="sechead"><h2>Earlier meetings</h2><a href="#/meetings">All ${d.counts.meetings}</a></div>
    <div class="grid">${d.recent.filter((m) => m !== recent).slice(0, 3).map(meetingRow).join("") || `<p class="muted">Nothing yet.</p>`}</div>
    <div id="alertsSlot" style="margin-top:28px"></div>`;
  mountAlerts(document.getElementById("alertsSlot"));
}
function pageAlerts() {
  setNav(""); title("Alerts");
  view.innerHTML = `<h1>Alerts</h1><p class="muted">Second Reading can send a notification to your phone: the day before a meeting when the agenda summary is ready, about an hour before it starts, and when the write-up is published. No account, no email. Once alerts are on, pick which ones you want.</p>
    <div id="alertsSlot"></div>`;
  mountAlerts(document.getElementById("alertsSlot"), { full: true });
}

// Month grid. #/calendar or #/calendar/2026-11
async function pageCalendar(ym) {
  setNav("calendar");
  const d = await api({ view: "calendar" });
  const today = d.today;
  const month = /^\d{4}-\d{2}$/.test(ym || "") ? ym : today.slice(0, 7);
  const [Y, M] = month.split("-").map(Number);
  const first = new Date(Y, M - 1, 1), last = new Date(Y, M, 0);
  const name = first.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  title(name);
  const prev = new Date(Y, M - 2, 1), next = new Date(Y, M, 1);
  const key = (dte) => `${dte.getFullYear()}-${String(dte.getMonth() + 1).padStart(2, "0")}`;
  const mname = (dte) => dte.toLocaleDateString("en-US", { month: "long" });
  const byDay = {};
  for (const m of d.meetings) (byDay[m.date] ||= []).push(m);
  const cells = [];
  for (let i = 0; i < first.getDay(); i++) cells.push(`<div class="day out"></div>`);
  for (let day = 1; day <= last.getDate(); day++) {
    const ds = `${month}-${String(day).padStart(2, "0")}`;
    const evs = (byDay[ds] || []).map((m) => `<a class="ev ${bcls(m.body)} ${m.special ? "special" : ""} ${m.estimated ? "est" : ""} ${m.cancelled ? "cancelled" : ""}" href="#/m/${esc(m.id)}" title="${esc(m.special || m.bodyName)}${m.time ? `, ${esc(m.time)}` : ""}">${esc(m.special ? m.special : BOARD_SHORT[m.body] || m.bodyName)}${m.time ? `<span class="t"> ${esc(tshort(m.time))}</span>` : ""}</a>`).join("");
    cells.push(`<div class="day ${ds === today ? "today" : ""} ${ds < today ? "past" : ""}"><span class="n">${day}</span>${evs}</div>`);
  }
  while (cells.length % 7) cells.push(`<div class="day out"></div>`);
  const coming = d.meetings.filter((m) => m.date >= today && !m.cancelled).slice(0, 6);
  view.innerHTML = `
    <div class="sechead" style="margin-top:0"><h1 style="margin:0">${esc(name)}</h1><div class="monthnav"><a class="btn" href="#/calendar/${key(prev)}">${esc(mname(prev))}</a><a class="btn" href="#/calendar/${key(next)}">${esc(mname(next))}</a>${month !== today.slice(0, 7) ? `<a class="btn" href="#/calendar">This month</a>` : ""}</div></div>
    ${legend()}
    <div class="month" style="margin-top:12px">
      <div class="dows"><div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div></div>
      <div class="days">${cells.join("")}</div>
    </div>
    <div class="monthlist">${Object.keys(byDay).filter((ds) => ds.startsWith(month)).sort().map((ds) => `<div class="mday ${ds === today ? "today" : ""} ${ds < today ? "past" : ""}"><div class="n">${esc(dt(ds, { weekday: "short", month: "short", day: "numeric" }))}${ds === today ? " · Today" : ""}</div>${byDay[ds].map((m) => `<a class="ev ${bcls(m.body)} ${m.special ? "special" : ""} ${m.estimated ? "est" : ""} ${m.cancelled ? "cancelled" : ""}" href="#/m/${esc(m.id)}">${esc(m.special ? `${m.special} (${BOARD_SHORT[m.body] || m.bodyName})` : m.bodyName)}${m.time ? `<span class="t"> · ${esc(tshort(m.time))}</span>` : ""}${m.estimated ? `<span class="t"> · usual date, not confirmed</span>` : ""}</a>`).join("")}</div>`).join("") || `<p class="muted">Nothing on the calendar this month.</p>`}</div>
    <p class="small muted" style="margin-top:10px">Solid color: on the board's calendar or agenda posted. Dashed: the board's usual date, not confirmed yet. Struck through: canceled. Times are local.</p>
    <div class="sechead"><h2>Next up</h2></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(210px,1fr))">${coming.map(upcomingCard).join("") || `<p class="muted">Nothing scheduled.</p>`}</div>`;
}

async function pageMeetings(body) {
  setNav("meetings"); title("Meetings");
  const d = await api(body ? { view: "meetings", body } : { view: "meetings" });
  const groups = {};
  for (const m of d.meetings) (groups[m.date.slice(0, 7)] ||= []).push(m);
  view.innerHTML = `<h1>Meetings</h1><p class="muted">Every meeting since January, newest first. Green, red and gold marks are how each item ended.</p>
    <div class="filters"><a class="chip ${body ? "" : "on"}" href="#/meetings">All boards</a>${Object.entries(d.bodies).map(([k, b]) => `<a class="chip ${body === k ? "on" : ""}" href="#/meetings/${k}">${esc(b.short)}</a>`).join("")}</div>
    ${body ? `<p class="muted">${esc(d.bodies[body]?.role)}</p>` : ""}
    ${Object.entries(groups).map(([ym, ms]) => `<div class="sechead"><h2>${esc(new Date(ym + "-15T12:00").toLocaleDateString("en-US", { month: "long", year: "numeric" }))}</h2></div><div class="grid" style="margin-top:14px">${ms.map(meetingRow).join("")}</div>`).join("") || `<p class="muted">No meetings yet.</p>`}`;
}

function itemCard(m, it) {
  const quotes = (it.quotes || []).map((q) => `<blockquote>“${esc(q.text)}”<footer>${esc(q.speaker || "Speaker")}${m.videoId && q.seconds != null ? ` · <a href="${yt(m.videoId, q.seconds)}" target="_blank" rel="noopener">watch at ${ts(q.seconds)}</a>` : ""}</footer></blockquote>`).join("");
  const parties = (it.parties || []).filter((p) => p.name);
  const r = resultOf(it);
  return `<article class="card item" id="item-${it.idx}">
    <div class="head"><h3>${esc(it.title)}</h3>${it.amount ? `<div class="amount">${exact(it.amount)}</div>` : ""}</div>
    ${it.officialTitle || it.docNumber || it.stage ? `<div class="official">${esc(it.docNumber && !String(it.officialTitle).includes(it.docNumber) ? `${it.docNumber}: ` : "")}${esc(it.officialTitle || "")}${it.officialTitle || it.docNumber ? " · " : ""}${esc(stageText(it.stage))}</div>` : ""}
    <p>${esc(it.whatItIs)}</p>
    ${it.whyItMatters ? `<p class="muted">${esc(it.whyItMatters)}</p>` : ""}
    ${it.fundingSource ? `<p class="small muted">Paid from ${esc(it.fundingSource)}.</p>` : ""}
    ${it.uncertain ? `<div class="uncertain">${esc(it.uncertain)}</div>` : ""}
    ${voteLine(it.vote, it, m, it.label)}
    ${quotes}
    ${it.notes?.length ? `<ul class="notes">${it.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
    ${parties.length ? `<div class="small muted">Involved: ${parties.map((p) => esc(p.name) + (p.role ? ` (${esc(p.role)})` : "")).join("; ")}</div>` : ""}
    ${it.nextStep?.text ? `<div class="next"><b>What's next:</b> ${esc(it.nextStep.text)}${it.nextStep.date ? ` (${esc(dt(it.nextStep.date, { month: "short", day: "numeric" }))})` : ""}${it.nextStep.publicCanSpeak ? ` <span class="tag hearing">Public can speak</span>` : ""}</div>` : ""}
    <div class="itemfoot">
      ${m.videoId && it.videoSeconds != null ? `<a href="${yt(m.videoId, it.videoSeconds)}" target="_blank" rel="noopener">Watch this part (${ts(it.videoSeconds)})</a>` : ""}
      ${it.issue ? `<a href="#/i/${esc(it.issue.key)}">Follow: ${esc(it.issue.title || "this issue")}</a>` : ""}
      ${it.vote?.method && it.vote.method !== "none" ? "" : `<span class="muted">${r === "none" ? "No vote taken" : ""}</span>`}
      <button class="linkbtn" data-report="${it.idx}">Report an error</button>
    </div>
  </article>`;
}

function agendaOutline(m, items, upcoming) {
  const rows = items.map((it) => `<a href="#/m/${esc(m.id)}#item-${it.idx}" data-item="${it.idx}"><span class="dot ${upcoming ? "hollow" : resultOf(it)}"></span><span>${esc(it.title)}</span><span class="amt">${it.amount ? compact(it.amount) : ""}</span></a>`).join("");
  return `<div class="panel outline"><div class="lbl">${upcoming ? "On the agenda" : "What happened"}</div>${rows}</div>`;
}

async function pageMeeting(id) {
  setNav("meetings");
  const m = await api({ view: "meeting", id });
  title(`${m.bodyName}, ${dt(m.date)}`);
  const att = m.attendance || {};
  const terms = Object.entries(m.glossary || {});
  const u = m.upcoming;
  const items = m.items || [];
  const passed = items.filter((i) => i.result === "passed").length;
  const approvedMoney = items.filter((i) => i.result === "passed" && i.amount).reduce((a, i) => a + i.amount, 0);
  const labels = { confirmed: "Confirmed by the minutes", video: m.minutesUrl ? "From the video · being checked against minutes" : "From the video · minutes not out yet", unclear: "Parts not fully clear" };
  const worst = items.some((i) => i.label === "unclear") ? "unclear" : items.some((i) => i.label === "video") ? "video" : items.length ? "confirmed" : "";
  const facts = u
    ? [u.time ? `<span><b>${esc(u.time)}</b>${u.location ? ` · ${esc(u.location)}` : ""}</span>` : u.location ? `<span>${esc(u.location)}</span>` : "", u.items.length ? `<span><b>${u.items.length} item${u.items.length === 1 ? "" : "s"}</b> on the agenda</span>` : "", `<span class="pill">${stateWord(u).replace(/<[^>]+>/g, "")}</span>`]
    : [`<span><b>${items.length} item${items.length === 1 ? "" : "s"}</b>${passed ? ` · ${passed} passed` : ""}${approvedMoney ? ` · ${money(approvedMoney)} approved` : ""}</span>`, att.absent?.length ? `<span>${esc(list(att.absent))} absent</span>` : "", worst ? `<span class="pill">${labels[worst]}</span>` : ""];
  const links = [m.videoId ? `<a href="${yt(m.videoId)}" target="_blank" rel="noopener">Watch the video</a>` : "", ...(m.moreVideoIds || []).map((v, i) => `<a href="${yt(v)}" target="_blank" rel="noopener">Video part ${i + 2}</a>`), m.packetUrl || u?.packetUrl ? `<a href="${esc(m.packetUrl || u.packetUrl)}" target="_blank" rel="noopener">Agenda packet</a>` : "", m.minutesUrl ? `<a href="${esc(m.minutesUrl)}" target="_blank" rel="noopener">Official minutes</a>` : ""];
  const agendaItems = u ? u.items : items;
  view.innerHTML = `
    <div class="band ${bcls(m.body)}"><div class="in">
      <div class="kicker"><a href="#/meetings/${esc(m.body)}" style="color:#fff;text-decoration:none">${esc(m.bodyName)}</a>${u?.special ? ` · ${esc(u.special)}` : ""}</div>
      <h1>${esc(dLong(m.date))}</h1>
      <div class="facts">${[...facts, ...links].filter(Boolean).join("")}</div>
    </div></div>
    <div class="two-col ${bcls(m.body)}">
      <aside>
        ${agendaItems.length ? agendaOutline(m, agendaItems, !!u) : ""}
        ${att.present?.length || att.absent?.length ? `<div class="panel" style="padding:12px 14px;margin-top:12px;font-size:.95rem"><div class="lbl" style="padding:0;font-weight:700;font-size:.85rem;color:var(--faint);margin-bottom:6px">Present</div>${esc((att.present || []).join(", ")) || "—"}${att.absent?.length ? `<div style="margin-top:6px"><b>Absent:</b> ${esc(list(att.absent))}</div>` : ""}</div>` : ""}
        ${u?.howToComment ? `<div class="panel" style="padding:12px 14px;margin-top:12px;font-size:.95rem;background:var(--gold);border-color:#d9b23a"><b>How to weigh in</b><div>${esc(u.howToComment)}</div></div>` : ""}
        ${(m.references || []).length ? `<div class="panel" style="padding:12px 14px;margin-top:12px;font-size:.95rem"><b>Related</b>${m.references.map((r) => `<div><a href="#/budget/${esc(r.id || r)}">${esc(r.title || r.id || r)}</a></div>`).join("")}</div>` : ""}
      </aside>
      <div class="content">
        ${u ? `${u.summary ? `<p class="summary panel" style="padding:16px 18px">${esc(u.summary)}</p>` : `<p class="muted panel" style="padding:16px 18px">${STATE_NOTE[u.state] || ""}</p>`}
          ${u.items.map((it, k) => `<article class="card item" id="item-${k}"><div class="head"><h3>${esc(it.title)}</h3>${it.amount ? `<div class="amount">${exact(it.amount)}</div>` : ""}</div>
            <div class="official">${esc([it.docNumber, it.step].filter(Boolean).join(" · "))}${speakTag(it)}</div>
            <p>${esc(it.whatItIs)}</p>${it.whyItMatters ? `<p class="muted">${esc(it.whyItMatters)}</p>` : ""}
            ${it.location || it.recipient ? `<div class="small muted">${[it.location ? `Where: ${esc(it.location)}` : "", it.recipient ? `To: ${esc(it.recipient)}` : ""].filter(Boolean).join(" · ")}</div>` : ""}
            <div class="itemfoot">${it.issue ? `<a href="#/i/${esc(it.issue.key)}">Follow: ${esc(it.issue.title || "this issue")}</a>` : ""}<button class="linkbtn" data-report="${k}">Report an error</button></div></article>`).join("")}`
        : `${m.summary ? `<p class="summary panel" style="padding:16px 18px">${esc(m.summary)}</p>` : `<p class="muted">This meeting's record is still being written up.</p>`}
          ${items.map((it) => itemCard(m, it)).join("")}
          ${m.held ? `<p class="held">${m.held} more item${m.held > 1 ? "s are" : " is"} being checked against the record and will appear here soon.</p>` : ""}`}
        ${m.role ? `<div class="sechead"><h2>About this board</h2></div><p class="muted">${esc(m.role)}</p>` : ""}
        ${terms.length ? `<div class="sechead"><h2>Words used here</h2></div><dl class="gloss">${terms.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join("")}</dl>` : ""}
      </div>
    </div>`;
  view.querySelectorAll("[data-report]").forEach((b) => b.addEventListener("click", () => openReport(m, u ? { idx: +b.dataset.report, title: u.items[+b.dataset.report]?.title } : items.find((i) => i.idx === +b.dataset.report))));
  const hash = location.hash.split("#item-")[1];
  if (hash) document.getElementById("item-" + hash)?.scrollIntoView();
}

async function pageIssues() {
  setNav("issues"); title("Issues");
  const d = await api({ view: "issues" });
  view.innerHTML = `<h1>Issues</h1><p class="muted">One matter, every board it passes through, in order. Each issue sits on a road: green dots are steps that happened, the gold one is up next, dashed ones are still to come, and a hollow one happened before we started following the board.</p>
    <div class="grid">${d.issues.map((i) => issueCard(i, d.bodies)).join("") || `<p class="muted">No issues yet.</p>`}</div>`;
}

const SPEAK = { right: ["speak", "Public can speak"], custom: ["speak soft", "Comment usually allowed"], none: ["quiet", "Public meeting, no comment"], staff: ["quiet", "No meeting"] };
function roadmapBlock(i, r) {
  const stepHtml = (st, n) => {
    const [cls, text] = SPEAK[st.speak] || SPEAK.none;
    const ev = st.event;
    const when = ev ? `<div class="when"><a href="#/m/${esc(ev.meetingId)}#item-${ev.idx}">${esc(ev.sameNight ? "Same night as the final vote" : `${stageText(ev.stage) || "Happened"} ${dt(ev.date, { month: "short", day: "numeric", year: "numeric" })}`)}${ev.result && ev.result !== "no vote" && !ev.sameNight ? ` · ${esc(ev.result)}` : ""}</a></div>` : "";
    const missed = st.state === "missed" ? `<div class="when muted">Not in our record. It most likely happened before Second Reading started following this board.</div>` : "";
    const nextBox = st.state === "next" ? `<div class="box"><b>Up next.</b> ${st.scheduled ? `On the ${esc(st.scheduled.bodyName)} agenda for <a href="#/m/${esc(st.scheduled.meetingId)}">${esc(dt(st.scheduled.date, { weekday: "long", month: "short", day: "numeric" }))}</a>.` : st.body ? "Not on an agenda yet. These usually come back within a few months; some never do." : "Handled by staff; it won't show up at a meeting."}${st.body && !st.scheduled ? ` <a href="#/alerts">Get an alert when it's scheduled</a>` : ""}</div>` : "";
    return `<div class="rstep ${st.state}"><div class="n">${st.state === "done" ? "✓" : n}</div><div>
      <div class="t">${esc(st.title)}${st.optional && st.state !== "done" ? ` <span class="small muted">(if needed)</span>` : ""} <span class="${cls}">${text}</span></div>
      <div class="who">${esc(st.bodyName)}</div>
      <p>${esc(st.what)}</p>${when}${missed}${nextBox}</div></div>`;
  };
  const stand = r.next?.key === "again" ? `It looked finished, but it's back on the ${esc(r.next.bodyName)} agenda for ${esc(dt(r.next.scheduled.date, { month: "long", day: "numeric" }))}.` : r.status === "done" ? `Decided. The last board vote on this road has happened.${r.after ? " " + esc(r.after) : ""}` : r.status === "failed" ? "It was voted down at the deciding step, so the road ends here unless it's brought back." : r.status === "stalled" ? `Nothing has happened in ${Math.round(r.daysSince / 30)} months. Projects sometimes stop here for good.` : r.next ? `${r.done ? `${r.done} of ${r.total} steps done. ` : ""}Up next is ${r.next.title.toLowerCase()} at the ${esc(r.next.bodyName)}${r.next.scheduled ? ` on ${esc(dt(r.next.scheduled.date, { month: "long", day: "numeric" }))}` : ", with no date yet"}.` : "";
  const canDo = r.status === "done" ? "The boards on this road have decided. If the project needs more approvals later (a site plan, a contract, permits), they'll show up here when they reach a board." + (r.next?.speak === "staff" ? " The last step is handled by staff, not at a meeting." : "") : r.status === "failed" ? "It was voted down. The applicant can usually bring a changed version back, which would start the road over." : r.next?.key === "again" ? `It's back on the ${esc(r.next.bodyName)} agenda for ${esc(dt(r.next.scheduled.date, { weekday: "long", month: "long", day: "numeric" }))}. The board usually takes comment.` : r.next && r.next.speak === "right" ? `The next chance to be heard is ${r.next.title.toLowerCase()} at the ${esc(r.next.bodyName)}${r.next.scheduled ? `, ${esc(dt(r.next.scheduled.date, { weekday: "long", month: "long", day: "numeric" }))}` : ", when it's scheduled"}. That's a public hearing: anyone can speak.` : r.next && r.next.speak === "custom" ? `The next step is at the ${esc(r.next.bodyName)}${r.next.scheduled ? ` on ${esc(dt(r.next.scheduled.date, { month: "long", day: "numeric" }))}` : ""}. The board usually takes comment there, though the law doesn't require it.` : r.status === "active" ? "The remaining steps don't take public comment." : "";
  const vari = r.steps.find((s) => s.state === "done" && s.bodies.some((b) => /bza/.test(b)));
  const appeal = vari?.event ? ` The ${esc(vari.bodyName)} decision is final unless someone who spoke at the ${esc(dt(vari.event.date, { month: "short", day: "numeric" }))} hearing files in court within 30 days.` : "";
  return `
    <div class="panel status ${r.status}"><div><b>Where this stands</b><div>${stand}</div>${r.why ? `<details class="why"><summary>${r.status === "done" ? "Why is this decided?" : r.status === "failed" ? "Why does it end here?" : "Why these steps?"}</summary><p>${esc(r.why)}</p></details>` : ""}</div></div>
    <div class="sechead"><h2>The road this takes</h2><span class="sub">${esc(r.intro)} Filled dots happened; the dashed ones are what usually comes next.</span></div>
    <div class="panel road">${r.steps.filter((s) => s.state !== "skipped").map((s, k) => stepHtml(s, k + 1)).join("")}</div>
    ${r.after && r.status !== "done" ? `<p class="small muted" style="margin-top:8px">After that: ${esc(r.after)}</p>` : ""}
    ${r.detour && r.status === "active" && !r.steps.some((s) => s.key === "detour") ? `<p class="small muted" style="margin-top:4px">Possible detour: ${esc(r.detour)}</p>` : ""}
    <template id="asideTpl">
      <div class="panel asidebox"><b>Can I still do anything?</b><div class="muted">${canDo}${appeal}</div></div>
      <div class="panel asidebox"><b>Who decides what</b><div>${r.steps.filter((s) => s.state !== "skipped").map((s) => `<div><span class="${s.body ? bcls(s.body) : ""}" style="font-weight:700;color:${s.body ? "var(--board)" : "var(--faint)"}">■</span> ${esc(s.bodyName)}: ${esc(s.title.toLowerCase())}</div>`).join("")}</div></div>
      ${r.law ? `<div class="panel asidebox"><b>The rules behind this</b><div class="muted">${esc(r.law)}. <a href="#/about">How this works</a></div></div>` : ""}
    </template>`;
}

async function pageIssue(key) {
  setNav("issues");
  const i = await api({ view: "issue", key });
  title(i.title);
  const lastBody = i.bodies?.[i.bodies.length - 1] || "";
  const events = i.events.slice().reverse();
  const r = i.roadmap;
  const kicker = r ? esc(r.label) : esc(list((i.bodies || []).map((b) => BOARD_SHORT[b] || b)));
  const facts = r
    ? [`<span><b>${r.next?.key === "again" ? "Back on the agenda" : r.status === "done" ? "Decided" : r.status === "failed" ? "Voted down" : r.status === "stalled" ? "Stalled" : `Step ${Math.min(r.done + 1, r.total)} of ${r.total}`}</b>${r.status === "active" && r.done && r.next?.key !== "again" ? ` · ${r.done} done` : ""}</span>`, i.latestStage ? `<span class="pill">${esc(stageText(i.latestStage))} ${esc(dt(i.lastDate, { month: "short", day: "numeric" }))}</span>` : "", r.next ? `<span>Up next: ${r.next.speak === "staff" ? `${esc(r.next.title.toLowerCase())}, no meeting` : `${esc(r.next.bodyName)}${r.next.scheduled ? `, ${esc(dt(r.next.scheduled.date, { month: "short", day: "numeric" }))}` : ", no date yet"}`}</span>` : ""]
    : [`<span><b>${i.count} step${i.count === 1 ? "" : "s"}</b> since ${esc(dt(i.firstDate, { month: "long", day: "numeric", year: "numeric" }))}</span>`, i.latestStage ? `<span class="pill">${esc(stageText(i.latestStage))}</span>` : ""];
  view.innerHTML = `
    <div class="band ${bcls(lastBody)}"><div class="in">
      <div class="kicker"><a href="#/issues" style="color:#fff;text-decoration:none">Issues</a> · ${kicker}</div>
      <h1>${esc(i.title)}</h1>
      <div class="facts">${facts.filter(Boolean).join("")}</div>
    </div></div>
    <div class="two-col ${bcls(lastBody)}">
      <div class="content">
        ${r ? roadmapBlock(i, r) : ""}
        ${i.coming.length ? `<div class="sechead" ${r ? "" : 'style="margin-top:0"'}><h2>Coming up</h2></div>${i.coming.map((c) => `<a class="card board" href="#/m/${esc(c.id)}"><div class="when">${esc(dt(c.date, { weekday: "short", month: "short", day: "numeric" }))}</div><div class="who">${esc(c.bodyName)}</div><ul class="agenda">${c.items.map((x) => `<li><span class="t">${esc(x.title)}</span>${x.publicHearing ? ` <span class="tag hearing">Public hearing</span>` : ""}<div class="small muted">${esc(x.step)}</div></li>`).join("")}</ul></a>`).join("")}` : ""}
        <div class="sechead" ${i.coming.length || r ? "" : 'style="margin-top:0"'}><h2>${r ? "What's happened so far" : "So far"}</h2><span class="sub">Newest first</span></div>
        <ol class="timeline" style="margin-top:16px">${events.map((e) => { const rr = resultOf({ result: e.vote?.result, stage: e.stage }); return `<li class="${bcls(e.body)}">
          <div class="d">${esc(dt(e.date))} · ${esc(e.bodyName)}</div>
          <div><a href="#/m/${esc(e.meetingId)}#item-${e.idx}"><b>${esc(e.title)}</b></a></div>
          ${e.whatItIs ? `<div class="muted">${esc(e.whatItIs)}</div>` : ""}
          <div class="small" style="margin-top:4px"><span class="outcome ${rr}"><span class="dot ${rr}"></span>${esc(stageText(e.stage))}</span>${e.vote?.no?.length ? ` · No: ${esc(list(e.vote.no))}` : ""}${e.amount ? ` · ${money(e.amount)}` : ""}${e.videoId && e.videoSeconds != null ? ` · <a href="${yt(e.videoId, e.videoSeconds)}" target="_blank" rel="noopener">watch</a>` : ""} ${labelTag(e.label)}</div>
        </li>`; }).join("")}</ol>
      </div>
      <aside id="issueAside">
        ${i.nextStep?.text && !r ? `<div class="panel" style="padding:14px 16px;background:var(--gold);border-color:#d9b23a"><b>What's next</b><div>${esc(i.nextStep.text)}${i.nextStep.date ? ` (${esc(dt(i.nextStep.date, { month: "short", day: "numeric" }))})` : ""}</div>${i.nextStep.publicCanSpeak ? `<div style="margin-top:6px"><b>The public can speak.</b></div>` : ""}</div>` : ""}
        ${r && i.nextStep?.text ? `<div class="panel asidebox"><b>From the record</b><div class="muted">${esc(i.nextStep.text)}${i.nextStep.date ? ` (${esc(dt(i.nextStep.date, { month: "short", day: "numeric" }))})` : ""}</div></div>` : ""}
        ${r ? "" : `<div class="panel" style="padding:14px 16px;margin-top:12px"><b>Boards involved</b><div class="legend" style="flex-direction:column;gap:6px">${(i.bodies || []).map((b) => `<span class="${bcls(b)}"><i class="swatch"></i>${esc(BOARD_SHORT[b] || b)}</span>`).join("")}</div></div>`}
      </aside>
    </div>`;
  const tpl = document.getElementById("asideTpl");
  if (tpl) document.getElementById("issueAside").append(tpl.content.cloneNode(true));
}

async function pageOfficials() {
  setNav("officials"); title("Officials");
  const d = await api({ view: "officials" });
  const by = {};
  for (const o of d.officials) (by[o.body] ||= []).push(o);
  view.innerHTML = `<h1>Officials</h1>
    <p class="muted">Attendance, motions and every vote where the record names them. Most votes here are voice votes, where the minutes say only that a motion carried, so individual votes show up mainly on roll calls and when someone is heard voting no.</p>
    ${Object.entries(by).map(([b, os]) => `<div class="sechead ${bcls(b)}"><h2><i class="swatch" style="width:14px;height:14px;margin-right:8px"></i>${esc(d.bodies[b].name)}</h2><span class="sub">${esc(d.bodies[b].role || "")}</span></div>
      <div class="grid ${bcls(b)}" style="grid-template-columns:repeat(auto-fill,minmax(230px,1fr))">${os.map((o) => { const pct = o.meetings ? Math.round((1 - o.absent / o.meetings) * 100) : 0; return `<a class="card board" href="#/o/${esc(b)}/${esc(o.slug)}">
        <div class="who" style="font-family:var(--display);font-size:1.3rem;color:var(--ink)">${esc(o.name)}</div>
        <div class="small muted">${esc([o.title, o.party].filter(Boolean).join(" · ") || "Member")}</div>
        <div class="meta small" style="margin-top:8px;gap:4px 12px"><span><b style="color:var(--ink)">${pct}%</b> attendance</span><span><b style="color:var(--ink)">${o.motions}</b> motions</span><span><b style="color:${o.no ? "var(--fail)" : "var(--ink)"}">${o.no}</b> no votes</span></div>
      </a>`; }).join("")}</div>`).join("")}`;
}

async function pageOfficial(body, slug) {
  setNav("officials");
  const o = await api({ view: "official", body, slug });
  title(o.name);
  const named = o.votes.filter((v) => v.how);
  const noTopics = {};
  for (const v of o.votes) if (v.how === "no") { const k = v.issue?.title || v.title; noTopics[k] = (noTopics[k] || 0) + 1; }
  const partWord = (v) => v.how === "no" ? `<span class="outcome failed"><span class="dot failed"></span>No</span>` : v.how === "yes" ? `<span class="outcome passed"><span class="dot passed"></span>Yes</span>` : v.how === "abstain" ? `<span class="outcome"><span class="dot"></span>Abstained</span>` : v.moved ? `<span class="outcome" style="color:var(--pass)"><span class="dot passed"></span>Moved</span>` : `<span class="outcome muted"><span class="dot hollow"></span>Seconded</span>`;
  view.innerHTML = `
    <div class="band ${bcls(body)}"><div class="in" style="display:flex;flex-wrap:wrap;gap:16px 40px;align-items:flex-end;justify-content:space-between">
      <div><div class="kicker"><a href="#/officials" style="color:#fff;text-decoration:none">${esc(o.bodyName)}</a> · ${esc([o.title, o.party].filter(Boolean).join(" · ") || "Member")}</div><h1>${esc(o.name)}</h1></div>
      <div class="stats" style="margin:0"><div><b>${o.meetings - o.absent} of ${o.meetings}</b><span>meetings attended</span></div><div><b>${o.motions}</b><span>motions made</span></div><div><b>${o.no}</b><span>recorded no votes</span></div></div>
    </div></div>
    <div class="two-col ${bcls(body)}">
      <div class="content">
        <div class="sechead" style="margin-top:0"><h2>On the record</h2><span class="sub">${named.length} named vote${named.length === 1 ? "" : "s"}, plus motions. Voice votes where no one objected aren't listed by name.</span></div>
        ${o.votes.length ? `<div class="list votes"><div class="head"><span>Date</span><span>Item</span><span>Their part</span></div>
          ${o.votes.map((v) => `<a class="row" href="#/m/${esc(v.meetingId)}#item-${v.idx}"><span>${esc(dt(v.date, { month: "short", day: "numeric", year: "numeric" }))}</span><span><b>${esc(v.title)}</b><div class="sub">${esc(v.result ? v.result[0].toUpperCase() + v.result.slice(1) : "")}${v.method ? `, ${esc(v.method)}` : ""}${v.amount ? ` · ${money(v.amount)}` : ""}</div></span><span>${partWord(v)}</span></a>`).join("")}
        </div>` : `<p class="muted">Nothing on the record yet.</p>`}
      </div>
      <aside>
        <div class="panel" style="padding:14px 16px"><b>Attendance, ${new Date().getFullYear()}</b>
          <div class="attend" style="margin-top:8px">${o.attended.map((a) => `<span class="${a.present ? "p" : ""}" title="${esc(dt(a.date, { month: "short", day: "numeric" }))}${a.present ? "" : ": absent"}"></span>`).join("")}</div>
          ${o.attended.length ? `<div class="small muted" style="display:flex;justify-content:space-between;margin-top:4px"><span>${esc(dt(o.attended[0].date, { month: "short" }))}</span><span>${esc(dt(o.attended.at(-1).date, { month: "short" }))}</span></div>` : ""}
          <div class="small muted" style="margin-top:8px">${o.absences.length ? `Missed ${o.absences.map((a) => `<a href="#/m/${esc(a.meetingId)}">${esc(dt(a.date, { month: "short", day: "numeric" }))}</a>`).join(", ")}` : "No absences recorded"}</div>
        </div>
        ${Object.keys(noTopics).length ? `<div class="panel" style="padding:14px 16px;margin-top:12px"><b>Where the no votes went</b>${Object.entries(noTopics).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `<div style="display:flex;justify-content:space-between;gap:12px;font-size:.95rem;margin-top:6px"><span>${esc(k)}</span><b>${n}</b></div>`).join("")}</div>` : ""}
        <div class="panel" style="padding:14px 16px;margin-top:12px;font-size:.95rem"><b>About the ${esc(o.bodyName)}</b><div class="muted" style="margin-top:4px">${esc(o.role || "")}</div></div>
      </aside>
    </div>`;
}

async function pageSearch(q) {
  setNav("search"); title("Search");
  view.innerHTML = `<h1>Search</h1>
    <form class="searchbox" id="sf"><input name="q" type="search" placeholder="A street, a company, an ordinance number, a topic…" value="${esc(q)}" aria-label="Search"><button>Search</button></form>
    <div id="results">${q ? `<p class="loading">Searching…</p>` : `<p class="muted">Searches every published meeting item, upcoming agendas and budgets.</p>`}</div>`;
  document.getElementById("sf").addEventListener("submit", (e) => { e.preventDefault(); location.hash = `#/search/${encodeURIComponent(e.target.q.value.trim())}`; });
  if (!q) return;
  const d = await api({ view: "search", q });
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const hl = (s) => { let t = esc(s); for (const w of words) t = t.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"), "<mark>$1</mark>"); return t; };
  document.getElementById("results").innerHTML = d.results.length ? `<p class="muted">${d.total} result${d.total === 1 ? "" : "s"}</p>` + d.results.map((r) => {
    const href = r.type === "budget" ? `#/budget/${esc(r.refId)}` : `#/m/${esc(r.meetingId)}${r.idx != null ? `#item-${r.idx}` : ""}`;
    const kind = r.type === "upcoming" ? `<span class="tag act">Coming up</span>` : r.type === "budget" ? `<span class="tag">Budget</span>` : labelTag(r.label);
    return `<a class="card board ${bcls(r.body || "")}" href="${href}"><div class="meta">${r.date ? `<b style="color:var(--ink)">${esc(dt(r.date))}</b>` : ""}${r.bodyName ? `<span class="who">${esc(r.bodyName)}</span>` : ""}${kind}</div><h3 style="margin-top:6px">${hl(r.title)}</h3>${r.snippet ? `<p class="muted" style="margin:0">${hl(r.snippet)}</p>` : ""}${r.amount ? `<div class="amount" style="margin-top:6px">${money(r.amount)}</div>` : ""}</a>`;
  }).join("") : `<p class="muted">Nothing found for “${esc(q)}”.</p>`;
}

async function pageBudgets() {
  setNav("budget"); title("Budgets");
  const d = await api({ view: "refs" });
  view.innerHTML = `<h1>Budgets</h1><p class="muted">Adopted budgets, read from the official documents and checked to the dollar.</p>
    <div class="grid">${d.refs.map((r) => `<a class="card board ${/county/i.test(r.title) ? "b-council" : "b-city-council"}" href="#/budget/${esc(r.id)}"><h3>${esc(r.title)}</h3><div class="amount">${money(r.totals?.allFunds)}</div><div class="meta" style="margin-top:6px">${esc(r.docNumber || "")}${r.adopted ? ` · adopted ${esc(dt(r.adopted, { month: "short", day: "numeric", year: "numeric" }))}` : ""}</div></a>`).join("") || `<p class="muted">None yet.</p>`}</div>`;
}

// Squarified-ish treemap on a 12-column grid: big boxes first, then rows of small ones.
function treemap(depts, opts) {
  const total = opts.total;
  const sorted = depts.slice().sort((a, b) => b.amount - a.amount);
  const big = sorted.filter((x) => x.amount / total >= 0.04).slice(0, 8);
  const rest = sorted.slice(big.length);
  const restTotal = rest.reduce((a, x) => a + x.amount, 0);
  const shades = opts.city ? ["var(--city-council)", "#3d7fc0", "#5a93cc", "#7faad8"] : ["var(--council)", "#1d8a7c", "#3a9c8e", "#5fb0a3"];
  const restBg = opts.city ? "#c9d9ee" : "#c5e3dd";
  const cells = [];
  // First row: up to three largest, column spans in proportion
  const top = big.slice(0, 3), topSum = top.reduce((a, x) => a + x.amount, 0);
  let used = 0;
  top.forEach((x, k) => { const span = k === top.length - 1 ? 12 - used : Math.max(2, Math.round((x.amount / topSum) * 12)); used += span; cells.push(`<a href="#f-${esc(slugify(x.name))}" style="grid-column:span ${span};grid-row:span 3;background:${shades[k]}"><b>${money(x.amount)}</b><span>${esc(x.name)}</span></a>`); });
  const mid = big.slice(3);
  const midSpan = mid.length === 1 ? 12 : mid.length === 2 || mid.length === 4 ? 6 : 4;
  mid.forEach((x) => cells.push(`<a class="sm" href="#f-${esc(slugify(x.name))}" style="grid-column:span ${midSpan};background:${shades[3]}"><b>${money(x.amount)} ${esc(x.name)}</b></a>`));
  if (rest.length) cells.push(`<a class="sm" href="#f-smaller" style="grid-column:span 12;background:${restBg};color:var(--ink)"><b style="font-weight:600">${rest.length} smaller offices · ${money(restTotal)}</b></a>`);
  return `<div class="treemap">${cells.join("")}</div>`;
}
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function pageBudget(id) {
  setNav("budget");
  const r = await api({ view: "ref", id });
  title(r.title);
  const t = r.totals || {}, tax = r.tax || {};
  const depts = (r.generalFundDepartments || []).slice().sort((a, b) => b.amount - a.amount);
  const deptTotal = depts.reduce((a, x) => a + x.amount, 0) || t.generalFund || 1;
  const groups = {};
  for (const f of r.funds || []) (groups[f.group || "Other funds"] ||= []).push(f);
  const hist = (r.history || []).slice().sort((a, b) => a.year - b.year);
  const hmax = Math.max(...hist.map((h) => h.budget || 0), 1);
  const county = /county/i.test(r.title);
  const first = hist[0], lastH = hist.at(-1);
  const growth = first && lastH && first.budget ? Math.round(((lastH.budget - first.budget) / first.budget) * 100) : null;
  view.innerHTML = `
    <div class="kicker" style="font-weight:600;color:var(--${county ? "council" : "city-council"})">${county ? "Howard County" : "City of Kokomo"}</div>
    <h1 style="margin-top:2px">${esc(r.title)}</h1>
    <p class="summary" style="max-width:760px">${esc(r.summary)}</p>
    <p class="muted small">${esc(r.docNumber || "")}${r.adopted ? `, adopted ${esc(dLong(r.adopted))}` : ""}${r.adoptedBy ? `${r.adopted || r.docNumber ? " by the" : "Adopted by the"} ${esc(r.adoptedBy.replace(/^the /i, ""))}` : ""}.${r.meetingId ? ` <a href="#/m/${esc(r.meetingId)}">See the meeting</a>.` : ""}${r.source?.url ? ` <a href="${esc(r.source.url)}" target="_blank" rel="noopener">Source document</a>.` : ""}</p>
    <div class="stats">
      <div class="stat"><b>${money(t.allFunds)}</b><span>${esc(t.allFundsLabel || "all funds")}</span></div>
      <div class="stat"><b>${money(t.generalFund)}</b><span>General Fund, day-to-day services</span></div>
      ${tax.rate ? `<div class="stat"><b>$${esc(tax.rate)}</b><span>${r.history?.some((h) => h.adopted) ? "adopted tax rate per $100 of assessed value (a ceiling; the state sets the final rate)" : "tax rate per $100 of assessed value"}</span></div>` : ""}
      ${tax.levy ? `<div class="stat"><b>${money(tax.levy)}</b><span>property tax levy</span></div>` : tax.estimatedCapLossAllFunds ? `<div class="stat"><b>${money(Math.abs(tax.estimatedCapLossAllFunds))}</b><span>expected loss to state tax caps</span></div>` : ""}
    </div>
    ${depts.length ? `<div class="sechead"><h2>Where the General Fund goes</h2><span class="sub">Each box is sized by its share of the ${money(deptTotal)}.</span></div>${treemap(depts, { total: deptTotal, city: !county })}` : ""}
    <div class="two ${county ? "b-council" : "b-city-council"}" style="margin-top:36px;gap:28px 32px;grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">
      ${hist.length > 1 ? `<div><div class="sechead" style="margin-top:0"><h2>Over the years</h2><span class="sub">${growth != null ? `Up ${growth}% since ${first.year}. ` : ""}${r.historyLabel ? `Counts the ${esc(r.historyLabel)}.` : ""}</span></div>
        <div class="bars">${hist.map((h) => `<div style="height:${Math.max(2, (h.budget / hmax) * 100)}%${h.adopted ? ";opacity:.55;border:2px dashed var(--board);background:none" : ""}" title="${h.year}: ${money(h.budget)}${h.adopted ? " (adopted)" : ""}"></div>`).join("")}</div>
        <div class="small muted" style="display:flex;justify-content:space-between;margin-top:4px"><span>${first.year} · ${money(first.budget)}</span><span>${lastH.year} · ${money(lastH.budget)}</span></div>
        ${hist.some((h) => h.levy) ? `<div class="tablewrap" style="margin-top:14px"><table><thead><tr><th>Year</th><th class="num">Budget</th><th class="num">Tax levy</th>${hist.some((h) => h.rate) ? `<th class="num">Rate</th>` : ""}</tr></thead><tbody>${hist.slice().reverse().map((h) => `<tr><td>${h.year}${h.adopted ? ` <span class="small muted">adopted, not yet certified</span>` : ""}</td><td class="num">${money(h.budget)}</td><td class="num">${money(h.levy)}</td>${hist.some((x) => x.rate) ? `<td class="num">${h.rate ?? ""}</td>` : ""}</tr>`).join("")}</tbody></table></div>` : ""}
      </div>` : ""}
      ${(r.observations || []).length ? `<div><div class="sechead" style="margin-top:0"><h2>What stands out</h2></div>${r.observations.map((o) => `<p class="panel" style="padding:12px 14px">${esc(o.text || o)}${o.page ? ` <span class="muted small">(p. ${o.page})</span>` : ""}</p>`).join("")}</div>` : ""}
    </div>
    ${depts.length ? `<div class="sechead" id="f-smaller"><h2>Every General Fund office</h2></div><div class="tablewrap"><table><tbody>${depts.map((x) => `<tr id="f-${esc(slugify(x.name))}"><td>${esc(x.name)}</td><td class="bar-cell"><div class="hbar" style="width:${(x.amount / depts[0].amount) * 100}%"></div></td><td class="num">${exact(x.amount)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${Object.entries(groups).map(([g, fs]) => { const y = r.year, prev = fs.some((f) => f[`budget${y - 1}`] != null), cash = fs.some((f) => f[`cashEnd${y}`] != null); return `<div class="sechead"><h2>${esc(g)}</h2></div><div class="tablewrap"><table><thead><tr><th>Fund</th>${prev ? `<th class="num">${y - 1}</th>` : ""}<th class="num">${y} budget</th>${cash ? `<th class="num">Cash at end of ${y}</th>` : ""}</tr></thead><tbody>${fs.map((f) => `<tr><td>${esc(f.name)}${f.page ? ` <span class="small muted">p. ${f.page}</span>` : ""}</td>${prev ? `<td class="num muted">${exact(f[`budget${y - 1}`])}</td>` : ""}<td class="num">${exact(f.budget)}</td>${cash ? `<td class="num">${f[`cashEnd${y}`] != null ? exact(f[`cashEnd${y}`]) : ""}</td>` : ""}</tr>`).join("")}</tbody></table></div>`; }).join("")}`;
}

function pageAbout() {
  setNav(""); title("How this works");
  view.innerHTML = `<h1>How this works</h1>
  <p>A second reading is the vote where an ordinance actually passes. This site is a second reading of the public record for people who weren't in the room.</p>
  <h2>This is a beta</h2>
  <p>Second Reading is a work in progress. Older meetings are still being filled in, new meetings usually appear a day or two after they happen (the video has to be posted and transcribed first), and the way items are summarized and labeled will keep changing as the site improves. Expect gaps, and expect things to move around. When something is wrong, use “Report an error” on the item and a person will look at it.</p>
  <p>Second Reading follows the boards that make the biggest decisions in Howard County and Kokomo: the County Council and Commissioners, the County Plan Commission, the Kokomo Common Council, Plan Commission, Board of Zoning Appeals and Board of Public Works and Safety.</p>
  <h2>How decisions actually get made</h2>
  <p>Most confusion about local government comes from not knowing which board decides what, and when you can speak. The short version:</p>
  <p><b>Changing what land can be used for (a rezoning).</b> The only hearing the law requires is at the Plan Commission, which sends a favorable, unfavorable or no recommendation to the deciding body: the Common Council inside Kokomo, the Commissioners outside it. That body has 90 days; if it does nothing after a favorable recommendation, the rezoning takes effect anyway. The Council usually lets people speak at the final vote, but it doesn't have to. If you want to be heard on a rezoning, the Plan Commission hearing is the one that counts.</p>
  <p><b>Exceptions to the zoning rules (variances and special exceptions).</b> The Board of Zoning Appeals hears them and decides. Its decision is final; nothing goes to the Council. The only appeal is to court within 30 days, and only someone who spoke or filed at the hearing can bring it. If you stay home, you lose the right to appeal.</p>
  <p><b>Building something.</b> After any variances, a commercial project needs a site plan (development plan) approved by the Plan Commission, which is where neighbors have the most practical say on how it's built; then the Board of Works handles driveways, right-of-way and utility connections; then permits come from staff with no meeting at all. Splitting land into lots works the same way: a primary plat hearing, then a secondary plat approved without one.</p>
  <p><b>Spending beyond the budget.</b> Notice goes up at least 14 days ahead, the fiscal body (County Council or Common Council) holds a public hearing and votes the same night, and for property-tax money the state then has 15 days to confirm the money exists.</p>
  <p><b>New laws and rules.</b> Kokomo's Council reads every ordinance twice before voting; it can pass one the same night only if every member present agrees. The mayor then has 10 days to sign or veto, and silence counts as a veto; the Council can override with two-thirds. The County Commissioners usually introduce and adopt an ordinance at a single meeting.</p>
  <p><b>Tax breaks for businesses (abatements).</b> The fiscal body, never the Commissioners, declares the area eligible, gives notice to every taxing unit affected, holds a public hearing, and confirms. The company then reports every May on whether it kept its job and investment promises, and the abatement can be ended if it didn't.</p>
  <p><b>Hiring contractors.</b> Work over $300,000 goes out for sealed bids, advertised twice and opened aloud at a meeting; $50,000 to $300,000 takes quotes opened at a meeting. Bids are usually "taken under advisement" and awarded at a later meeting, within 60 days, to the lowest bidder the board judges able to do the work.</p>
  <p><b>The budget.</b> A notice to taxpayers, a public hearing, adoption by November 1, then the state certifies the budget, levy and tax rate by the end of December. The state can lower what was adopted but never raise it, so the tax rate a council adopts is a ceiling, not the final number.</p>
  <p><b>When can you speak?</b> The Open Door Law gives you the right to attend and record any meeting, not to speak. A legal right to be heard exists only where a public hearing is required: Plan Commission rezoning and plat hearings, Board of Zoning Appeals hearings, extra spending, the budget hearing, and tax-abatement confirmations. Everywhere else, including ordinary ordinances at the Council and anything at the Board of Works, letting the public speak is up to the board. The site marks items with "Public hearing · you can speak" when the right exists and "Comment usually allowed" when it's custom.</p>
  <p class="muted small">Sources: Indiana Code 36-7-4 (planning and zoning), 6-1.1-18-5 (additional appropriations), 36-4-6 and 36-2-4 (ordinances), 6-1.1-12.1 (abatements), 36-1-12 (public works bidding), 6-1.1-17 (budgets), 5-14-1.5 (Open Door Law); Kokomo Code of Ordinances chapter 30A; Howard County Code chapter 30.</p>
  <h2>Where it comes from</h2>
  <p>Every day it checks the county and city websites for new agendas and minutes and the official YouTube channels for meeting videos. AI reads them and writes a plain-language summary of each item: what it is, why it matters, how the vote went and what happens next. Every item links back to the source document or the moment in the video.</p>
  <h2>What the labels mean</h2>
  <p>${labelTag("confirmed")} The official minutes back up the outcome, the vote and the amount.</p>
  <p>${labelTag("video", { minutesKind: "next-packet" })} Written from the meeting video. Boards approve their minutes at the next meeting, so this is checked again when the minutes come out.</p>
  <p>${labelTag("unclear")} Something couldn't be confirmed, like audio that was hard to hear. The item says what.</p>
  <p>When the minutes and the video disagree, the item is held back until a person checks it.</p>
  <h2>About votes</h2>
  <p>Most votes on these boards are voice votes. Indiana minutes usually say only that a motion carried, so the site names how individual members voted only when there was a roll call or someone was heard voting no.</p>
  <h2>Corrections</h2>
  <p>See something wrong? Use “Report an error” on any item. Reports go to a person, not straight onto the site.</p>`;
}

// ---- report dialog
const dlg = document.getElementById("report");
let reporting = null;
function openReport(m, it) {
  const path = location.hash.replace(/^#/, "") || "/";
  reporting = m ? { meetingId: m.id, idx: it?.idx ?? null, page: path } : { page: path };
  document.getElementById("reportWhat").textContent = m ? `${m.bodyName}, ${dt(m.date)}${it ? `: ${it.title}` : ""}` : `This page (${document.title.replace(/ · Second Reading.*$/, "")})`;
  document.getElementById("reportErr").textContent = "";
  dlg.querySelector("form").reset();
  dlg.showModal();
}
dlg.addEventListener("close", async () => {
  if (dlg.returnValue !== "send" || !reporting) return;
  const f = dlg.querySelector("form");
  const res = await fetch("/api/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...reporting, text: f.text.value, contact: f.contact.value }) });
  if (res.ok) toast("Thanks. A person will look at this.");
  else { document.getElementById("reportErr").textContent = (await res.json().catch(() => ({}))).error || "Couldn't send. Try again."; dlg.showModal(); }
});
document.getElementById("reportPage")?.addEventListener("click", (e) => { e.preventDefault(); openReport(null); });
function toast(msg) {
  document.querySelectorAll("[data-toast]").forEach((x) => x.remove());
  const t = document.createElement("div"); t.dataset.toast = "1";
  t.textContent = msg; t.setAttribute("role", "status");
  Object.assign(t.style, { position: "fixed", left: "50%", bottom: "24px", transform: "translateX(-50%)", background: "var(--ink)", color: "var(--paper)", padding: "10px 16px", borderRadius: "8px", zIndex: 20 });
  document.body.append(t); setTimeout(() => t.remove(), 3500);
}

// ---- Notifications (Web Push). Works once the site is on a phone's home screen (or in a desktop browser).
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isMobile = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (matchMedia("(pointer: coarse)").matches && innerWidth < 900);
const inAppBrowser = () => /FBAN|FBAV|FB_IAB|Instagram|Messenger|Twitter|Line\/|MicroMessenger/i.test(navigator.userAgent);
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
let swReg = null;
async function pushState() {
  if (isIOS() && !standalone()) return "install";
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try { swReg = swReg || (await navigator.serviceWorker.register("/sw.js")); const sub = await swReg.pushManager.getSubscription(); return sub ? "on" : "off"; } catch (e) { return "unsupported"; }
}
const b64ToU8 = (b) => { const p = "=".repeat((4 - (b.length % 4)) % 4); const r = atob((b + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };
async function enableAlerts() {
  const cfg = await fetch("/api/push").then((r) => r.json()).catch(() => ({}));
  if (!cfg.ready || !cfg.key) { toast("Notifications aren't switched on yet."); return "off"; }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "denied" : "off";
  swReg = swReg || (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  const sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(cfg.key) });
  const res = await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON() }) });
  if (!res.ok) { await sub.unsubscribe(); toast("Couldn't turn alerts on. Try again."); return "off"; }
  toast("Alerts are on. You'll hear before meetings and when write-ups land.");
  return "on";
}
async function disableAlerts() {
  const sub = await swReg?.pushManager.getSubscription();
  if (sub) { await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "unsubscribe", endpoint: sub.endpoint }) }).catch(() => null); await sub.unsubscribe(); }
  toast("Alerts are off.");
  return "off";
}
const PREF_KINDS = [["agenda", "Agenda summary", "the day before a meeting, when the summary is ready"], ["starting", "Starting soon", "about an hour before a meeting"], ["published", "What happened", "when the write-up is published"]];
const PREF_GROUPS = [["council", "County Council"], ["commissioners", "County Commissioners"], ["plan", "County Plan Commission"], ["city-council", "Kokomo Common Council"], ["city-boards", "Other Kokomo boards (Plan, Zoning Appeals, Board of Works)"]];
let prefsCache = null;
async function loadPrefs() {
  const sub = await swReg?.pushManager.getSubscription(); if (!sub) return null;
  const r = await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "getPrefs", endpoint: sub.endpoint }) }).then((x) => x.json()).catch(() => ({}));
  prefsCache = r.prefs || { kinds: PREF_KINDS.map((k) => k[0]), groups: PREF_GROUPS.map((g) => g[0]) };
  return prefsCache;
}
async function savePrefs(prefs) {
  const sub = await swReg?.pushManager.getSubscription(); if (!sub) return;
  const r = await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "prefs", endpoint: sub.endpoint, prefs }) });
  if (r.ok) { prefsCache = prefs; toast("Saved."); } else toast("Couldn't save. Try again.");
}
function prefsForm(p) {
  const box = (name, val, label, sub, on) => `<label class="pref"><input type="checkbox" data-pref="${name}" value="${val}" ${on ? "checked" : ""}><span><b>${label}</b>${sub ? `<span class="small muted"> · ${sub}</span>` : ""}</span></label>`;
  return `<div class="prefs">
    <div><div class="lbl">Tell me about</div>${PREF_KINDS.map(([v, l, sub]) => box("kinds", v, l, sub, p.kinds.includes(v))).join("")}<div class="pref small muted">Announcements from the person who runs the site always come through. They're rare.</div></div>
    <div><div class="lbl">For these boards</div>${PREF_GROUPS.map(([v, l]) => box("groups", v, l, "", p.groups.includes(v))).join("")}</div>
  </div>`;
}
function installSteps() {
  const inApp = inAppBrowser();
  return `<ol class="steps-list">
    ${inApp ? `<li><b>Open this page in Safari.</b> You're inside another app right now. Tap the <b>···</b> menu and choose <b>Open in Safari</b> (or Open in browser).</li>` : `<li><b>Open this page in Safari</b> if you aren't already.</li>`}
    <li>Tap the <b>Share</b> button (the square with an arrow pointing up).</li>
    <li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
    <li>Open <b>Second Reading</b> from your home screen and tap <b>Turn on alerts</b>.</li>
  </ol>`;
}
function alertsPanel(state) {
  if (state === "install") return `<section class="panel alerts install" id="alerts"><div><b>Get a heads-up before meetings</b><div class="small muted">Alerts go to your phone like any app's. On iPhone, add Second Reading to your home screen first; it takes four taps.</div>${installSteps()}</div></section>`;
  const copy = { on: ["Alerts are on", "You'll get a heads-up the day before a meeting, when one is about to start, and when the write-up is published.", "Turn off"], off: ["Get a heads-up before meetings", "A notification the day before a meeting, when one is about to start, and when the write-up is published. Nothing else.", "Turn on alerts"], denied: ["Alerts are blocked", "Notifications for this site are turned off in your phone or browser settings.", ""], unsupported: ["Alerts aren't available in this browser", inAppBrowser() ? "Open this page in Chrome (tap the ··· menu, then Open in browser) and try again." : "Try opening secondreading.org in Chrome.", ""] }[state];
  const hint = state === "off" && !standalone() && !isIOS() ? `<div class="small muted" style="margin-top:6px">Tip: in Chrome's ⋮ menu, <b>Add to Home screen</b> puts Second Reading on your phone like an app.</div>` : "";
  return `<section class="panel alerts ${state}" id="alerts"><div><b>${copy[0]}</b><div class="small muted">${copy[1]}</div>${hint}</div>${copy[2] ? `<button class="btn ${state === "on" ? "" : "green"}" data-alerts="${state === "on" ? "off" : "on"}">${copy[2]}</button>` : ""}</section>`;
}
async function mountAlerts(el, { full = false } = {}) {
  if (!el) return;
  const render = async (state) => {
    el.innerHTML = alertsPanel(state) + (full && state === "on" ? `<div class="panel" id="prefsBox" style="padding:14px 18px;margin-top:12px"><p class="muted small">Loading your choices…</p></div>` : full && state !== "on" ? "" : state === "on" ? `<p class="small muted" style="margin:8px 0 0"><a href="#/alerts">Choose which alerts you get</a></p>` : "");
    el.querySelector("[data-alerts]")?.addEventListener("click", async (e) => { e.target.disabled = true; render(e.target.dataset.alerts === "on" ? await enableAlerts().catch(() => "off") : await disableAlerts().catch(() => "off")); });
    const pb = el.querySelector("#prefsBox");
    if (pb) {
      const p = (await loadPrefs()) || prefsCache;
      pb.innerHTML = prefsForm(p);
      pb.addEventListener("change", () => {
        const next = { kinds: [...pb.querySelectorAll("[data-pref=kinds]:checked")].map((i) => i.value), groups: [...pb.querySelectorAll("[data-pref=groups]:checked")].map((i) => i.value) };
        savePrefs(next);
      });
    }
  };
  render(await pushState());
}
document.getElementById("alertsLink")?.addEventListener("click", (e) => { e.preventDefault(); location.hash = "#/alerts"; });

// ---- Happening now / Starting soon
const liveBox = document.getElementById("live");
let liveTimer = null;
function minutesWord(n) { return n <= 1 ? "in a minute" : n < 60 ? `in ${n} minutes` : `in ${Math.round(n / 60)} hour${n >= 90 ? "s" : ""}`; }
async function renderLive() {
  try {
    const r = await fetch("/api/live").then((x) => x.json());
    const items = (r.items || []).sort((a, b) => (a.state === "now" ? -1 : 1) - (b.state === "now" ? -1 : 1));
    liveBox.innerHTML = items.map((i) => `<section class="livebar ${i.state}" aria-live="polite">
      <div class="lead"><span class="pulse"></span>${i.state === "now" ? "Happening now" : "Starting soon"}</div>
      <div class="what"><b><a href="#/m/${esc(i.id)}" style="color:inherit">${esc(i.bodyName)}</a></b>${i.time ? ` · ${i.state === "now" ? "started " : ""}${esc(i.time)}` : ""}${i.state === "soon" && i.startsIn > 0 ? `, ${minutesWord(i.startsIn)}` : ""}${i.location ? ` · ${esc(i.location)}` : ""}</div>
      <div class="acts"><a class="btn ${i.state === "now" ? "solid" : "green"}" href="${esc(i.streamUrl)}" target="_blank" rel="noopener">${esc(i.streamLabel)}</a>${i.packetUrl ? `<a class="btn" href="${esc(i.packetUrl)}" target="_blank" rel="noopener">Agenda</a>` : ""}</div>
    </section>`).join("");
    clearTimeout(liveTimer);
    liveTimer = setTimeout(renderLive, items.length ? 120e3 : 15 * 60e3);
  } catch (e) { liveBox.innerHTML = ""; }
}
renderLive();

// ---- Staying current. A home-screen app is frozen in the background and never reloads on its own, so when it
// comes back to the foreground: if the site has been redeployed since this page loaded, reload; otherwise refresh the data.
let pageTag = null, lastShown = Date.now();
async function siteTag() { try { const r = await fetch("/site.js", { method: "HEAD", cache: "no-store" }); return r.headers.get("etag") || r.headers.get("last-modified") || null; } catch (e) { return null; } }
siteTag().then((t) => { pageTag = t; });
async function refreshIfStale({ force = false } = {}) {
  const t = await siteTag();
  if (t && pageTag && t !== pageTag) { location.reload(); return true; }
  if (force || Date.now() - lastShown > 2 * 60e3) { cache.clear(); await route(); renderLive(); }
  lastShown = Date.now();
  return false;
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshIfStale(); else lastShown = Date.now(); });
addEventListener("pageshow", (e) => { if (e.persisted) refreshIfStale(); });

// ---- Pull to refresh, for the home-screen version (phones don't give a standalone web app the browser's own one)
(function pullToRefresh() {
  if (!standalone() || !("ontouchstart" in window)) return;
  const bar = document.createElement("div"); bar.className = "ptr"; bar.innerHTML = `<span class="ptr-ring"></span><span class="ptr-text">Pull to refresh</span>`; document.body.prepend(bar);
  const text = bar.querySelector(".ptr-text");
  let startY = null, pull = 0, armed = false, busy = false;
  const LIMIT = 72;
  addEventListener("touchstart", (e) => { if (busy || window.scrollY > 0 || document.getElementById("report")?.open) { startY = null; return; } startY = e.touches[0].clientY; pull = 0; armed = false; }, { passive: true });
  addEventListener("touchmove", (e) => {
    if (startY == null || busy) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0 || window.scrollY > 0) { if (pull) { pull = 0; bar.style.height = "0px"; } return; }
    pull = Math.min(dy * 0.5, LIMIT + 24);
    bar.style.height = pull + "px"; bar.classList.toggle("ready", pull >= LIMIT);
    armed = pull >= LIMIT; text.textContent = armed ? "Let go to refresh" : "Pull to refresh";
  }, { passive: true });
  addEventListener("touchend", async () => {
    if (startY == null) return;
    startY = null;
    if (!armed) { bar.style.height = "0px"; bar.classList.remove("ready"); return; }
    busy = true; bar.classList.add("busy"); text.textContent = "Refreshing…"; bar.style.height = LIMIT + "px";
    try { await refreshIfStale({ force: true }); } catch (e) {}
    setTimeout(() => { bar.style.height = "0px"; bar.classList.remove("ready", "busy"); busy = false; }, 350);
  }, { passive: true });
})();

// ---- router
async function route() {
  const [path] = location.hash.replace(/^#/, "").split("#item-");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  window.scrollTo(0, 0);
  // Vercel Analytics sees only the part of the URL before the #, so report each view with a readable path
  try { const route = "/" + ({ m: "meeting", i: "issue", o: "official" }[parts[0]] || parts[0] || ""); window.va?.("pageview", { route, path: "/" + parts.join("/") }); } catch (e) {}
  try {
    if (!parts.length) await pageHome();
    else if (parts[0] === "meetings") await pageMeetings(parts[1]);
    else if (parts[0] === "m") await pageMeeting(parts[1]);
    else if (parts[0] === "calendar") await pageCalendar(parts[1]);
    else if (parts[0] === "issues") await pageIssues();
    else if (parts[0] === "i") await pageIssue(parts[1]);
    else if (parts[0] === "officials") await pageOfficials();
    else if (parts[0] === "o") await pageOfficial(parts[1], parts[2]);
    else if (parts[0] === "search") await pageSearch(parts[1] || "");
    else if (parts[0] === "budget" && parts[1]) await pageBudget(parts[1]);
    else if (parts[0] === "budget") await pageBudgets();
    else if (parts[0] === "about") pageAbout();
    else if (parts[0] === "alerts") pageAlerts();
    else view.innerHTML = `<h1>Page not found</h1><p><a href="#/">Go to the home page</a></p>`;
  } catch (e) {
    view.innerHTML = e.status === 404 ? `<h1>Not found</h1><p class="muted">That page doesn't exist or isn't published yet.</p><p><a href="#/">Home</a></p>` : `<h1>Something went wrong</h1><p class="muted">${esc(e.message)}</p>`;
  }
}
addEventListener("hashchange", route);
route();
