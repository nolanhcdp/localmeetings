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
const exact = (n) => (n == null ? "" : `${n < 0 ? "−" : ""}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`);
const dt = (d, opts = { weekday: "short", month: "short", day: "numeric", year: "numeric" }) => new Date(d + "T12:00:00").toLocaleDateString("en-US", opts);
const dLong = (d) => dt(d, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const daysUntil = (d) => Math.round((new Date(d + "T12:00:00") - new Date(new Date().toDateString() + " 12:00")) / 864e5);
const relDay = (d) => { const n = daysUntil(d); return n === 0 ? "Today" : n === 1 ? "Tomorrow" : n > 1 && n < 7 ? `This ${dt(d, { weekday: "long" })}` : ""; };
const ts = (s) => { s = Math.max(0, s | 0); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(x).padStart(2, "0")}`; };
const yt = (id, s) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}${s != null ? `&t=${s | 0}s` : ""}`;
const title = (t) => (document.title = t ? `${t} · Local Meetings` : "Local Meetings · Howard County and Kokomo");
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

function voteLine(v, it) {
  if (!v || v.method === "none" || v.result === "no vote") return "";
  const res = v.result === "passed" ? `<b class="passed">Passed</b>` : v.result === "failed" ? `<b class="failed">Failed</b>` : v.result === "tabled" ? "<b>Tabled</b>" : "<b>Outcome unclear</b>";
  const parts = [];
  if (v.method === "roll call" && v.yes?.length) parts.push(`Yes: ${esc(list(v.yes))}`);
  if (v.no?.length) parts.push(`No: ${esc(list(v.no))}`);
  if (v.abstain?.length) parts.push(`Abstained: ${esc(list(v.abstain))}`);
  const how = v.method === "roll call" ? "roll call" : v.method === "voice" ? "voice vote" : v.method === "consensus" ? "by consensus" : "";
  const moved = it?.motionBy ? `Moved by ${esc(it.motionBy)}${it.secondBy ? `, seconded by ${esc(it.secondBy)}` : ""}.` : "";
  return `<div class="vote">${res}${how ? ` · ${how}` : ""}${parts.length ? ` · ${parts.join(" · ")}` : ""}${v.note || moved ? `<div class="muted small">${esc([moved, v.note].filter(Boolean).join(" "))}</div>` : ""}</div>`;
}

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
function upcomingCard(u, { full = false } = {}) {
  const rel = relDay(u.date);
  const items = full ? u.items : u.items.slice(0, 4);
  const hearings = u.items.filter((i) => i.publicHearing).length;
  return `<article class="card">
    <a href="#/m/${esc(u.id)}" style="color:inherit;text-decoration:none">
      <div class="when">${rel ? `${rel}, ` : ""}${esc(dt(u.date, { weekday: rel ? undefined : "short", month: "short", day: "numeric" }))}${u.time ? ` · ${esc(u.time)}` : ""}</div>
      <div class="who">${esc(u.bodyName)}</div>
    </a>
    ${u.location ? `<div class="meta">${esc(u.location)}</div>` : ""}
    ${u.summary ? `<p style="margin-top:10px">${esc(u.summary)}</p>` : `<p class="muted" style="margin-top:10px">The agenda is posted. A plain-language preview is on its way.</p>`}
    ${items.length ? `<ul class="agenda">${items.map((i) => `<li><span class="t">${esc(i.title)}</span>${i.publicHearing ? ` <span class="tag hearing">Public hearing</span>` : ""}${i.amount ? ` <span class="muted">· ${money(i.amount)}</span>` : ""}${full ? `<div>${esc(i.whatItIs)}</div>${i.whyItMatters ? `<div class="muted">${esc(i.whyItMatters)}</div>` : ""}${i.step ? `<div class="small muted">${esc(i.step)}${i.location ? ` · ${esc(i.location)}` : ""}${i.issue ? ` · <a href="#/i/${esc(i.issue.key)}">Follow this issue</a>` : ""}</div>` : ""}` : ""}</li>`).join("")}</ul>` : ""}
    ${!full && u.items.length > 4 ? `<p class="small" style="margin:8px 0 0"><a href="#/m/${esc(u.id)}">${u.items.length - 4} more on the agenda</a></p>` : ""}
    ${(full || hearings) && u.howToComment ? `<div class="how"><b>How to weigh in:</b> ${esc(u.howToComment)}</div>` : ""}
    ${u.packetUrl ? `<div class="meta" style="margin-top:10px"><a href="${esc(u.packetUrl)}" target="_blank" rel="noopener">Full agenda packet (PDF)</a></div>` : ""}
  </article>`;
}

function meetingRow(m) {
  const passed = m.items.filter((i) => i.result === "passed").length;
  const top = m.items.filter((i) => !["minutes", "claims", "public comment"].includes(i.category)).sort((a, b) => (b.amount || 0) - (a.amount || 0) || a.idx - b.idx).slice(0, 3).sort((a, b) => a.idx - b.idx);
  return `<a class="card" href="#/m/${esc(m.id)}">
    <div class="meta"><b style="color:var(--ink)">${esc(dt(m.date))}</b><span>${esc(m.bodyName)}</span></div>
    ${top.length ? `<ul class="agenda">${top.map((i) => `<li><span class="t">${esc(i.title)}</span>${i.amount ? ` <span class="muted">· ${money(i.amount)}</span>` : ""}</li>`).join("")}</ul>` : `<p class="muted">${esc((m.summary || "").slice(0, 160))}</p>`}
    <div class="meta small" style="margin-top:6px"><span>${m.items.length} item${m.items.length === 1 ? "" : "s"}</span>${passed ? `<span>${passed} passed</span>` : ""}</div>
  </a>`;
}

const issueCard = (i, bodies) => `<a class="card" href="#/i/${esc(i.key)}">
  <h3>${esc(i.title)}</h3>
  <div class="meta"><span>${(i.bodies || []).map((b) => esc(bodies?.[b]?.short || b)).join(", ")}</span><span>${i.count} step${i.count === 1 ? "" : "s"}</span>${i.lastDate ? `<span>Last: ${esc(dt(i.lastDate, { month: "short", day: "numeric" }))}${i.latestStage ? `, ${esc(stageText(i.latestStage).toLowerCase())}` : ""}</span>` : ""}</div>
  ${i.nextStep?.text ? `<div class="next small"><b>Next:</b> ${esc(i.nextStep.text)}${i.nextStep.date ? ` (${esc(dt(i.nextStep.date, { month: "short", day: "numeric" }))})` : ""}</div>` : ""}
</a>`;

async function pageHome() {
  setNav("home"); title("");
  const d = await api({ view: "home" });
  view.innerHTML = `
    <h1>What local government is deciding next</h1>
    <p class="muted summary">Howard County and the City of Kokomo, in plain language. See what's on the agenda before the meeting, how to weigh in, and what happened after.</p>
    <section class="upcoming">
      ${d.upcoming.length ? `<div class="grid">${d.upcoming.map((u) => upcomingCard(u)).join("")}</div>` : `<div class="card muted">No upcoming agendas are posted yet. Boards usually post them a few days ahead.</div>`}
    </section>
    ${d.ahead.length ? `<h2>Dates to watch</h2><div class="tablewrap"><table><tbody>${d.ahead.map((a) => `<tr><td style="white-space:nowrap"><b>${esc(dt(a.date, { weekday: "short", month: "short", day: "numeric" }))}</b></td><td><a href="#/i/${esc(a.key)}">${esc(a.title)}</a><div class="small muted">${esc(a.text)}</div></td><td>${a.publicCanSpeak ? `<span class="tag hearing">Public can speak</span>` : ""}</td></tr>`).join("")}</tbody></table></div>` : ""}
    <h2>Recently decided</h2>
    <div class="grid">${d.recent.map(meetingRow).join("") || `<p class="muted">Nothing yet.</p>`}</div>
    <p style="margin-top:12px"><a href="#/meetings">All ${d.counts.meetings} meetings</a></p>
    <h2>Issues to follow</h2>
    <p class="muted">Ongoing matters tracked from first mention to final vote, across every board.</p>
    <div class="grid">${d.issues.map((i) => issueCard(i, d.bodies)).join("")}</div>
    <p style="margin-top:12px"><a href="#/issues">All ${d.counts.issues} issues</a></p>`;
}

async function pageMeetings(body) {
  setNav("meetings"); title("Meetings");
  const d = await api(body ? { view: "meetings", body } : { view: "meetings" });
  const groups = {};
  for (const m of d.meetings) (groups[m.date.slice(0, 7)] ||= []).push(m);
  view.innerHTML = `<h1>Meetings</h1>
    <div class="filters"><a class="chip ${body ? "" : "on"}" href="#/meetings">All boards</a>${Object.entries(d.bodies).map(([k, b]) => `<a class="chip ${body === k ? "on" : ""}" href="#/meetings/${k}">${esc(b.short)}</a>`).join("")}</div>
    ${body ? `<p class="muted">${esc(d.bodies[body]?.role)}</p>` : ""}
    ${Object.entries(groups).map(([ym, ms]) => `<h2>${esc(new Date(ym + "-15T12:00").toLocaleDateString("en-US", { month: "long", year: "numeric" }))}</h2><div class="grid">${ms.map(meetingRow).join("")}</div>`).join("") || `<p class="muted">No meetings yet.</p>`}`;
}

function itemCard(m, it) {
  const quotes = (it.quotes || []).map((q) => `<blockquote>“${esc(q.text)}”<footer>${esc(q.speaker || "Speaker")}${m.videoId && q.seconds != null ? ` · <a href="${yt(m.videoId, q.seconds)}" target="_blank" rel="noopener">watch at ${ts(q.seconds)}</a>` : ""}</footer></blockquote>`).join("");
  const parties = (it.parties || []).filter((p) => p.name);
  return `<article class="card item" id="item-${it.idx}">
    <div class="head"><h3>${esc(it.title)}</h3>${labelTag(it.label, m)}</div>
    ${it.officialTitle || it.docNumber ? `<div class="official">${esc(it.docNumber && !String(it.officialTitle).includes(it.docNumber) ? `${it.docNumber}: ` : "")}${esc(it.officialTitle)}</div>` : ""}
    <p>${esc(it.whatItIs)}</p>
    ${it.whyItMatters ? `<p class="muted">${esc(it.whyItMatters)}</p>` : ""}
    ${it.amount ? `<div class="amount">${exact(it.amount)}${it.fundingSource ? ` <span class="muted small" style="font-weight:500">from ${esc(it.fundingSource)}</span>` : ""}</div>` : ""}
    ${it.uncertain ? `<div class="uncertain">${esc(it.uncertain)}</div>` : ""}
    ${voteLine(it.vote, it)}
    ${quotes}
    ${it.notes?.length ? `<ul class="notes">${it.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
    ${parties.length ? `<div class="small muted">Involved: ${parties.map((p) => esc(p.name) + (p.role ? ` (${esc(p.role)})` : "")).join("; ")}</div>` : ""}
    ${it.nextStep?.text ? `<div class="next"><b>What's next:</b> ${esc(it.nextStep.text)}${it.nextStep.date ? ` (${esc(dt(it.nextStep.date, { month: "short", day: "numeric" }))})` : ""}${it.nextStep.publicCanSpeak ? ` <span class="tag hearing">Public can speak</span>` : ""}</div>` : ""}
    <div class="itemfoot">
      <span class="muted">${esc(stageText(it.stage))}</span>
      ${m.videoId && it.videoSeconds != null ? `<a href="${yt(m.videoId, it.videoSeconds)}" target="_blank" rel="noopener">Watch this part (${ts(it.videoSeconds)})</a>` : ""}
      ${it.issue ? `<a href="#/i/${esc(it.issue.key)}">Follow: ${esc(it.issue.title || "this issue")}</a>` : ""}
      <button class="linkbtn" data-report="${it.idx}">Report an error</button>
    </div>
  </article>`;
}

async function pageMeeting(id) {
  setNav("meetings");
  const m = await api({ view: "meeting", id });
  title(`${m.bodyName}, ${dt(m.date)}`);
  const att = m.attendance || {};
  const terms = Object.entries(m.glossary || {});
  view.innerHTML = `
    <p class="meta"><a href="#/meetings/${esc(m.body)}">${esc(m.bodyName)}</a></p>
    <h1>${esc(dLong(m.date))}</h1>
    ${m.upcoming ? upcomingCard(m.upcoming, { full: true }) : ""}
    ${m.summary ? `<p class="summary">${esc(m.summary)}</p>` : m.upcoming ? "" : `<p class="muted">This meeting's record is still being written up.</p>`}
    <div class="sources">
      ${m.videoId ? `<a class="btn" href="${yt(m.videoId)}" target="_blank" rel="noopener">Watch the video</a>` : ""}
      ${(m.moreVideoIds || []).map((v, i) => `<a class="btn" href="${yt(v)}" target="_blank" rel="noopener">Video part ${i + 2}</a>`).join("")}
      ${m.packetUrl ? `<a class="btn" href="${esc(m.packetUrl)}" target="_blank" rel="noopener">Agenda packet (PDF)</a>` : ""}
      ${m.minutesUrl ? `<a class="btn" href="${esc(m.minutesUrl)}" target="_blank" rel="noopener">${m.minutesKind === "next-packet" ? "Official minutes (in the next packet)" : "Official minutes (PDF)"}</a>` : ""}
    </div>
    ${att.present?.length || att.absent?.length ? `<p class="muted small">${att.present?.length ? `Present: ${esc(list(att.present))}. ` : ""}${att.absent?.length ? `<b>Absent: ${esc(list(att.absent))}.</b>` : ""}</p>` : ""}
    ${(m.references || []).map((r) => `<div class="card"><b>Reference:</b> <a href="#/budget/${esc(r.id || r)}">${esc(r.title || r.id || r)}</a></div>`).join("")}
    ${m.items.map((it) => itemCard(m, it)).join("")}
    ${m.held ? `<p class="held">${m.held} more item${m.held > 1 ? "s are" : " is"} being checked against the record and will appear here soon.</p>` : ""}
    ${m.role ? `<h2>About this board</h2><p class="muted">${esc(m.role)}</p>` : ""}
    ${terms.length ? `<h2>Words used here</h2><dl class="gloss">${terms.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join("")}</dl>` : ""}`;
  view.querySelectorAll("[data-report]").forEach((b) => b.addEventListener("click", () => openReport(m, m.items.find((i) => i.idx === +b.dataset.report))));
  const hash = location.hash.split("#item-")[1];
  if (hash) document.getElementById("item-" + hash)?.scrollIntoView();
}

async function pageIssues() {
  setNav("issues"); title("Issues");
  const d = await api({ view: "issues" });
  view.innerHTML = `<h1>Issues</h1><p class="muted">Each issue follows one matter (a project, an ordinance, a budget) through every meeting and board it passes through.</p>
    <div class="grid">${d.issues.map((i) => issueCard(i, d.bodies)).join("") || `<p class="muted">No issues yet.</p>`}</div>`;
}

async function pageIssue(key) {
  setNav("issues");
  const i = await api({ view: "issue", key });
  title(i.title);
  view.innerHTML = `<p class="meta"><a href="#/issues">Issues</a></p><h1>${esc(i.title)}</h1>
    <p class="muted">${i.count} step${i.count === 1 ? "" : "s"} since ${esc(dt(i.firstDate, { month: "long", day: "numeric", year: "numeric" }))}</p>
    ${i.coming.length ? `<h2>Coming up</h2>${i.coming.map((c) => `<a class="card" href="#/m/${esc(c.id)}"><div class="when">${esc(dt(c.date, { weekday: "short", month: "short", day: "numeric" }))}</div><div class="who">${esc(c.bodyName)}</div><ul class="agenda">${c.items.map((x) => `<li><span class="t">${esc(x.title)}</span>${x.publicHearing ? ` <span class="tag hearing">Public hearing</span>` : ""}<div class="small muted">${esc(x.step)}</div></li>`).join("")}</ul></a>`).join("")}` : ""}
    <h2>So far</h2>
    <ol class="timeline">${i.events.slice().reverse().map((e) => `<li>
      <div class="d">${esc(dt(e.date))} · ${esc(e.bodyName)}</div>
      <div><a href="#/m/${esc(e.meetingId)}#item-${e.idx}"><b>${esc(e.title)}</b></a> ${labelTag(e.label)}</div>
      ${e.whatItIs ? `<div class="muted">${esc(e.whatItIs)}</div>` : ""}
      <div class="small">${esc(stageText(e.stage))}${e.vote?.result && e.vote.result !== "no vote" ? ` · ${esc(e.vote.result)}` : ""}${e.vote?.no?.length ? ` · No: ${esc(list(e.vote.no))}` : ""}${e.amount ? ` · ${money(e.amount)}` : ""}${e.videoId && e.videoSeconds != null ? ` · <a href="${yt(e.videoId, e.videoSeconds)}" target="_blank" rel="noopener">watch</a>` : ""}</div>
    </li>`).join("")}</ol>
    ${i.nextStep?.text ? `<div class="next"><b>What's next:</b> ${esc(i.nextStep.text)}${i.nextStep.date ? ` (${esc(dt(i.nextStep.date, { month: "short", day: "numeric" }))})` : ""}</div>` : ""}`;
}

async function pageOfficials() {
  setNav("officials"); title("Officials");
  const d = await api({ view: "officials" });
  const by = {};
  for (const o of d.officials) (by[o.body] ||= []).push(o);
  view.innerHTML = `<h1>Officials</h1>
    <p class="muted">Attendance, motions and every vote where the record names them. Most votes on these boards are voice votes, where the minutes say only that a motion carried, so individual votes show up mainly on roll calls and when someone is heard voting no.</p>
    ${Object.entries(by).map(([b, os]) => `<h2>${esc(d.bodies[b].name)}</h2><div class="tablewrap"><table>
      <thead><tr><th>Member</th><th class="num">Meetings</th><th class="num">Absent</th><th class="num">Motions</th><th class="num">Recorded no votes</th></tr></thead>
      <tbody>${os.map((o) => `<tr><td><a href="#/o/${esc(b)}/${esc(o.slug)}"><b>${esc(o.name)}</b></a>${o.title ? `<div class="small muted">${esc(o.title)}${o.party ? ` · ${esc(o.party)}` : ""}</div>` : o.party ? `<div class="small muted">${esc(o.party)}</div>` : ""}</td><td class="num">${o.meetings}</td><td class="num">${o.absent}</td><td class="num">${o.motions}</td><td class="num">${o.no}</td></tr>`).join("")}</tbody></table></div>`).join("")}`;
}

async function pageOfficial(body, slug) {
  setNav("officials");
  const o = await api({ view: "official", body, slug });
  title(o.name);
  const named = o.votes.filter((v) => v.how);
  view.innerHTML = `<p class="meta"><a href="#/officials">Officials</a> · <span>${esc(o.bodyName)}</span></p>
    <h1>${esc(o.name)}</h1><p class="muted">${esc([o.title, o.party].filter(Boolean).join(" · "))}</p>
    <div class="stats">
      <div class="stat"><b>${o.meetings ? Math.round((1 - o.absent / o.meetings) * 100) : 0}%</b><span>of ${o.meetings} meetings attended</span></div>
      <div class="stat"><b>${o.motions}</b><span>motions made</span></div>
      <div class="stat"><b>${o.seconds}</b><span>motions seconded</span></div>
      <div class="stat"><b>${o.no}</b><span>recorded no votes</span></div>
    </div>
    ${o.absences.length ? `<p><b>Absent:</b> ${o.absences.map((a) => `<a href="#/m/${esc(a.meetingId)}">${esc(dt(a.date, { month: "short", day: "numeric", year: "numeric" }))}</a>`).join(", ")}</p>` : ""}
    <h2>On the record</h2>
    <p class="muted small">${named.length} named vote${named.length === 1 ? "" : "s"}. Voice votes where no one was heard objecting aren't listed by name.</p>
    ${o.votes.length ? `<div class="tablewrap"><table><thead><tr><th>Date</th><th>Item</th><th>Their part</th><th>Outcome</th></tr></thead><tbody>
      ${o.votes.map((v) => `<tr><td style="white-space:nowrap">${esc(dt(v.date, { month: "short", day: "numeric", year: "numeric" }))}</td><td><a href="#/m/${esc(v.meetingId)}#item-${v.idx}">${esc(v.title)}</a>${v.amount ? `<div class="small muted">${money(v.amount)}</div>` : ""}</td>
      <td>${[v.how === "no" ? "<b style='color:var(--no)'>Voted no</b>" : v.how === "yes" ? "Voted yes" : v.how === "abstain" ? "Abstained" : "", v.moved ? "Made the motion" : "", v.seconded ? "Seconded" : ""].filter(Boolean).join("<br>")}</td>
      <td>${esc(v.result || "")}${v.method ? `<div class="small muted">${esc(v.method)}</div>` : ""}</td></tr>`).join("")}
    </tbody></table></div>` : `<p class="muted">Nothing yet.</p>`}
    <h2>About this board</h2><p class="muted">${esc(o.role)}</p>`;
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
    const kind = r.type === "upcoming" ? `<span class="tag hearing">Coming up</span>` : r.type === "budget" ? `<span class="tag">Budget</span>` : labelTag(r.label);
    return `<a class="card" href="${href}"><div class="meta">${r.date ? `<b style="color:var(--ink)">${esc(dt(r.date))}</b>` : ""}${r.bodyName ? `<span>${esc(r.bodyName)}</span>` : ""}${kind}</div><h3 style="margin-top:6px">${hl(r.title)}</h3>${r.snippet ? `<p class="muted" style="margin:0">${hl(r.snippet)}</p>` : ""}${r.amount ? `<div class="amount">${money(r.amount)}</div>` : ""}</a>`;
  }).join("") : `<p class="muted">Nothing found for “${esc(q)}”.</p>`;
}

async function pageBudgets() {
  setNav("budget"); title("Budgets");
  const d = await api({ view: "refs" });
  view.innerHTML = `<h1>Budgets</h1><p class="muted">Adopted budgets, read from the official documents and checked to the dollar.</p>
    <div class="grid">${d.refs.map((r) => `<a class="card" href="#/budget/${esc(r.id)}"><h3>${esc(r.title)}</h3><div class="amount">${money(r.totals?.allFunds)}</div><div class="meta">${esc(r.docNumber || "")}${r.adopted ? ` · adopted ${esc(dt(r.adopted, { month: "short", day: "numeric", year: "numeric" }))}` : ""}</div></a>`).join("") || `<p class="muted">None yet.</p>`}</div>`;
}

async function pageBudget(id) {
  setNav("budget");
  const r = await api({ view: "ref", id });
  title(r.title);
  const t = r.totals || {}, tax = r.tax || {};
  const depts = (r.generalFundDepartments || []).slice().sort((a, b) => b.amount - a.amount);
  const max = Math.max(...depts.map((x) => x.amount), 1);
  const groups = {};
  for (const f of r.funds || []) (groups[f.group || "Other funds"] ||= []).push(f);
  view.innerHTML = `<p class="meta"><a href="#/budget">Budgets</a></p>
    <h1>${esc(r.title)}</h1>
    <p class="summary">${esc(r.summary)}</p>
    <p class="muted small">${esc(r.docNumber || "")}${r.adopted ? `, adopted ${esc(dLong(r.adopted))}` : ""}${r.adoptedBy ? `${r.adopted || r.docNumber ? " by the" : "Adopted by the"} ${esc(r.adoptedBy.replace(/^the /i, ""))}` : ""}.${r.meetingId ? ` <a href="#/m/${esc(r.meetingId)}">See the meeting</a>.` : ""}${r.source?.url ? ` <a href="${esc(r.source.url)}" target="_blank" rel="noopener">Source document</a>.` : ""}</p>
    <div class="stats">
      <div class="stat"><b>${money(t.allFunds)}</b><span>${esc(t.allFundsLabel || "all funds")}</span></div>
      <div class="stat"><b>${money(t.generalFund)}</b><span>General Fund (day-to-day services)</span></div>
      ${tax.rate ? `<div class="stat"><b>$${esc(tax.rate)}</b><span>property tax rate per $100 of assessed value</span></div>` : ""}
      ${tax.estimatedCapLossAllFunds ? `<div class="stat"><b>${money(Math.abs(tax.estimatedCapLossAllFunds))}</b><span>expected loss to state tax caps</span></div>` : ""}
    </div>
    ${(r.observations || []).length ? `<h2>What stands out</h2>${r.observations.map((o) => `<p>${esc(o.text || o)}${o.page ? ` <span class="muted small">(p. ${o.page})</span>` : ""}</p>`).join("")}` : ""}
    ${depts.length ? `<h2>Where the General Fund goes</h2><div class="tablewrap"><table><tbody>${depts.map((x) => `<tr><td>${esc(x.name)}</td><td class="bar-cell"><div class="hbar" style="width:${(x.amount / max) * 100}%"></div></td><td class="num">${exact(x.amount)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${Object.entries(groups).map(([g, fs]) => { const y = r.year, prev = fs.some((f) => f[`budget${y - 1}`] != null), cash = fs.some((f) => f[`cashEnd${y}`] != null); return `<h2>${esc(g)}</h2><div class="tablewrap"><table><thead><tr><th>Fund</th>${prev ? `<th class="num">${y - 1}</th>` : ""}<th class="num">${y} budget</th>${cash ? `<th class="num">Cash at end of ${y}</th>` : ""}</tr></thead><tbody>${fs.map((f) => `<tr><td>${esc(f.name)}${f.page ? ` <span class="small muted">p. ${f.page}</span>` : ""}</td>${prev ? `<td class="num muted">${exact(f[`budget${y - 1}`])}</td>` : ""}<td class="num">${exact(f.budget)}</td>${cash ? `<td class="num">${f[`cashEnd${y}`] != null ? exact(f[`cashEnd${y}`]) : ""}</td>` : ""}</tr>`).join("")}</tbody></table></div>`; }).join("")}
    ${r.history?.length ? `<h2>Over the years</h2><div class="tablewrap"><table><thead><tr><th>Year</th><th class="num">Budget</th><th class="bar-cell"></th><th class="num">Property tax levy</th></tr></thead><tbody>${r.history.slice().reverse().map((h) => `<tr><td>${h.year}</td><td class="num">${money(h.budget)}</td><td class="bar-cell"><div class="hbar" style="width:${(h.budget / Math.max(...r.history.map((x) => x.budget))) * 100}%"></div></td><td class="num">${money(h.levy)}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
}

function pageAbout() {
  setNav(""); title("How this works");
  view.innerHTML = `<h1>How this works</h1>
  <p>Local Meetings follows the boards that make the biggest decisions in Howard County and Kokomo: the County Council and Commissioners, the County Plan Commission, the Kokomo Common Council, Plan Commission, Board of Zoning Appeals and Board of Public Works and Safety.</p>
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
  reporting = { meetingId: m.id, idx: it?.idx ?? null };
  document.getElementById("reportWhat").textContent = `${m.bodyName}, ${dt(m.date)}${it ? `: ${it.title}` : ""}`;
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
function toast(msg) {
  const t = document.createElement("div");
  t.textContent = msg; t.setAttribute("role", "status");
  Object.assign(t.style, { position: "fixed", left: "50%", bottom: "24px", transform: "translateX(-50%)", background: "var(--ink)", color: "var(--paper)", padding: "10px 16px", borderRadius: "8px", zIndex: 20 });
  document.body.append(t); setTimeout(() => t.remove(), 3500);
}

// ---- router
async function route() {
  const [path] = location.hash.replace(/^#/, "").split("#item-");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  window.scrollTo(0, 0);
  try {
    if (!parts.length) await pageHome();
    else if (parts[0] === "meetings") await pageMeetings(parts[1]);
    else if (parts[0] === "m") await pageMeeting(parts[1]);
    else if (parts[0] === "issues") await pageIssues();
    else if (parts[0] === "i") await pageIssue(parts[1]);
    else if (parts[0] === "officials") await pageOfficials();
    else if (parts[0] === "o") await pageOfficial(parts[1], parts[2]);
    else if (parts[0] === "search") await pageSearch(parts[1] || "");
    else if (parts[0] === "budget" && parts[1]) await pageBudget(parts[1]);
    else if (parts[0] === "budget") await pageBudgets();
    else if (parts[0] === "about") pageAbout();
    else view.innerHTML = `<h1>Page not found</h1><p><a href="#/">Go to the home page</a></p>`;
  } catch (e) {
    view.innerHTML = e.status === 404 ? `<h1>Not found</h1><p class="muted">That page doesn't exist or isn't published yet.</p><p><a href="#/">Home</a></p>` : `<h1>Something went wrong</h1><p class="muted">${esc(e.message)}</p>`;
  }
}
addEventListener("hashchange", route);
route();
