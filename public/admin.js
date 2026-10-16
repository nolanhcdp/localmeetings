// localmeetings review screen.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
let CODE = store.get("vt-admin") || "";
let OV = null; // overview cache

const STAGES = ["introduced", "read", "public hearing", "adopted", "approved", "denied", "failed", "tabled", "continued", "discussed", "requested", "received", "withdrawn", "recommended favorably", "recommended unfavorably", "sent without recommendation"];
const CATEGORIES = ["spending", "transfer", "salaries", "taxes", "budget", "ordinance", "resolution", "contract", "purchase", "land use", "tax abatement", "appointment", "claims", "minutes", "report", "public comment", "board member business", "other"];
const METHODS = ["voice", "roll call", "consensus", "none", "unclear"];
const RESULTS = ["passed", "failed", "tabled", "no vote", "unclear"];
let BODY_NAMES = { council: "County Council", commissioners: "Commissioners", plan: "County Plan Comm." };
const setBodies = (bodies) => { if (bodies) BODY_NAMES = Object.fromEntries(Object.entries(bodies).map(([k, b]) => [k, b.short || b.name])); };

function toast(msg, ms = 2600) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms); }
const fmtDate = (d) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const clock = (s) => { s = Math.max(0, s | 0); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
const money = (n) => n == null || n === "" ? "" : Number(n).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 });

async function api(action, body = {}, path = "/api/admin") {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-admin-code": CODE }, body: JSON.stringify({ action, ...body }) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { showLogin("That code didn't work."); throw new Error("auth"); }
  if (!res.ok) throw new Error(data.error || (res.status === 504 ? "That took too long and the server cut it off (504). Try again; the next run picks up where this left off." : `Error ${res.status}`));
  return data;
}

function showLogin(err = "") { $("#login").hidden = false; $("#view").innerHTML = ""; $("#loginErr").textContent = err; }
$("#loginForm").addEventListener("submit", (e) => { e.preventDefault(); CODE = $("#codeInput").value.trim(); store.set("vt-admin", CODE); $("#login").hidden = true; route(); });

// ---------- Router
window.addEventListener("hashchange", route);
let ROUTE_N = 0;
const NAV_OF = (h) => h === "/" ? "today" : h.startsWith("/m/") || h === "/meetings" || h === "/videos" ? "meetings" : h.startsWith("/ref/") ? "library" : h.split("/")[1];
async function route() {
  if (!CODE) return showLogin();
  const h = location.hash.slice(1) || "/";
  const n = ++ROUTE_N;
  const nav = NAV_OF(h);
  document.querySelectorAll(".snav nav a").forEach((a) => a.classList.toggle("on", a.dataset.nav === nav));
  document.body.classList.remove("menu-open"); $("#menuBtn")?.setAttribute("aria-expanded", "false");
  const view = $("#view");
  try {
    if (h.startsWith("/m/")) await viewMeeting(decodeURIComponent(h.slice(3)));
    else if (h === "/meetings") await viewMeetings();
    else if (h === "/videos") await viewVideos();
    else if (h === "/issues") await viewIssues();
    else if (h === "/library") await viewLibrary();
    else if (h.startsWith("/ref/")) await viewRef(decodeURIComponent(h.slice(5)));
    else if (h === "/members") await viewMembers();
    else if (h === "/ask") await viewAskSettings();
    else if (h === "/alerts") await viewAlerts();
    else if (h === "/tools" || h === "/settings") await viewTools();
    else if (h === "/archive") await viewArchive();
    else if (h === "/posts") await viewPosts();
    else if (h === "/queue") await viewQueue();
    else if (h.startsWith("/research")) await viewResearch(h.split("/")[2] || "flags");
    else await viewToday();
  } catch (e) { if (e.message !== "auth" && n === ROUTE_N) view.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  refreshCounts();
}
// Sidebar counts (what needs you, post ideas), refreshed after every page
async function refreshCounts() {
  try {
    const c = await api("counts");
    const set = (k, v) => document.querySelectorAll(`[data-count="${k}"]`).forEach((el) => { el.textContent = v || ""; el.hidden = !v; });
    set("queue", c.needsYou); set("posts", c.ideas);
  } catch (e) {}
}
$("#menuBtn")?.addEventListener("click", () => { const on = document.body.classList.toggle("menu-open"); $("#menuBtn").setAttribute("aria-expanded", String(on)); });

// ---------- Today: the home page
const shortDay = (d) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const bodyRow = (body, title, meta, right = "") => `<div class="trow"><i class="tbar" style="background:${BOARD_COLOR[body] || "#888"}"></i><div class="tt"><b>${title}</b><span>${meta}</span></div><div class="tr">${right}</div></div>`;
async function viewToday() {
  const d = await api("today"); setBodies(d.bodies);
  const lr = d.lastRun, tick = d.lastTick;
  const runOk = lr && !(lr.errors || []).length;
  const stat = (n, label, href, hot) => `<a class="stat ${hot && n ? "hot" : ""}" href="${href}"><span class="big">${n}</span><span class="slbl">${label}</span></a>`;
  const rows = [];
  for (const h of d.held) rows.push(bodyRow(h.body, esc(h.title), `${esc(BODY_NAMES[h.body] || h.body)} · ${esc(shortDay(h.date))} · ${esc(h.reason)}`, `<span class="pill held">Held</span><a class="btn" href="#/queue">Review</a>`));
  if (d.reports) rows.push(bodyRow("", `${d.reports} error report${d.reports === 1 ? "" : "s"} from readers`, "Sent from “Report an error” on the site", `<a class="btn" href="#/queue">Read</a>`));
  for (const m of d.broken) rows.push(bodyRow(m.body, `${esc(BODY_NAMES[m.body] || m.body)}, ${esc(shortDay(m.date))}`, "The draft came back with no items", `<span class="pill bad">Problem</span><a class="btn" href="#/queue">See why</a>`));
  for (const m of d.check) rows.push(bodyRow(m.body, `${esc(BODY_NAMES[m.body] || m.body)}, ${esc(shortDay(m.date))}`, "Minutes posted, not checked against the draft yet", `<span class="pill wait">Minutes</span><button class="primary" data-check="${esc(m.id)}">Check (a few cents)</button>`));
  for (const m of d.problems) rows.push(bodyRow(m.body, `${esc(BODY_NAMES[m.body] || m.body)}, ${esc(shortDay(m.date))}`, esc(m.error || "Something went wrong"), `<span class="pill bad">Problem</span><a class="btn" href="#/m/${encodeURIComponent(m.id)}">Open</a>`));
  if (d.ready.length) rows.push(bodyRow("", `${d.ready.length} meeting${d.ready.length === 1 ? " is" : "s are"} ready to draft`, d.ready.map((m) => `${esc(BODY_NAMES[m.body] || m.body)} ${esc(shortDay(m.date))}`).join(" · "), `<a class="btn" href="#/meetings" data-filter="ready">See them</a>`));
  if (d.projectReviewCount) rows.push(bodyRow("", `${d.projectReviewCount} project grouping${d.projectReviewCount === 1 ? "" : "s"} to look at`, d.projectReview.map((r) => `${esc(r.title)} (${r.parts} parts)`).join(" · "), `<a class="btn" href="#/issues">Review</a>`));
  if (d.unsorted) rows.push(bodyRow("", `${d.unsorted} video${d.unsorted === 1 ? "" : "s"} need a meeting`, "Found on YouTube but not matched to a meeting", `<a class="btn" href="#/videos">Sort</a>`));
  const up = d.upcoming.map((m) => bodyRow(m.body, esc(m.bodyName), `${esc(shortDay(m.date))}${m.time ? ` · ${esc(m.time)}` : ""}${m.state === "previewed" ? ` · ${m.items} item${m.items === 1 ? "" : "s"}` : ""}`,
    m.cancelled ? `<span class="pill">Cancelled</span>` : m.maybeCanceled ? `<span class="pill wait">May be canceled</span>` : m.state === "previewed" ? `<span class="pill ok">Previewed</span>` : m.state === "agenda" ? `<span class="pill wait">Agenda posted</span>` : `<span class="pill">Waiting</span>`)).join("");
  $("#view").innerHTML = `<div class="phead"><div><h1>Today</h1>
      <div class="status"><span><i class="sdot ${lr ? (runOk ? "ok" : "bad") : ""}"></i>${lr ? `Daily run ${runOk ? "finished" : `had ${lr.errors.length} problem${lr.errors.length === 1 ? "" : "s"}`} ${esc(new Date(lr.at).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }))}` : "The daily run hasn't happened yet"}</span>${tick?.at ? `<span>Quick check ${esc(new Date(tick.at).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" }))}</span>` : ""}${d.askMonthCents != null ? `<span>Ask: ${cents(d.askMonthCents)} this month</span>` : ""}</div></div></div>
    <div class="stats">${stat(d.heldCount, "Items held for you", "#/queue", true)}${stat(d.reports, "Error reports", "#/queue", true)}${stat(d.check.length, "Minutes to check", "#/meetings", false)}${stat(d.ideaCount, "Post ideas", "#/posts", false)}</div>
    <div class="tcols">
      <section class="card"><h2>Needs you</h2>${rows.join("") || `<p class="muted">Nothing. Everything publishes on its own.</p>`}</section>
      <section class="card"><h2>Coming up</h2>${up || `<p class="muted">Nothing in the next week.</p>`}
        ${d.ideas.length ? `<h2 style="margin-top:1.4rem">Worth posting</h2>${d.ideas.map((x) => `<div class="trow"><div class="tt"><b>${esc(x.title)}</b><span>${esc(x.label)} · ${esc(x.why)}</span></div><div class="tr"><a class="btn" href="#/posts">${x.drafted ? "Open" : "Draft"}</a></div></div>`).join("")}` : ""}</section>
    </div>`;
  document.querySelectorAll("[data-filter]").forEach((a) => a.onclick = () => { FILTER = a.dataset.filter; store.set("vt-filter2", FILTER); });
  document.querySelectorAll("[data-check]").forEach((b) => b.onclick = async () => {
    b.disabled = true; b.textContent = "Checking… about a minute";
    try { const r = await api("", { id: b.dataset.check, kind: "check" }, "/api/draft"); toast(`Checked: ${r.check.matched} match, ${r.check.conflicts} held for you.`, 5000); viewToday(); }
    catch (e) { toast(e.message, 6000); b.disabled = false; b.textContent = "Try again"; }
  });
}

// ---------- Meetings list
let FILTER = store.get("vt-filter2") || "live";
let BODYF = store.get("vt-body") || "";
async function viewMeetings() {
  OV = await api("overview"); setBodies(OV.bodies);
  const ms = OV.meetings.filter((m) => !BODYF || m.body === BODYF);
  const isLive = (m) => (m.status === "drafted" || m.status === "approved") && !m.unpublished;
  const F = {
    live: (m) => isLive(m), held: (m) => (m.labels?.held || 0) > 0, check: (m) => m.needsCheck,
    problems: (m) => m.status === "error" || !!m.previewError, ready: (m) => m.ready, upcoming: (m) => m.date >= new Date().toISOString().slice(0, 10),
    waiting: (m) => m.status === "waiting" && !m.ready && m.date < new Date().toISOString().slice(0, 10), all: () => true,
  };
  const counts = Object.fromEntries(Object.entries(F).map(([k, f]) => [k, ms.filter(f).length]));
  const toFill = OV.meetings.filter((m) => m.needsEnrich || m.needsCheck);
  counts.fill = toFill.length;
  if (!F[FILTER]) FILTER = "live";
  const show = ms.filter(F[FILTER]);
  const unsorted = OV.videos.filter((v) => !v.meetingId && !["other", "budget"].includes(v.body)).length;
  const lr = OV.lastRun;
  $("#view").innerHTML = `
    <div class="toolbar">
      <div>
        <h1>Meetings</h1>
        <div class="meta">${lr ? `Last daily run ${new Date(lr.at).toLocaleString()}${lr.errors?.length ? ` · <span class="err">${lr.errors.length} problem(s)</span>` : ""}` : "The daily run hasn't happened yet."}${OV.lastTick?.at ? ` · Last quick check ${new Date(OV.lastTick.at).toLocaleString()}${OV.lastTick.calendar?.cityError ? ` · <span class="err">City calendar: ${esc(OV.lastTick.calendar.cityError)}</span>` : ""}` : ""}</div>
      </div>
      <div class="actions">
        ${counts.fill ? `<button id="fillOld" class="primary" title="Uses the Claude API">Fill in older meetings (${counts.fill})</button>` : ""}
        <button id="scan" title="Checks the calendars and both document pages, and previews every upcoming meeting that has a new agenda">Check now</button>
        <button id="draftAll" class="primary" ${counts.ready ? "" : "disabled"}>Draft all ready (${counts.ready})</button>
      </div>
    </div>
    <div class="filter" style="margin-bottom:.8rem">
      <select id="bodyF" style="width:auto"><option value="">All boards</option>${Object.entries(BODY_NAMES).map(([k, n]) => `<option value="${k}" ${k === BODYF ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>
      ${unsorted ? `<a class="btn" href="#/videos">Unsorted videos (${unsorted})</a>` : ""}${[["live", "Live"], ["held", "Has held items"], ["check", "Minutes to check"], ["upcoming", "Upcoming"], ["ready", "Ready to draft"], ["problems", "Problems"], ["waiting", "Waiting on sources"], ["all", "All"]].map(([k, l]) => `<button data-f="${k}" class="${FILTER === k ? "on" : ""}">${l} (${counts[k]})</button>`).join("")}
    </div>
    <p id="progress" class="meta"></p>
    ${show.length ? `<table><thead><tr><th>Date</th><th>Body</th><th>Sources</th><th>Status</th><th></th></tr></thead><tbody>
      ${show.map((m) => `<tr>
        <td>${fmtDate(m.date)}</td>
        <td><span class="bname"><i class="bdot" style="background:${BOARD_COLOR[m.body] || "#888"}"></i>${esc(BODY_NAMES[m.body] || m.body)}</span></td>
        <td class="src">${src("Agenda", m.hasPacket, OV.bodies?.[m.body]?.docs === null)}${src("Minutes", m.hasMinutes, OV.bodies?.[m.body]?.docs === null)}${m.hasVideo && !m.hasTranscript ? `<span class="no" title="Video found, transcript not in yet. The Mac job retries each morning.">Video, no transcript yet</span>` : src("Video", m.hasVideo)}</td>
        <td>${statusText(m)}</td>
        <td style="text-align:right">${m.ready ? `<button data-draft="${m.id}">Draft</button> ` : ""}${m.status === "drafted" || m.status === "approved" || m.status === "error" ? `<a class="btn" href="#/m/${encodeURIComponent(m.id)}">Open</a>` : ""}${m.needsCheck ? ` <button data-check="${m.id}" title="Have Claude compare this draft with the official minutes (API, a few cents)">Check minutes</button>` : ""}${m.needsPreview || m.previewError ? ` <button data-preview="${m.id}" title="Have Claude read the agenda packet (API)">Preview</button>` : ""}</td>
      </tr>`).join("")}
    </tbody></table>` : `<p class="muted">Nothing here.</p>`}`;
  $("#bodyF").onchange = (e) => { BODYF = e.target.value; store.set("vt-body", BODYF); viewMeetings(); };
  document.querySelectorAll("[data-f]").forEach((b) => b.onclick = () => { FILTER = b.dataset.f; store.set("vt-filter2", FILTER); viewMeetings(); });
  document.querySelectorAll("[data-draft]").forEach((b) => b.onclick = () => draftMany([b.dataset.draft]));
  document.querySelectorAll("[data-check],[data-preview]").forEach((b) => b.onclick = async () => {
    const kind = b.dataset.check ? "check" : "preview", id = b.dataset.check || b.dataset.preview;
    b.disabled = true; b.textContent = "Working… about a minute";
    try { const r = await api("", { id, kind }, "/api/draft"); toast(kind === "check" ? `Checked: ${r.check.matched} match, ${r.check.conflicts} held for you.` : `Preview ready (${r.items} items).`, 5000); viewMeetings(); }
    catch (e) { toast(e.message, 6000); b.disabled = false; b.textContent = "Try again"; }
  });
  $("#draftAll").onclick = () => draftMany(ms.filter((m) => m.ready).sort((a, b) => a.date.localeCompare(b.date)).map((m) => m.id));
  if ($("#fillOld")) $("#fillOld").onclick = () => fillOlder(toFill);
  $("#scan").onclick = async () => {
    $("#scan").disabled = true; $("#scan").textContent = "Checking… up to a couple of minutes";
    try {
      const r = await fetch("/api/tick", { headers: { "x-admin-code": CODE } }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      toast(`Calendars: ${r.calendar?.created || 0} new scheduled meetings${r.calendar?.missing ? `, ${r.calendar.missing} may be canceled` : ""}. Documents: ${r.scan?.created?.length || 0} new. Previewed: ${r.previewed?.length || 0}. Drafted: ${r.drafted?.length || 0}.${r.errors?.length ? " Problems: " + r.errors.join("; ") : ""}${r.calendar?.cityError ? " City calendar: " + r.calendar.cityError : ""}`, 9000);
      viewMeetings();
    } catch (e) { toast(e.message, 6000); $("#scan").disabled = false; $("#scan").textContent = "Check now"; }
  };
}
const src = (label, ok, na) => na ? `<span class="no" title="Not posted online for this body">${label} n/a</span>` : `<span class="${ok ? "yes" : "no"}">${label} ${ok ? "✓" : "–"}</span>`;
const LBL = { confirmed: "confirmed", video: "from video", unclear: "unclear", held: "held", hidden: "hidden" };
const labelSummary = (l = {}) => Object.entries(LBL).filter(([k]) => l[k]).map(([k, t]) => `<span class="lbl l-${k}">${l[k]} ${t}</span>`).join(" ");
function statusText(m) {
  if (m.status === "drafted" || m.status === "approved") return `${m.unpublished ? `<span class="status-error">Off the public site</span>` : `<span class="status-approved">Live</span>`}${m.status === "approved" ? ` <span class="meta">(you approved)</span>` : ""} ${labelSummary(m.labels)}${m.needsCheck ? ` <span class="meta">· minutes posted, not checked yet</span>` : ""}${m.videoArrivedAfterDraft ? ` <span class="meta">· video now in</span>` : ""}`;
  if (m.status === "error") return `<span class="status-error">Problem:</span> <span class="meta">${esc(m.error)}</span>`;
  if (m.status === "drafting") return "Drafting…";
  if (m.status === "skipped") return `<span class="muted">Skipped</span>`;
  if (m.previewError) return `<span class="status-error">Preview problem:</span> <span class="meta">${esc(m.previewError)}</span>`;
  if (m.cancelled) return `<span class="muted">Canceled</span>`;
  if (m.hasPreview) return `<span class="status-drafted">Preview live</span>`;
  if (m.date >= new Date().toISOString().slice(0, 10) && m.scheduled) return `${m.hasPacket ? `<span class="status-drafted">Agenda posted, preview next check</span>` : `<span class="muted">Scheduled${m.scheduled.time ? ` ${esc(m.scheduled.time)}` : ""}${m.scheduled.estimated ? " (usual schedule)" : ""}</span>`}${m.scheduled.missing ? ` <span class="err">dropped off the city calendar</span>` : ""}`;
  return m.ready ? "Ready to draft" : `<span class="muted">Waiting</span>`;
}

async function draftMany(ids) {
  const p = $("#progress");
  document.querySelectorAll("button").forEach((b) => (b.disabled = true));
  let done = 0, failed = [];
  for (const id of ids) {
    p.textContent = `Drafting ${id.replace(/-/, " ")} (${done + 1} of ${ids.length}). Each takes about a minute; keep this tab open.`;
    try { await api("", { id }, "/api/draft"); } catch (e) { failed.push(`${id}: ${e.message}`); }
    done++;
  }
  toast(failed.length ? `${done - failed.length} drafted, ${failed.length} failed.` : `${done} drafted.`, 5000);
  FILTER = "live"; store.set("vt-filter2", FILTER);
  await viewMeetings();
  if (failed.length) $("#progress").innerHTML = `<span class="err">${failed.map(esc).join("<br>")}</span>`;
}

// Held / hidden banner on an item in the editor
function itemBanner(it, i) {
  if (it.hidden) return `<div class="hold"><strong>Hidden from the public site.</strong> <button data-resolve="${i}:unhide">Show it</button></div>`;
  const held = (it.hold && !it.released) || (!CUR.meeting.draftMeta?.schema && it.confidence === "low" && /(disagree|conflict|contradict|mismatch|differ|inconsisten)/i.test(it.checkNote || "") && !it.released && CUR.meeting.status !== "approved");
  if (!held) return it.verified === "minutes" ? `<div class="meta">✓ Matches the official minutes</div>` : "";
  const f = it.minutesFix;
  return `<div class="hold"><strong>Held off the public site:</strong> ${esc(it.hold?.reason || it.checkNote || "the sources disagree")}
    ${f ? `<div class="meta">Minutes version: ${esc([f.result, f.yes?.length && "yes: " + f.yes.join(", "), f.no?.length && "no: " + f.no.join(", "), f.amount != null && money(f.amount), f.motionBy && "moved by " + f.motionBy].filter(Boolean).join(" · "))}</div>` : ""}
    <div class="actions" style="margin-top:.4rem">${f ? `<button class="primary" data-resolve="${i}:minutes">Use the minutes' version</button>` : ""}<button data-resolve="${i}:publish">Publish as written</button><button data-resolve="${i}:hide" class="danger">Keep it off</button></div></div>`;
}

// Older drafts: fill in companies/money/flags (text only, ~2-3¢ each), then check against minutes where they're out (~5-15¢ each).
async function fillOlder(list) {
  const nE = list.filter((m) => m.needsEnrich).length, nC = list.filter((m) => m.needsCheck).length;
  const est = (nE * 3 + nC * 12) / 100;
  if (!confirm(`This uses the Claude API.\n\n${nE} meetings get companies, money and research flags filled in (about 2-3¢ each).\n${nC} meetings get checked against their official minutes (about 5-15¢ each).\n\nEstimated total: about $${Math.max(0.5, est).toFixed(2)}. You'll see the real cost as it goes. Keep this tab open; you can close it to stop.`)) return;
  const p = $("#progress");
  document.querySelectorAll(".toolbar button").forEach((b) => (b.disabled = true));
  let spent = 0, done = 0, failed = [], held = 0;
  const jobs = [...list.filter((m) => m.needsEnrich).map((m) => [m.id, "enrich"]), ...list.filter((m) => m.needsCheck).sort((a, b) => b.date.localeCompare(a.date)).map((m) => [m.id, "check"])];
  for (const [id, kind] of jobs) {
    p.textContent = `${kind === "enrich" ? "Filling in" : "Checking minutes for"} ${id.replace(/-(\d{4})/, " $1")} (${done + 1} of ${jobs.length}) · spent so far $${(spent / 100).toFixed(2)}`;
    try { const r = await api("", { id, kind }, "/api/draft"); spent += r.cents || 0; if (r.check?.conflicts) held += r.check.conflicts; } catch (e) { failed.push(`${id} (${kind}): ${e.message}`); }
    done++;
  }
  toast(`Done: ${done - failed.length} of ${jobs.length} · spent $${(spent / 100).toFixed(2)}${held ? ` · ${held} item(s) held for you in Needs you` : ""}`, 9000);
  await viewMeetings();
  $("#progress").innerHTML = `Last run spent $${(spent / 100).toFixed(2)}.${held ? ` <a href="#/queue">${held} item(s) held for you</a>.` : ""}${failed.length ? `<br><span class="err">${failed.map(esc).join("<br>")}</span>` : ""}`;
}

// ---------- Review one meeting
let CUR = null; // { meeting, record, video, lines }
async function viewMeeting(id) {
  const data = await api("meeting", { id });
  setBodies(data.bodies);
  const m = data.meeting;
  const record = structuredClone(m.status === "approved" ? m.record : m.draft) || { summary: "", attendance: { present: [], absent: [] }, items: [] };
  CUR = { meeting: m, record, video: data.video, lines: null, glossary: data.glossary, dirty: false };
  if (!OV) OV = await api("overview");
  const issues = (await api("issues")).issues;
  const dm = m.draftMeta || {};
  $("#view").innerHTML = `
    <p><a href="#/meetings">← Meetings</a></p>
    <div class="review">
      <div>
        <h1>${BODY_NAMES[m.body]} · ${fmtDate(m.date)}</h1>
        <p class="meta">
          ${m.status === "approved" ? `<span class="status-approved">Approved ${new Date(m.approvedAt).toLocaleDateString()}</span> · ` : ""}
          Drafted from: ${[dm.hadPacket && "agenda packet", dm.hadMinutes && "official minutes", dm.hadVideo && "video"].filter(Boolean).join(", ") || "—"}
          ${m.packetUrl ? ` · <a href="${esc(m.packetUrl)}" target="_blank" rel="noopener">Agenda packet</a>` : ""}
          ${m.minutesUrl ? ` · <a href="${esc(m.minutesUrl)}" target="_blank" rel="noopener">${m.minutesDate && m.minutesDate !== m.date ? `Minutes (in ${fmtDate(m.minutesDate)} packet)` : `Minutes${m.minutesName && /draft/i.test(m.minutesName) ? " (draft)" : ""}`}</a>` : ""}
          ${m.packetError ? ` · <span class="err">${esc(m.packetError)}</span>` : ""}
          ${dm.truncated ? ` · <span class="err">Draft was cut off; consider redrafting.</span>` : ""}
          ${dm.imported ? ` · Imported draft` : ""}
          ${(m.references || []).map((r) => ` · <a href="#/ref/${encodeURIComponent(r)}">Reference: ${esc(r)}</a>`).join("")}
        </p>
        ${m.minutesArrivedAfterDraft ? `<div class="check">Official minutes were posted after this draft. Redraft to fold them in${m.edited ? " (this replaces your edits)" : ""}.</div>` : ""}
        ${m.videoArrivedAfterDraft ? `<div class="check">The video arrived after this draft. Redraft to add votes and quotes from it${m.edited ? " (this replaces your edits)" : ""}.</div>` : ""}
        <div class="card grid">
          <div><label>Summary</label><textarea data-k="summary" rows="5">${esc(record.summary)}</textarea></div>
          <div class="split">
            <div><label>Present</label><input data-k="attendance.present" value="${esc((record.attendance?.present || []).join(", "))}"></div>
            <div><label>Absent</label><input data-k="attendance.absent" value="${esc((record.attendance?.absent || []).join(", "))}"></div>
          </div>
          ${record.newTerms?.length ? `<details><summary>New terms Claude explained (${record.newTerms.length})</summary>${record.newTerms.map((t) => `<p><strong>${esc(t.term)}</strong>: ${esc(t.plain)}</p>`).join("")}</details>` : ""}
        </div>
        <datalist id="issueKeys">${issues.map((i) => `<option value="${esc(i.key)}">${esc(i.title)}</option>`).join("")}</datalist>
        <div class="ibar"><h2>Items (${(record.items || []).length})</h2><span class="actions"><button class="linkish" id="openAll">Open all</button><button class="linkish" id="shutAll">Close all</button></span></div>
        <div id="items"></div>
        <p><button id="addItem">Add an item</button></p>
        <div class="stickybar actions">
          ${m.status === "approved"
            ? `<button id="saveBtn" class="primary">Save changes</button><button id="unapprove">Move back to drafts</button>`
            : `<button id="saveBtn" class="primary">Save</button><button id="approveBtn" title="Marks every item confirmed on the public site">Approve all as confirmed</button>`}
          <button id="redraft">Redraft with Claude</button>
          <button id="pubToggle">${m.unpublished ? "Put back on the public site" : "Take off the public site"}</button>
          <a class="btn" href="/#/m/${encodeURIComponent(m.id)}" target="_blank" rel="noopener">See it public ↗</a>
          ${m.status !== "approved" ? `<button id="skip" class="danger">Skip this meeting</button>` : ""}
          <span id="saveState" class="meta"></span>
        </div>
      </div>
      <aside class="side">
        ${m.videoId ? `<iframe id="player" class="video" src="https://www.youtube-nocookie.com/embed/${esc(m.videoId)}" allow="autoplay; encrypted-media" allowfullscreen></iframe>
          <div class="meta">${esc(data.video?.title || "")} · <a href="https://www.youtube.com/watch?v=${esc(m.videoId)}" target="_blank" rel="noopener">YouTube</a>${(m.moreVideoIds || []).map((id, i) => ` · <a href="https://www.youtube.com/watch?v=${esc(id)}" target="_blank" rel="noopener">Part ${i + 2}</a>`).join("")}</div>
          <input id="txSearch" placeholder="Search the transcript">
          <div id="tx" class="tx card"><p class="muted">Loading transcript…</p></div>`
          : `<div class="card muted">No video attached. If it's on YouTube, attach it from <a href="#/videos">Unsorted videos</a> or use the browser button.</div>`}
      </aside>
    </div>`;
  CUR.open = null;
  renderItems();
  CUR.open = new Set([...document.querySelectorAll("#items .item:not(.shut)")].map((el) => +el.dataset.i));
  $("#openAll").onclick = () => { CUR.open = new Set((CUR.record.items || []).map((_, i) => i)); renderItems(); };
  $("#shutAll").onclick = () => { CUR.open = new Set(); renderItems(); };
  $("#items").addEventListener("click", (e) => { const t = e.target.closest("[data-toggle]"); if (!t) return; const i = +t.dataset.toggle; CUR.open.has(i) ? CUR.open.delete(i) : CUR.open.add(i); const card = t.closest(".item"); card.classList.toggle("shut"); $(".caret", t).textContent = card.classList.contains("shut") ? "▸" : "▾"; });
  $("#view").addEventListener("input", (e) => { if (e.target.matches("[data-k]") && !e.target.closest("#items")) { setPath(CUR.record, e.target.dataset.k, e.target.value); markDirty(); } });
  $("#addItem").onclick = () => { CUR.record.items.push({ title: "New item", whatItIs: "", category: "other", stage: "discussed", vote: { method: "none", result: "no vote" }, confidence: "high", sources: [] }); CUR.open.add(CUR.record.items.length - 1); renderItems(); markDirty(); };
  $("#saveBtn").onclick = () => save(false);
  if ($("#approveBtn")) $("#approveBtn").onclick = () => save(true);
  if ($("#unapprove")) $("#unapprove").onclick = async () => { await api("unapprove", { id: m.id }); toast("Moved back to drafts."); viewMeeting(m.id); };
  if ($("#skip")) $("#skip").onclick = async () => { if (!confirm("Skip this meeting? It won't be drafted or published. You can undo this from All.")) return; await api("skip", { id: m.id }); location.hash = "#/meetings"; };
  $("#pubToggle").onclick = async () => { await api("publishMeeting", { id: m.id, on: !!m.unpublished }); toast(m.unpublished ? "Back on the public site." : "Taken off the public site."); viewMeeting(m.id); };
  $("#items").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-resolve]"); if (!b) return;
    if (CUR.dirty && !confirm("You have unsaved edits on this page. They'll be lost. Continue?")) return;
    const [idx, what] = b.dataset.resolve.split(":");
    await api("resolve", { id: m.id, idx: +idx, do: what }); CUR.dirty = false;
    toast(what === "hide" ? "Kept off the public site." : "Published."); viewMeeting(m.id);
  });
  $("#redraft").onclick = async () => {
    if (CUR.dirty || m.edited) { if (!confirm("Redrafting replaces this draft and your edits. Continue?")) return; }
    $("#redraft").disabled = true; $("#redraft").textContent = "Drafting… about a minute";
    try { await api("", { id: m.id }, "/api/draft"); toast("New draft ready."); viewMeeting(m.id); } catch (e) { toast(e.message, 6000); $("#redraft").disabled = false; $("#redraft").textContent = "Redraft with Claude"; }
  };
  if (m.videoId) loadTranscript(m.videoId);
  window.onbeforeunload = () => (CUR?.dirty ? true : undefined);
}

function setPath(obj, path, val) {
  const keys = path.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) { o[keys[i]] ??= {}; o = o[keys[i]]; }
  const last = keys[keys.length - 1];
  if (/^(present|absent|yes|no|abstain|sources|terms)$/.test(last)) o[last] = val.split(",").map((s) => s.trim()).filter(Boolean);
  else if (last === "notes") o[last] = val.split("\n").map((s) => s.trim()).filter(Boolean);
  else if (last === "parties") o[last] = val.split("\n").map((s) => s.trim()).filter(Boolean).map((s) => { const [name, role] = s.split(/\s+[—–-]\s+/); return { name: name.trim(), role: (role || "").trim() }; });
  else if (last === "flags") { const old = o.flags || []; o[last] = val.split("\n").map((s) => s.trim()).filter(Boolean).map((text) => old.find((f) => f.text === text) || { kind: "other", text }); }
  else if (last === "amount" || last === "videoSeconds") o[last] = val === "" ? null : Number(String(val).replace(/[$,]/g, ""));
  else if (last === "publicCanSpeak") o[last] = !!val;
  else o[last] = val;
}
const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
function markDirty() { CUR.dirty = true; $("#saveState").textContent = "Unsaved changes"; }

function renderItems() {
  const box = $("#items");
  const items = CUR.record.items || [];
  const sel = (path, opts, val) => `<select data-p="${path}">${opts.map((o) => `<option ${o === val ? "selected" : ""}>${o}</option>`).join("")}</select>`;
  box.innerHTML = items.map((it, i) => {
    const v = it.vote || {};
    const flagged = !!(it.hold || it.holdReason || it.checkNote || it.confidence === "low");
    const open = CUR.open?.has(i) ?? flagged;
    const res = it.vote?.result || "";
    return `<div class="card item ${open ? "" : "shut"}" data-i="${i}">
      <div class="head">
        <h3 class="itoggle" data-toggle="${i}"><span class="caret">${open ? "▾" : "▸"}</span>${i + 1}. ${esc(it.title)}</h3>
        <span class="imeta">${it.amount != null && it.amount !== "" ? `<span class="pill">${money(it.amount)}</span>` : ""}${res ? `<span class="pill ${res === "passed" ? "ok" : res === "failed" ? "bad" : ""}">${esc(it.stage || res)}</span>` : ""}${flagged ? `<span class="pill held">Check</span>` : ""}</span>
        <div class="actions">
          ${it.videoSeconds != null && CUR.meeting.videoId ? `<button data-seek="${it.videoSeconds}">▶ ${clock(it.videoSeconds)}</button>` : ""}
          <button data-up="${i}" title="Move up">↑</button>
          <button data-del="${i}" class="danger" title="Remove item">Remove</button>
        </div>
      </div>
      ${itemBanner(it, i)}
      ${it.checkNote || it.confidence === "low" ? `<div class="check"><strong>Note${it.confidence === "low" ? " (shown publicly)" : ""}:</strong> ${esc(it.checkNote || "Low confidence.")} <span class="meta">(confidence: ${esc(it.confidence)})</span></div>` : ""}
      <div class="grid ibody">
        <div class="row">
          <div class="grow"><label>Title</label><input data-p="title" value="${esc(it.title)}"></div>
          <div><label>Number</label><input data-p="docNumber" value="${esc(it.docNumber)}"></div>
        </div>
        <div class="row">
          <div><label>Category</label>${sel("category", CATEGORIES, it.category)}</div>
          <div><label>What happened</label>${sel("stage", STAGES, it.stage)}</div>
          <div><label>Amount</label><input data-p="amount" value="${it.amount ?? ""}" placeholder="$"></div>
        </div>
        <div><label>What it is</label><textarea data-p="whatItIs" rows="3">${esc(it.whatItIs)}</textarea></div>
        <div><label>Why it matters</label><textarea data-p="whyItMatters" rows="2">${esc(it.whyItMatters)}</textarea></div>
        <div class="row">
          <div><label>Vote</label>${sel("vote.method", METHODS, v.method)}</div>
          <div><label>Result</label>${sel("vote.result", RESULTS, v.result)}</div>
          <div><label>Motion by</label><input data-p="motionBy" value="${esc(it.motionBy)}"></div>
          <div><label>Second</label><input data-p="secondBy" value="${esc(it.secondBy)}"></div>
        </div>
        <div class="row">
          <div><label>Voted yes (only if recorded)</label><input data-p="vote.yes" value="${esc((v.yes || []).join(", "))}"></div>
          <div><label>Voted no</label><input data-p="vote.no" value="${esc((v.no || []).join(", "))}"></div>
          <div><label>Abstained</label><input data-p="vote.abstain" value="${esc((v.abstain || []).join(", "))}"></div>
        </div>
        <div><label>How the vote was taken</label><input data-p="vote.note" value="${esc(v.note)}"></div>
        <div class="row">
          <div><label>Issue key (links meetings together)</label><input data-p="issue.key" list="issueKeys" value="${esc(it.issue?.key)}"></div>
          <div class="grow"><label>Issue title</label><input data-p="issue.title" value="${esc(it.issue?.title)}"></div>
        </div>
        <div class="row">
          <div class="grow"><label>What happens next</label><input data-p="nextStep.text" value="${esc(it.nextStep?.text)}"></div>
          <div><label>Date</label><input data-p="nextStep.date" type="date" value="${esc(it.nextStep?.date)}"></div>
          <div><label><input type="checkbox" data-p="nextStep.publicCanSpeak" ${it.nextStep?.publicCanSpeak ? "checked" : ""} style="width:auto"> Public can speak</label></div>
        </div>
        <div class="row">
          <div class="grow"><label>Who gets the money or benefit</label><input data-p="recipient" value="${esc(it.recipient)}"></div>
          <div class="grow"><label>Paid from</label><input data-p="fundingSource" value="${esc(it.fundingSource)}"></div>
        </div>
        <div><label>Companies, developers, attorneys involved (one per line: Name — role)</label><textarea data-p="parties" rows="${Math.max(2, (it.parties || []).length + 1)}">${esc((it.parties || []).map((x) => x.role ? `${x.name} — ${x.role}` : x.name).join("\n"))}</textarea></div>
        <div><label>Research flags, internal only (one per line)</label><textarea data-p="flags" rows="${Math.max(2, (it.flags || []).length + 1)}">${esc((it.flags || []).map((f) => f.text).join("\n"))}</textarea></div>
        <div><label>Notes for organizers (one per line)</label><textarea data-p="notes" rows="${Math.max(2, (it.notes || []).length + 1)}">${esc((it.notes || []).join("\n"))}</textarea></div>
        ${it.quotes?.length ? `<details><summary>Quotes (${it.quotes.length})</summary>${it.quotes.map((q, qi) => `<div class="quote">“${esc(q.text)}”${q.speaker ? ` <span class="meta">— ${esc(q.speaker)}</span>` : ""} ${q.seconds != null && CUR.meeting.videoId ? `<button data-seek="${q.seconds}">▶ ${clock(q.seconds)}</button>` : ""} <button data-delq="${i}:${qi}" class="danger">Remove</button></div>`).join("")}</details>` : ""}
        <div class="meta">Sources: ${esc((it.sources || []).join(", ") || "—")}${it.terms?.length ? ` · Explained terms: ${esc(it.terms.join(", "))}` : ""}</div>
      </div>
    </div>`;
  }).join("");
  box.oninput = box.onchange = (e) => {
    const card = e.target.closest("[data-i]"); if (!card || !e.target.dataset.p) return;
    const it = CUR.record.items[+card.dataset.i];
    const p = e.target.dataset.p;
    if (p.startsWith("issue.") && it.issue == null) it.issue = {};
    if (p.startsWith("nextStep.") && it.nextStep == null) it.nextStep = {};
    setPath(it, p, e.target.type === "checkbox" ? e.target.checked : e.target.value);
    if (p === "title") card.querySelector("h3").textContent = `${+card.dataset.i + 1}. ${e.target.value}`;
    markDirty();
  };
  box.onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.seek) seek(+b.dataset.seek);
    if (b.dataset.del) { if (!confirm("Remove this item?")) return; CUR.record.items.splice(+b.dataset.del, 1); renderItems(); markDirty(); }
    if (b.dataset.up) { const i = +b.dataset.up; if (i > 0) { const a = CUR.record.items; [a[i - 1], a[i]] = [a[i], a[i - 1]]; renderItems(); markDirty(); } }
    if (b.dataset.delq) { const [i, qi] = b.dataset.delq.split(":").map(Number); CUR.record.items[i].quotes.splice(qi, 1); renderItems(); markDirty(); }
  };
}

async function save(andApprove) {
  const m = CUR.meeting;
  const btns = document.querySelectorAll(".stickybar button"); btns.forEach((b) => (b.disabled = true));
  try {
    for (const it of CUR.record.items) if (it.issue && !it.issue.key) it.issue = null;
    if (andApprove) {
      await api("approve", { id: m.id, record: CUR.record });
      CUR.dirty = false;
      toast("Approved: every item shows as confirmed.");
      viewMeeting(m.id);
    } else {
      await api("save", { id: m.id, record: CUR.record });
      CUR.dirty = false; $("#saveState").textContent = "Saved"; toast("Saved.");
    }
  } catch (e) { toast(e.message, 6000); }
  btns.forEach((b) => (b.disabled = false));
}

function seek(sec) {
  const f = $("#player"); if (!f) return;
  f.src = `https://www.youtube-nocookie.com/embed/${CUR.meeting.videoId}?start=${Math.max(0, sec - 3)}&autoplay=1`;
}
async function loadTranscript(videoId) {
  const { lines } = await api("transcript", { videoId });
  CUR.lines = lines;
  const draw = (q = "") => {
    const re = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig") : null;
    const rows = re ? lines.filter(([, s]) => re.test(s) && ((re.lastIndex = 0), true)) : lines;
    $("#tx").innerHTML = rows.length ? rows.map(([t, s]) => `<p data-t="${t}"><time>${clock(t)}</time>${re ? esc(s).replace(new RegExp(esc(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), (x) => `<mark>${x}</mark>`) : esc(s)}</p>`).join("") : `<p class="muted">${lines.length ? "No matches." : "No transcript for this video."}</p>`;
  };
  draw();
  $("#tx").onclick = (e) => { const p = e.target.closest("[data-t]"); if (p) seek(+p.dataset.t); };
  let t; $("#txSearch").oninput = (e) => { clearTimeout(t); t = setTimeout(() => draw(e.target.value.trim()), 200); };
}

// ---------- Unsorted videos
async function viewVideos() {
  OV = await api("overview"); setBodies(OV.bodies);
  const vids = OV.videos.sort((a, b) => b.date.localeCompare(a.date));
  const unsorted = vids.filter((v) => !v.meetingId && !["other", "budget"].includes(v.body));
  const ignored = vids.filter((v) => !v.meetingId && ["other", "budget"].includes(v.body));
  const attached = vids.filter((v) => v.meetingId);
  const rowsFor = (list) => list.map((v) => `<tr>
    <td>${fmtDate(v.date)}</td>
    <td><a href="https://www.youtube.com/watch?v=${esc(v.videoId)}" target="_blank" rel="noopener">${esc(v.title || v.videoId)}</a><div class="meta">${Math.round((v.duration || 0) / 60)} min · ${v.noCaptions ? "no captions" : `${v.lineCount} transcript lines`}${v.guessed ? " · placed by guess, check it" : ""}</div></td>
    <td><select data-body="${v.videoId}">${["", ...Object.keys(BODY_NAMES), "other", "budget"].map((b) => `<option value="${b}" ${b === (v.body || "") ? "selected" : ""}>${b ? (BODY_NAMES[b] || (b === "other" ? "Other board (ignore)" : "Budget hearing (ignore)")) : "Choose…"}</option>`).join("")}</select></td>
    <td><input type="date" data-date="${v.videoId}" value="${esc(v.date)}"></td>
    <td><button data-assign="${v.videoId}">${v.meetingId ? "Move" : "Save"}</button>${v.meetingId ? ` <a href="#/m/${encodeURIComponent(v.meetingId)}">${esc(v.meetingId)}</a>` : ""}</td>
  </tr>`).join("");
  const table = (list) => `<table><thead><tr><th>Date</th><th>Video</th><th>Body</th><th>Meeting date</th><th></th></tr></thead><tbody>${rowsFor(list)}</tbody></table>`;
  $("#view").innerHTML = `
    <h1>Videos</h1>
    <p class="muted">The county posts every board's meetings on one channel, often titled just "LIVE". Videos land here when it isn't clear which meeting they are.</p>
    <h2>Need a meeting (${unsorted.length})</h2>${unsorted.length ? table(unsorted) : `<p class="muted">All sorted.</p>`}
    <details><summary>Attached to meetings (${attached.length})</summary>${table(attached)}</details>
    <details><summary>Other boards and budget hearings (${ignored.length})</summary>${table(ignored)}</details>`;
  $("#view").onclick = async (e) => {
    const id = e.target.dataset?.assign; if (!id) return;
    const body = $(`[data-body="${id}"]`).value, date = $(`[data-date="${id}"]`).value;
    if (!body) return toast("Choose a body first.");
    try { await api("assign", { videoId: id, body, date }); toast("Saved."); viewVideos(); } catch (err) { toast(err.message); }
  };
}

// ---------- Issues
async function viewIssues() {
  if (!OV) { OV = await api("overview"); setBodies(OV.bodies); }
  const { issues: allIssues, kinds = [] } = await api("issues");
  const issues = allIssues.filter((i) => !i.isProject); // project pages are managed in the Projects box above
  issues.sort((a, b) => (b.lastDate || "").localeCompare(a.lastDate || ""));
  const kindSel = (i) => `<select data-kind="${esc(i.key)}" title="Which road this issue is on (sets the public page's roadmap)"><option value="" ${!i.kindOverride ? "selected" : ""}>Auto${i.guessed ? `: ${esc(kinds.find((k) => k.kind === i.guessed)?.label || i.guessed)}` : ": no roadmap"}</option>${kinds.map((k) => `<option value="${k.kind}" ${i.kindOverride === k.kind ? "selected" : ""}>${esc(k.label)}</option>`).join("")}<option value="none" ${i.kindOverride === "none" ? "selected" : ""}>No roadmap</option></select>`;
  const dupes = await api("dupes");
  const projects = await api("projects");
  const projSel = (i) => i.isProject ? "" : `<span class="muted" style="margin-left:.6rem">Project:</span><select data-proj="${esc(i.key)}" title="Group this issue under a project page"><option value="">None</option>${projects.projects.map((pr) => `<option value="${esc(pr.key)}" ${i.projectKey === pr.key ? "selected" : ""}>${esc(pr.title)}</option>`).join("")}<option value="__new">New project…</option></select>`;
  $("#view").innerHTML = `
    <h1>Issues</h1>
    <p class="muted">Every published item with an issue key lands on that issue's timeline; these are the public issue pages. Each issue is put on a "road" (rezoning, variance, appropriation…) automatically from its items; fix one with the dropdown. <button id="rebuild">Rebuild all timelines</button></p>
    <div id="projects">${projectsHtml(projects)}</div>
    <div id="dupes">${dupesHtml(dupes)}</div>
    <datalist id="issueKeys">${issues.map((i) => `<option value="${esc(i.key)}">${esc(i.title)}</option>`).join("")}</datalist>
    ${issues.length ? issues.map((i) => `<div class="card item">
      <div class="head"><h3>${esc(i.title)}</h3><span class="meta">${esc(i.key)}${i.aliases?.length ? ` · also ${i.aliases.map(esc).join(", ")}` : ""}</span></div>
      <div class="row" style="align-items:center;gap:.5rem;margin:.3rem 0 .5rem;flex-wrap:wrap"><span class="muted">Road:</span>${kindSel(i)} ${projSel(i)} <span class="muted" style="margin-left:.6rem">Merge into:</span><input list="issueKeys" data-merge="${esc(i.key)}" placeholder="other issue key" style="width:16rem">${i.related?.length ? `<span class="muted" style="margin-left:.6rem">Related: ${i.related.map((k) => `<a href="#/issues">${esc(k)}</a>`).join(", ")}</span>` : ""}</div>
      ${i.events.map((ev) => `<div class="issue-ev">${fmtDate(ev.date)} · ${BODY_NAMES[ev.body]} · <strong>${esc(ev.stage)}</strong>${ev.result && ev.result !== "no vote" ? ` (${esc(ev.result)})` : ""} · <a href="#/m/${encodeURIComponent(ev.meetingId)}">${esc(ev.title)}</a>${ev.amount != null ? ` · ${money(ev.amount)}` : ""}</div>`).join("")}
      ${i.nextStep?.text ? `<p><strong>Next:</strong> ${esc(i.nextStep.text)}${i.nextStep.date ? ` (${fmtDate(i.nextStep.date)})` : ""}</p>` : ""}
    </div>`).join("") : `<p class="muted">No issues yet. Click Rebuild if you have published meetings.</p>`}`;
  $("#rebuild").onclick = async () => { const r = await api("rebuildIssues"); toast(`Rebuilt ${r.issues} issues.`); viewIssues(); };
  $("#view").onchange = async (e) => {
    const t = e.target.closest("[data-kind]");
    if (t) { await api("issueKind", { key: t.dataset.kind, kind: t.value }); toast("Saved."); return; }
    const pj = e.target.closest("[data-proj]");
    if (pj) {
      try {
        if (pj.value === "__new") { const title = prompt("Name the project (what a resident would call it):"); if (!title) { pj.value = ""; return; } await api("projectCreate", { title, parts: [pj.dataset.proj] }); }
        else if (pj.value) await api("projectAdd", { key: pj.value, parts: [pj.dataset.proj] });
        else await api("projectRemove", { part: pj.dataset.proj });
        toast("Saved."); viewIssues();
      } catch (err) { toast(err.message, 6000); }
      return;
    }
    const mg = e.target.closest("[data-merge]");
    if (mg && mg.value.trim()) {
      const into = mg.value.trim(), from = mg.dataset.merge;
      if (!issues.some((i) => i.key === into)) { toast("No issue with that key."); return; }
      if (!confirm(`Move everything on "${from}" onto "${into}"? "${from}" becomes an alias and its page redirects.`)) { mg.value = ""; return; }
      try { const r = await api("dupeMerge", { into, from }); toast(`Merged: ${r.title} now has ${r.events} items.`); viewIssues(); } catch (err) { toast(err.message); }
    }
  };
  wireDupes(); wireProjects();
}

// ---------- Projects: one page above several issues
function projectsHtml(d) {
  const review = d.review || [];
  const prop = (p) => `<div class="card" style="padding:.6rem .8rem;margin:.4rem 0" data-prop="${esc(p.clusterId)}" data-idx="${p.index}">
    <div class="row" style="gap:.6rem;align-items:center">${p.existing ? `<span style="flex:1 1 16rem"><span class="muted">Add to</span> <strong>${esc(p.existingTitle)}</strong></span>` : `<input data-ptitle value="${esc(p.title)}" style="flex:1 1 16rem;font-weight:600">`}<span class="meta">${esc(p.confidence)} confidence</span></div>
    <div class="muted" style="margin:.3rem 0">${esc(p.reason || "")}</div>
    ${p.parts.map((x) => `<label class="radio"><input type="checkbox" data-part="${esc(x.key)}" checked> ${esc(x.title)} <span class="meta">· ${x.items} item${x.items === 1 ? "" : "s"} · ${esc(x.from || "")} → ${esc(x.to || "")}${x.inProject ? ` · already in ${esc(x.inProject)}` : ""}</span></label>`).join("")}
    <div class="actions" style="margin-top:.4rem"><button class="primary" data-pact="apply">${p.existing ? "Add to project" : "Make this project"}</button><button data-pact="dismiss">${p.existing ? "Doesn't belong" : "Not a project"}</button></div></div>`;
  const existing = (pr) => `<details class="pold" style="margin:.3rem 0"><summary><strong>${esc(pr.title)}</strong> <span class="meta">· ${pr.parts.length} part${pr.parts.length === 1 ? "" : "s"} · <a href="/#/i/${encodeURIComponent(pr.key)}" target="_blank" rel="noopener">public page ↗</a></span></summary>
    <div style="padding:.3rem .6rem .5rem">${pr.parts.map((x) => `<div class="issue-ev">${esc(x.title)} <span class="meta">· ${x.items} items</span> <button class="linkish" data-unpart="${esc(x.key)}">Remove</button></div>`).join("")}
    <div class="actions" style="margin-top:.5rem"><button class="linkish" data-rename="${esc(pr.key)}">Rename</button><button class="linkish danger" data-ungroup="${esc(pr.key)}">Ungroup (keeps the parts)</button></div></div></details>`;
  return `<div class="card" style="margin:.8rem 0 1.2rem;padding:.8rem 1rem">
    <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem">
      <h3 style="margin:0">Projects${review.length ? ` <span class="meta">${review.length} to look at</span>` : ""}${d.pending ? ` <span class="meta">${d.pending} clusters still to check</span>` : ""}</h3>
      <div class="row" style="gap:.4rem"><button id="projScan">${d.pending ? "Keep checking" : "Find projects"}</button>${d.candidates && !d.pending ? `<button id="projRescan" class="ghost">Start over</button>` : ""}</div>
    </div>
    <p class="muted" style="margin:.3rem 0 .6rem">A project is one page above several issues: the jail is its land, its tax, its bonds, its contract and its site plan. This finds issues that share a subject, asks Claude which ones are pieces of one thing, makes the sure ones, and leaves the rest here. You can also pick a project in the dropdown on any issue below.</p>
    <div id="projLog" class="muted"></div>
    ${d.errors?.length ? `<details style="margin:.3rem 0"><summary class="err">${d.errors.length} cluster${d.errors.length === 1 ? "" : "s"} couldn't be checked</summary>${d.errors.map((e) => `<div class="issue-ev"><span class="err">${esc(e.error)}</span><div class="meta">${esc(e.keys.join(" · "))}</div></div>`).join("")}</details>` : ""}
    ${review.map(prop).join("")}
    ${d.projects?.length ? `<div style="margin-top:.6rem"><div class="meta" style="margin-bottom:.2rem">${d.projects.length} project${d.projects.length === 1 ? "" : "s"}</div>${d.projects.map(existing).join("")}</div>` : review.length || d.pending ? "" : `<p class="muted" style="margin:0">No projects yet.</p>`}
  </div>`;
}
function wireProjects() {
  const box = $("#projects"); if (!box) return;
  const refresh = async () => { box.innerHTML = projectsHtml(await api("projects")); wireProjects(); };
  const log = (t) => { const l = $("#projLog"); if (l) l.textContent = t; };
  const scan = async (restart = false) => {
    const btn = $("#projScan"); if (btn) { btn.disabled = true; btn.textContent = "Checking…"; }
    let guard = 0, applied = [];
    let lastErr = "";
    try {
      let r = await api("projectScan", { restart }); applied = r.applied || []; if (r.error) lastErr = r.error;
      while (r.queue && r.queue.pending > 0 && guard++ < 60) { log(`${r.queue.pending} clusters still to check; ${applied.length} groupings made so far…${lastErr ? ` Last problem: ${lastErr}` : ""}`); r = await api("projectScan"); applied = applied.concat(r.applied || []); if (r.error) lastErr = r.error; }
      toast(`Done. ${applied.length} grouping${applied.length === 1 ? "" : "s"} made on their own; ${r.queue?.review?.length || 0} for you to look at.`, 6000);
    } catch (e) { lastErr = e.message; }
    await refresh();
    if (lastErr) { const l = $("#projLog"); if (l) l.innerHTML = `<span class="err">Problem during the scan: ${esc(lastErr)}</span>`; }
  };
  $("#projScan").onclick = () => scan(false);
  $("#projRescan")?.addEventListener("click", () => { if (confirm("Look at every issue again from scratch? Projects you've already made are kept.")) scan(true); });
  box.querySelectorAll("[data-pact]").forEach((b) => b.onclick = async () => {
    const card = b.closest("[data-prop]"); const clusterId = card.dataset.prop, index = +card.dataset.idx;
    try {
      if (b.dataset.pact === "apply") { const parts = [...card.querySelectorAll("[data-part]:checked")].map((x) => x.dataset.part); if (parts.length < (card.querySelector("[data-ptitle]") ? 2 : 1)) return toast("Pick at least two parts."); const r = await api("projectApply", { clusterId, index, title: card.querySelector("[data-ptitle]")?.value.trim(), parts }); toast(`Saved to “${r.project.title}”.`); }
      else await api("projectDismiss", { clusterId, index });
      viewIssues();
    } catch (e) { toast(e.message, 6000); }
  });
  box.querySelectorAll("[data-unpart]").forEach((b) => b.onclick = async () => { await api("projectRemove", { part: b.dataset.unpart }); viewIssues(); });
  box.querySelectorAll("[data-ungroup]").forEach((b) => b.onclick = async () => { if (!confirm("Remove this project page? Its parts stay as separate issues.")) return; await api("projectDelete", { key: b.dataset.ungroup }); viewIssues(); });
  box.querySelectorAll("[data-rename]").forEach((b) => b.onclick = async () => { const t = prompt("New name:"); if (!t) return; await api("projectRename", { key: b.dataset.rename, title: t }); viewIssues(); });
}

// ---- Duplicate issues: scan, then clear the queue
function dupesHtml(d) {
  const pair = (p) => `<div class="card" style="padding:.6rem .8rem;margin:.4rem 0" data-pair="${esc(p.a)}|${esc(p.b)}">
    <div class="row" style="gap:1rem;flex-wrap:wrap;align-items:baseline">
      <div style="flex:1 1 16rem"><strong>${esc(p.A.title)}</strong><div class="meta">${esc(p.a)} · ${p.A.items} items · ${esc(p.A.from || "")} → ${esc(p.A.to || "")}</div></div>
      <div style="flex:1 1 16rem"><strong>${esc(p.B.title)}</strong><div class="meta">${esc(p.b)} · ${p.B.items} items · ${esc(p.B.from || "")} → ${esc(p.B.to || "")}</div></div>
    </div>
    <div class="muted" style="margin:.3rem 0">${p.verdict ? `<strong>${esc(p.verdict)}</strong> (${esc(p.confidence)}): ${esc(p.reason || "")}` : esc(p.reasons.join("; "))}${p.error ? ` <span class="err">${esc(p.error)}</span>` : ""}</div>
    <div class="row" style="gap:.4rem;flex-wrap:wrap">
      <button data-act="merge" data-into="${esc(p.keep || p.a)}" data-from="${esc(p.keep === p.b ? p.a : p.b)}">Merge → keep ${esc(p.keep || p.a)}</button>
      <button data-act="merge" data-into="${esc(p.keep === p.b ? p.a : p.b)}" data-from="${esc(p.keep || p.a)}" class="ghost">Merge → keep ${esc(p.keep === p.b ? p.a : p.b)}</button>
      <button data-act="relate" class="ghost">Related, not the same</button>
      <button data-act="dismiss" class="ghost">Not the same</button>
    </div></div>`;
  const review = d.review || [];
  return `<div class="card" style="margin:.8rem 0 1.2rem;padding:.8rem 1rem">
    <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem">
      <h3 style="margin:0">Possible duplicates${review.length ? ` <span class="meta">${review.length} to look at</span>` : ""}${d.pending ? ` <span class="meta">${d.pending} still to check</span>` : ""}</h3>
      <div class="row" style="gap:.4rem"><button id="dupeScan">${d.pending ? "Keep checking" : "Scan for duplicates"}</button>${review.length > 1 ? `<button id="dupeAll" class="ghost">Merge all suggested</button>` : ""}${d.pending || review.length ? "" : `<button id="dupeRestart" class="ghost">Scan again</button>`}</div>
    </div>
    <p class="muted" style="margin:.3rem 0 .6rem">Looks for issues that are one matter under two keys (same project, same ordinance number, same address), asks Claude to confirm, merges the sure ones on its own and leaves the rest here. A merged key becomes an alias, so old links and future drafts still land on the one page.</p>
    <div id="dupeLog" class="muted"></div>
    ${review.length ? review.map(pair).join("") : d.pending ? "" : `<p class="muted" style="margin:0">Nothing waiting for you.${d.done ? ` ${d.done} pairs settled so far.` : ""}</p>`}
    ${d.recent?.length ? `<details style="margin-top:.6rem"><summary>Settled automatically (${d.recent.length})</summary>${d.recent.map((p) => `<div class="issue-ev">${p.status === "merged" ? `Merged <strong>${esc(p.a === p.into ? p.b : p.a)}</strong> into <strong>${esc(p.into)}</strong>` : `Linked <strong>${esc(p.a)}</strong> and <strong>${esc(p.b)}</strong> as related`} · ${esc(p.reason || "")}</div>`).join("")}</details>` : ""}
  </div>`;
}
function wireDupes() {
  const box = $("#dupes"); if (!box) return;
  const refresh = async () => { box.innerHTML = dupesHtml(await api("dupes")); wireDupes(); };
  const log = (t) => { const l = $("#dupeLog"); if (l) l.textContent = t; };
  const scan = async (restart = false) => {
    const btn = $("#dupeScan"); if (btn) { btn.disabled = true; btn.textContent = "Checking…"; }
    let guard = 0;
    try {
      let r = await api("dupeScan", { restart });
      let applied = r.applied || [];
      while (r.queue && r.queue.pending > 0 && !r.error && guard++ < 40) { log(`${r.queue.pending} pairs still to check; ${applied.length} settled so far…`); r = await api("dupeScan"); applied = applied.concat(r.applied || []); }
      if (r.error) toast(r.error, 6000);
      const merged = applied.filter((a) => a.kind === "merged").length, related = applied.filter((a) => a.kind === "related").length;
      toast(`Done. Merged ${merged}, linked ${related} as related, ${r.queue?.review?.length || 0} for you to look at.`, 6000);
    } catch (e) { toast(e.message, 6000); }
    await refresh();
  };
  $("#dupeScan")?.addEventListener("click", () => scan(false));
  $("#dupeRestart")?.addEventListener("click", () => scan(true));
  $("#dupeAll")?.addEventListener("click", async () => {
    const pairs = [...box.querySelectorAll("[data-pair]")].map((el) => ({ el, btn: el.querySelector('[data-act="merge"]') })).filter((x) => x.btn);
    if (!confirm(`Merge all ${pairs.length} suggested pairs, keeping the first key shown on each?`)) return;
    for (const { btn } of pairs) { try { await api("dupeMerge", { into: btn.dataset.into, from: btn.dataset.from }); } catch (e) { toast(e.message); } }
    toast("Merged."); await refresh();
  });
  box.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const el = b.closest("[data-pair]"); const [a, c] = el.dataset.pair.split("|");
    b.disabled = true;
    try {
      if (b.dataset.act === "merge") { const r = await api("dupeMerge", { into: b.dataset.into, from: b.dataset.from }); toast(`Merged into ${r.key}: ${r.events} items.`); }
      else if (b.dataset.act === "relate") { await api("dupeRelate", { a, b: c }); toast("Linked as related."); }
      else { await api("dupeDismiss", { a, b: c }); toast("Won't ask again."); }
      el.remove();
    } catch (err) { toast(err.message, 5000); b.disabled = false; }
  });
}


// ---------- Library (reference documents like adopted budgets)
async function viewLibrary() {
  const { refs } = await api("refs");
  refs.sort((a, b) => (b.adopted || "").localeCompare(a.adopted || ""));
  $("#view").innerHTML = `
    <h1>Library</h1>
    <p class="muted">Adopted documents the drafts can lean on, like budgets. Claude gets a short version of these when drafting meetings of the same government. Add more with Import on the Meetings page.</p>
    ${refs.length ? refs.map((r) => `<div class="card item"><div class="head"><h3><a href="#/ref/${encodeURIComponent(r.id)}">${esc(r.title)}</a></h3><span class="meta">${esc(r.docNumber || "")}${r.adopted ? ` · adopted ${fmtDate(r.adopted)}` : ""}</span></div><p>${esc(r.summary || "")}</p></div>`).join("") : `<p class="muted">Nothing here yet.</p>`}`;
}
async function viewRef(id) {
  const { ref: r } = await api("ref", { id });
  if (!r) { $("#view").innerHTML = `<p class="err">Not found.</p>`; return; }
  const pg = (p) => p && r.source?.url ? ` <a class="meta" href="${esc(r.source.url)}#page=${p}" target="_blank" rel="noopener">p. ${p}</a>` : "";
  const groups = [...new Set((r.funds || []).map((f) => f.group))];
  const pct = (a, b) => b ? Math.round((a / b) * 1000) / 10 + "%" : "";
  $("#view").innerHTML = `
    <p><a href="#/library">← Library</a></p>
    <h1>${esc(r.title)}</h1>
    <p class="meta">${esc(r.docNumber || "")}${r.adopted ? ` · adopted ${fmtDate(r.adopted)} by ${esc(r.adoptedBy || "")}` : ""}${r.source?.url ? ` · <a href="${esc(r.source.url)}" target="_blank" rel="noopener">${esc(r.source.label || "Source")}</a>` : ""}${r.meetingId ? ` · <a href="#/m/${encodeURIComponent(r.meetingId)}">Meeting record</a>` : ""}</p>
    <div class="card"><p>${esc(r.summary || "")}</p></div>
    ${r.totals ? `<h2>Totals</h2><table><tbody>
      <tr><td>${esc(r.totals.allFundsLabel ? r.totals.allFundsLabel[0].toUpperCase() + r.totals.allFundsLabel.slice(1) : "All funds")}</td><td style="text-align:right"><strong>${money(r.totals.allFunds)}</strong></td></tr>
      <tr><td>General Fund</td><td style="text-align:right">${money(r.totals.generalFund)}</td></tr>
      ${r.totals.otherPropertyTaxFunds != null ? `<tr><td>Other property-tax funds</td><td style="text-align:right">${money(r.totals.otherPropertyTaxFunds)}</td></tr>` : ""}
      ${r.totals.nonPropertyTaxFunds != null ? `<tr><td>Non-property-tax funds</td><td style="text-align:right">${money(r.totals.nonPropertyTaxFunds)}</td></tr>` : ""}
      ${r.totals.tifFunds != null ? `<tr><td>TIF funds</td><td style="text-align:right">${money(r.totals.tifFunds)}</td></tr>` : ""}
      ${r.tax ? `<tr><td>Property tax rate</td><td style="text-align:right">$${r.tax.rate} per $100${pg(r.tax.page)}</td></tr><tr><td>Property tax levy</td><td style="text-align:right">${money(r.tax.levy)}</td></tr>${r.tax.estimatedCapLossAllFunds != null ? `<tr><td>Expected loss to tax caps</td><td style="text-align:right">${money(r.tax.estimatedCapLossAllFunds)}</td></tr>` : ""}` : ""}
    </tbody></table>` : ""}
    ${r.observations?.length ? `<h2>Worth knowing</h2><div class="card">${r.observations.map((o) => `<p>${esc(o.text)}${pg(o.page)}</p>`).join("")}</div>` : ""}
    ${r.generalFundDepartments?.length ? `<h2>General Fund by department</h2><table><thead><tr><th>Department</th><th style="text-align:right">2027</th><th style="text-align:right">Share</th></tr></thead><tbody>${[...r.generalFundDepartments].sort((a, b) => b.amount - a.amount).map((d) => `<tr><td>${esc(d.name)}</td><td style="text-align:right">${money(d.amount)}</td><td style="text-align:right">${pct(d.amount, r.totals?.generalFund)}</td></tr>`).join("")}</tbody></table>` : ""}
    ${groups.map((g) => `<h2>${esc(g)}</h2><table><thead><tr><th>Fund</th><th style="text-align:right">Budget</th><th style="text-align:right">Tax levy</th><th style="text-align:right">${r.year - 1}</th><th style="text-align:right">Cash end ${r.year - 1} (est.)</th><th style="text-align:right">Cash end ${r.year} (est.)</th><th></th></tr></thead><tbody>${r.funds.filter((f) => f.group === g).map((f) => `<tr><td>${esc(f.code)} ${esc(f.name)}</td><td style="text-align:right">${money(f.budget)}</td><td style="text-align:right">${f.levy ? money(f.levy) : "–"}</td><td style="text-align:right">${money(f[`budget${r.year - 1}`])}</td><td style="text-align:right">${money(f[`cashEnd${r.year - 1}`])}</td><td style="text-align:right">${money(f[`cashEnd${r.year}`])}</td><td>${pg(f.page)}</td></tr>`).join("")}</tbody></table>`).join("")}`;
}

// ---------- Needs you: held items and error reports
async function viewQueue() {
  const { items, reports, broken = [], bodies } = await api("queue");
  setBodies(bodies);
  $("#view").innerHTML = `
    <h1>Needs you</h1>
    <p class="muted">Everything else publishes on its own. These items are held off the public site until you decide, and reports come from the "Report an error" link.</p>
    ${items.some((i) => /resident|address|private|personal|phone|email/i.test(i.reason || "")) ? `<div class="card"><p style="margin:0 0 8px">Some of these are held only because a resident gave a name or address. Residents' details are now removed automatically, so those can go public.</p><p class="actions" style="margin:0"><button id="relPriv" class="primary" title="Removes residents' addresses, phone numbers and emails, then publishes items held only for that. No Claude, no cost.">Clean and publish those</button> <span id="relOut" class="muted"></span></p></div>` : ""}
    ${reports.length ? `<h2>Error reports (${reports.length})</h2>${reports.map((r) => `<div class="card item">
      <div class="head"><h3>${r.meetingId ? `<a href="#/m/${encodeURIComponent(r.meetingId)}">${esc(r.meetingId)}</a>${r.idx != null ? ` · item ${r.idx + 1}` : ""}` : `Page: ${esc(r.page || "")}`}</h3><span class="meta">${new Date(r.at).toLocaleString()}</span></div>
      <p>${esc(r.text)}</p>${r.contact ? `<p class="meta">Reply to: ${esc(r.contact)}</p>` : ""}
      <div class="actions">${r.meetingId ? `<a class="btn" href="#/m/${encodeURIComponent(r.meetingId)}">Open meeting</a>` : ""}<a class="btn" href="/#${esc(r.page || (r.meetingId ? "/m/" + r.meetingId : "/"))}" target="_blank" rel="noopener">See the public page</a><button data-dismiss="${esc(r.id)}">Done</button></div></div>`).join("")}` : ""}
    ${broken.length ? `<h2>Drafts with no items (${broken.length})</h2><p class="muted">These meetings have a summary on the public site but nothing under it. Usually the draft was cut off; redrafting fixes it (about 25¢ each).</p>
      <p class="actions"><button id="redraftAll" class="primary">Redraft all ${broken.length} (about $${(broken.length * 0.25).toFixed(2)}, ${Math.ceil(broken.length * 1.2)} min; keep this tab open)</button> <span id="progress" class="muted"></span></p>${broken.map((b) => `<div class="card item"><div class="head"><h3>${esc(BODY_NAMES[b.body] || b.body)} · ${fmtDate(b.date)}</h3></div><p>${esc(b.problem)}</p>${b.diag ? `<pre style="white-space:pre-wrap;font-size:.8rem;background:var(--soft);padding:.5rem;border-radius:4px">items: ${esc(b.diag.shape)}${b.truncated ? " · CUT OFF" : ""} · drafted ${b.diag.draftedAt ? new Date(b.diag.draftedAt).toLocaleString() : "?"} · ${esc(b.diag.model || "")} · ${b.diag.outputTokens ?? "?"} output tokens · sources: ${[b.diag.hadPacket && "packet", b.diag.hadMinutes && "minutes", b.diag.hadVideo && "video"].filter(Boolean).join(", ") || "none"}
keys: ${esc(b.diag.keys)}
sample: ${esc(b.diag.sample || "(none)")}${b.diag.itemsRaw ? `\nunparsed: ${esc(b.diag.itemsRaw)}` : ""}${b.diag.error ? `\nerror: ${esc(b.diag.error)}` : ""}
reply: ${b.diag.toolUses ?? "?"} tool call(s) · stop: ${esc(b.diag.stop || "?")} · mode: ${esc(b.diag.mode || "?")} · retried: ${b.diag.retried ? "yes" : "no"}${b.diag.retryError ? ` (${esc(b.diag.retryError)})` : ""} · transcript: ${b.diag.transcriptChars ?? "?"} chars${b.diag.rawText ? `\nClaude said: ${esc(b.diag.rawText)}` : ""}${b.diag.rawInput ? `\nraw record: ${esc(b.diag.rawInput)}` : ""}</pre>` : ""}<div class="actions"><button data-draft="${esc(b.meetingId)}" class="primary">Redraft</button><a class="btn" href="#/m/${encodeURIComponent(b.meetingId)}">Open</a></div></div>`).join("")}` : ""}
    <h2>Held items (${items.length})</h2>
    ${items.length ? items.map((it) => {
      const v = it.vote || {}, f = it.minutesFix;
      return `<div class="card item">
        <div class="head"><h3>${esc(it.title)}</h3><span class="meta">${esc(BODY_NAMES[it.body] || it.body)} · ${fmtDate(it.date)}</span></div>
        <div class="hold"><strong>Why it's held:</strong> ${esc(it.reason)}</div>
        <p>${esc(it.whatItIs)}</p>
        <p class="meta">As written: ${esc([v.result, v.method, v.yes?.length && "yes: " + v.yes.join(", "), v.no?.length && "no: " + v.no.join(", "), it.amount != null && money(it.amount), it.motionBy && "moved by " + it.motionBy].filter(Boolean).join(" · "))}</p>
        ${f ? `<p class="meta"><strong>Minutes say:</strong> ${esc(f.minutesSay || [f.result, f.yes?.length && "yes: " + f.yes.join(", "), f.no?.length && "no: " + f.no.join(", "), f.amount != null && money(f.amount)].filter(Boolean).join(" · "))}</p>` : ""}
        <div class="actions">
          ${f ? `<button class="primary" data-q="${esc(it.meetingId)}|${it.idx}|minutes">Use the minutes' version</button>` : ""}
          <button data-q="${esc(it.meetingId)}|${it.idx}|publish">Publish as written</button>
          <button class="danger" data-q="${esc(it.meetingId)}|${it.idx}|hide">Keep it off</button>
          <a class="btn" href="#/m/${encodeURIComponent(it.meetingId)}">Edit</a>
          ${it.videoId && it.videoSeconds != null ? `<a class="btn" href="https://www.youtube.com/watch?v=${esc(it.videoId)}&t=${it.videoSeconds}s" target="_blank" rel="noopener">Watch ▶ ${clock(it.videoSeconds)}</a>` : ""}
        </div></div>`;
    }).join("") : `<p class="muted">Nothing held. Everything is live.</p>`}`;
  if ($("#relPriv")) $("#relPriv").onclick = async () => {
    $("#relPriv").disabled = true; $("#relOut").textContent = "Working…";
    try { const r = await api("releasePrivacyHolds"); toast(`Published ${r.released.length} item${r.released.length === 1 ? "" : "s"} with residents' details removed. ${r.kept} still need you.`, 8000); await viewQueue(); }
    catch (e) { $("#relOut").textContent = e.message; $("#relPriv").disabled = false; }
  };
  $("#redraftAll")?.addEventListener("click", async () => {
    if (!confirm(`Redraft ${broken.length} meetings now? About $${(broken.length * 0.25).toFixed(2)} in API use.`)) return;
    const p = $("#progress"); document.querySelectorAll("#view button").forEach((b) => (b.disabled = true));
    let done = 0; const failed = [];
    for (const b of broken) {
      p.textContent = `Redrafting ${b.meetingId.replace(/-/, " ")} (${done + 1} of ${broken.length})…`;
      try { await api("", { id: b.meetingId }, "/api/draft"); } catch (err) { failed.push(`${b.meetingId}: ${err.message}`); }
      done++;
    }
    toast(failed.length ? `${done - failed.length} redrafted, ${failed.length} failed.` : `${done} redrafted.`, 6000);
    viewQueue();
    if (failed.length) setTimeout(() => { const pp = $("#progress"); if (pp) pp.innerHTML = `<span class="err">${failed.map(esc).join("<br>")}</span>`; }, 300);
  });
  $("#view").onclick = async (e) => {
    const q = e.target.closest("[data-q]"), d = e.target.closest("[data-dismiss]"), rd = e.target.closest("[data-draft]");
    if (rd) { rd.disabled = true; rd.textContent = "Redrafting…"; try { await api("", { id: rd.dataset.draft }, "/api/draft"); toast("Redrafted."); } catch (err) { toast(err.message, 5000); } viewQueue(); return; }
    if (q) { const [id, idx, what] = q.dataset.q.split("|"); q.disabled = true; await api("resolve", { id, idx: +idx, do: what }); toast(what === "hide" ? "Kept off." : "Published."); viewQueue(); }
    if (d) { await api("dismissReport", { id: d.dataset.dismiss }); viewQueue(); }
  };
}

// ---------- Research (internal only): flags, quotes, money, repeat players
let INS = null;
const normName = (n) => String(n).toLowerCase().replace(/[.,'’]/g, "").replace(/\b(llc|inc|incorporated|co|corp|corporation|company|ltd|lp|llp|pc)\b/g, "").replace(/&/g, "and").replace(/\s+/g, " ").trim();
async function viewResearch(tab) {
  INS = INS && tab !== "refresh" ? INS : await api("insights");
  if (tab === "refresh") tab = "flags";
  setBodies(INS.bodies);
  const tabs = [["flags", `Flags (${INS.flags.length})`], ["quotes", `Quotes (${INS.quotes.length})`], ["money", `Money (${INS.money.length})`], ["players", "Repeat players"]];
  $("#view").innerHTML = `
    <div class="toolbar"><div><h1>Research</h1><div class="meta">Internal only. Includes held items. Never shown on the public site.</div></div>
      <div class="actions"><a class="btn" href="#/research/refresh">Refresh</a></div></div>
    <div class="filter" style="margin-bottom:.8rem">${tabs.map(([k, l]) => `<a class="btn ${tab === k ? "on primary" : ""}" href="#/research/${k}">${l}</a>`).join(" ")}</div>
    <div class="filter" style="margin-bottom:.8rem"><input id="rq" placeholder="Filter: a name, a company, a word…" style="max-width:360px"> <select id="rgov" style="width:auto"><option value="">County and city</option><option value="county">County</option><option value="city">City of Kokomo</option></select></div>
    <div id="rout"></div>`;
  const link = (x) => `<a href="#/m/${encodeURIComponent(x.meetingId)}">${fmtDate(x.date)} · ${esc(BODY_NAMES[x.body] || x.body)}</a>`;
  const watch = (x, s) => x.videoId && s != null ? ` <a href="https://www.youtube.com/watch?v=${esc(x.videoId)}&t=${s}s" target="_blank" rel="noopener">▶ ${clock(s)}</a>` : "";
  const draw = () => {
    const q = $("#rq").value.trim().toLowerCase(), gov = $("#rgov").value;
    const keep = (x, text) => (!gov || x.gov === gov) && (!q || text.toLowerCase().includes(q));
    let html = "";
    if (tab === "flags") {
      const rows = INS.flags.filter((x) => keep(x, `${x.text} ${x.itemTitle} ${x.kind}`));
      html = rows.length ? rows.map((x) => `<div class="card item"><div class="meta">${link(x)} · <strong>${esc(x.kind)}</strong>${watch(x, x.seconds)}</div><p>${esc(x.text)}</p><div class="meta">${esc(x.itemTitle)}</div></div>`).join("") : `<p class="muted">No flags${q ? " match" : " yet"}. New drafts add them; older ones get them when Claude enriches the export in a chat.</p>`;
    } else if (tab === "quotes") {
      const speakers = {};
      const rows = INS.quotes.filter((x) => keep(x, `${x.speaker} ${x.text} ${x.itemTitle}`));
      for (const x of rows) speakers[x.speaker || "Unknown"] = (speakers[x.speaker || "Unknown"] || 0) + 1;
      html = `<p class="meta">${Object.entries(speakers).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([n, c]) => `<a href="#" data-speaker="${esc(n)}">${esc(n)} (${c})</a>`).join(" · ")}</p>` +
        (rows.length ? rows.slice(0, 400).map((x) => `<div class="quote card">“${esc(x.text)}” <div class="meta">— ${esc(x.speaker || "unknown")} · ${link(x)} · ${esc(x.itemTitle)}${watch(x, x.seconds)}</div></div>`).join("") : `<p class="muted">Nothing.</p>`);
    } else if (tab === "money") {
      const rows = INS.money.filter((x) => keep(x, `${x.title} ${x.recipient} ${x.fundingSource} ${x.category} ${x.docNumber} ${(x.parties || []).map((p) => p.name).join(" ")}`));
      const total = rows.filter((x) => ["passed", ""].includes(x.result) || ["adopted", "approved"].includes(x.stage)).reduce((a, x) => a + (x.amount || 0), 0);
      const byCat = {};
      for (const x of rows) byCat[x.category] = (byCat[x.category] || 0) + x.amount;
      html = `<p class="meta">${rows.length} items · ${money(total)} approved or adopted · ${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, a]) => `${esc(c)} ${money(a)}`).join(" · ")}</p>
        <table><thead><tr><th>Date</th><th>Item</th><th>To</th><th>From</th><th style="text-align:right">Amount</th><th>Result</th></tr></thead><tbody>
        ${rows.map((x) => `<tr><td>${link(x)}</td><td>${esc(x.title)}${x.docNumber ? `<div class="meta">${esc(x.docNumber)}</div>` : ""}</td><td>${esc(x.recipient || (x.parties || []).map((p) => p.name).join(", "))}</td><td>${esc(x.fundingSource)}</td><td style="text-align:right">${money(x.amount)}</td><td>${esc(x.result || x.stage)}</td></tr>`).join("")}</tbody></table>`;
    } else {
      const groups = new Map();
      for (const x of INS.parties.filter((x) => keep(x, `${x.name} ${x.role} ${x.itemTitle}`))) {
        const k = normName(x.name);
        const g = groups.get(k) || { name: x.name, roles: new Set(), items: [], total: 0, meetings: new Set(), bodies: new Set() };
        g.roles.add(x.role); g.items.push(x); g.meetings.add(x.meetingId); g.bodies.add(x.body); if (x.amount) g.total += x.amount;
        groups.set(k, g);
      }
      const list = [...groups.values()].sort((a, b) => b.meetings.size - a.meetings.size || b.total - a.total);
      html = list.length ? `<p class="meta">Sorted by how many meetings they show up in. Names are matched loosely (LLC, Inc. and punctuation ignored).</p>` + list.map((g) => `<details class="card item" ${list.length < 6 ? "open" : ""}><summary><strong>${esc(g.name)}</strong> <span class="meta">· ${[...g.roles].filter(Boolean).join(", ")} · ${g.meetings.size} meeting${g.meetings.size === 1 ? "" : "s"} · ${[...g.bodies].map((b) => BODY_NAMES[b] || b).join(", ")}${g.total ? ` · ${money(g.total)}` : ""}</span></summary>
        ${g.items.map((x) => `<div class="issue-ev">${link(x)} · ${esc(x.itemTitle)}${x.amount ? ` · ${money(x.amount)}` : ""}${x.result ? ` · ${esc(x.result)}` : ""}</div>`).join("")}</details>`).join("") : `<p class="muted">No companies or developers tagged yet. New drafts tag them; older drafts get them when Claude enriches the export in a chat.</p>`;
    }
    $("#rout").innerHTML = html;
  };
  $("#rq").oninput = draw; $("#rgov").onchange = draw;
  $("#rout").onclick = (e) => { const a = e.target.closest("[data-speaker]"); if (a) { e.preventDefault(); $("#rq").value = a.dataset.speaker === "Unknown" ? "" : a.dataset.speaker; draw(); } };
  draw();
}

// ---------- Settings
// ---------- Past years (the archive): find documents, match videos, draft board by board, with live status per meeting
const BODY_ORDER = ["city-council", "city-works", "city-plan", "city-bza", "council", "commissioners", "plan"];
const COST = { "city-council": 25, "city-works": 20, "city-plan": 10, "city-bza": 10, council: 12, commissioners: 12, plan: 20 };
let ARC_STOP = false, ARC_YEAR = Number(store.get("vt-arc-year")) || new Date().getFullYear() - 1;
const arcDraftable = (m) => !["drafted", "approved", "skipped", "drafting"].includes(m.status) && !m.cancelled && (["city-council", "city-works", "plan"].includes(m.body) ? m.transcript : (m.minutes || m.packet));
const arcWaitingVideo = (m) => ["city-council", "city-works", "plan"].includes(m.body) && m.video && !m.transcript && !["drafted", "approved"].includes(m.status);
const arcStatusCell = (m) => m.status === "drafted" || m.status === "approved" ? `<b>${m.items} items</b> · ${m.hadMinutes ? "from minutes" : m.hadVideo ? "from video" : "from packet"}${m.cents != null ? ` · ${m.cents}¢` : ""}` : m.status === "error" ? `<span class="err">${esc(m.error)}</span>` : m.status === "waiting" ? (arcDraftable(m) ? "ready to draft" : arcWaitingVideo(m) ? "waiting for the transcript (Mac job)" : m.video && !m.minutes && !m.packet && !["city-council", "city-works", "plan"].includes(m.body) ? "video link only" : "nothing to read yet") : m.status;
async function viewArchive() {
  const yearsRow = () => { const y = new Date().getFullYear(); return [y - 1, y - 2, y - 3].map((v) => `<button class="chip ${v === ARC_YEAR ? "on" : ""}" data-year="${v}">${v}</button>`).join(""); };
  $("#view").innerHTML = `<h1>Past years</h1>
    <p class="muted">The archive. Past meetings are written up from the official minutes (from video where a board has no minutes online), never by the daily run, and stay off the home page and alerts. Steps 1 and 2 are free; only "Draft" uses the Claude API.</p>
    <div class="card">
      <p class="actions" style="align-items:center;gap:8px"><span id="arcYears">${yearsRow()}</span>
        <button id="arcScan" title="Reads both governments' document pages for the year and creates the meeting records">1. Find documents</button>
        <button id="arcVideos" title="Lists both YouTube channels for the year and links each video to its meeting; ceremonies and promos are skipped">2. Match videos</button>
        <button id="arcList">Refresh</button>
        <button id="invRun" title="Just the YouTube listing, with lengths">Video inventory</button></p>
      <p class="muted" style="font-size:.9rem;margin:0">3. Transcripts for Kokomo Council and Board of Works come from the Mac job: in Terminal run <code>bash ~/Library/Application\ Support/VoteTracker/fetch-transcripts.sh</code> after step 2. 4. Draft, board by board. 5. Rebuild all timelines (Issues tab) when done.</p>
    </div>
    <div id="arcProgress" class="card" style="display:none;position:sticky;top:0;z-index:5"><b id="arcProgText"></b> <button id="arcStop" style="margin-left:12px">Stop</button><div style="height:6px;background:var(--line,#ddd);border-radius:3px;margin-top:8px"><div id="arcBar" style="height:6px;width:0;background:#0b7a6e;border-radius:3px"></div></div></div>
    <div id="arcOut"><p class="muted">Loading…</p></div>
    <div id="invOut"></div>`;
  document.querySelectorAll("#arcYears [data-year]").forEach((b) => b.onclick = () => { ARC_YEAR = Number(b.dataset.year); store.set("vt-arc-year", String(ARC_YEAR)); viewArchive(); });
  $("#arcStop").onclick = () => { ARC_STOP = true; $("#arcStop").textContent = "Stopping after this one…"; };
  $("#arcScan").onclick = async () => {
    $("#arcScan").disabled = true; $("#arcScan").textContent = "Reading the document pages…";
    try { const r = await api("archiveScan", { year: ARC_YEAR }); toast(`Kokomo: ${r.city?.created?.length ?? 0} new meetings from ${r.city?.files ?? 0} files. County: ${r.county?.created?.length ?? 0} new${r.county?.adopted?.length ? ` and ${r.county.adopted.length} already on file` : ""} from ${r.county?.packets ?? 0} packets.${r.errors?.length ? " " + r.errors.join(" ") : ""}`, 9000); await arcShow(); }
    catch (e) { toast(e.message, 8000); }
    $("#arcScan").disabled = false; $("#arcScan").textContent = "1. Find documents";
  };
  $("#arcVideos").onclick = async () => {
    $("#arcVideos").disabled = true; $("#arcVideos").textContent = "Matching videos…";
    try { const r = await api("archiveVideos", { year: ARC_YEAR }); toast(`Linked ${r.attached} videos, made ${r.created} meetings from video (boards with no minutes online), skipped ${r.skipped} ceremonies and shorts; ${r.unplaced.length} couldn't be placed (see Unsorted videos).`, 10000); await arcShow(); }
    catch (e) { toast(e.message, 8000); }
    $("#arcVideos").disabled = false; $("#arcVideos").textContent = "2. Match videos";
  };
  $("#arcList").onclick = arcShow;
  $("#invRun").onclick = async () => {
    $("#invRun").disabled = true; $("#invOut").innerHTML = `<p class="muted">Asking YouTube…</p>`;
    try {
      const r = await api("videoInventory", { year: ARC_YEAR });
      if (r.error) throw new Error(r.error);
      const guess = (t) => /council/i.test(t) ? "council" : /commission|plan/i.test(t) ? "plan" : /zoning|bza/i.test(t) ? "bza" : /works|bpw/i.test(t) ? "works" : /drainage/i.test(t) ? "drainage" : "other";
      const table = (gov, list) => { const by = {}; list.forEach((v) => (by[guess(v.title)] ||= []).push(v)); return `<h3>${gov === "city" ? "KGOV2 (city)" : "County channel"} · ${list.length} videos in ${r.year}</h3>
        <p class="meta">${Object.entries(by).map(([k, v]) => `${k}: ${v.length}`).join(" · ")}</p>
        <details><summary>All ${list.length}</summary><table class="meta"><tbody>${list.map((v) => `<tr><td>${v.date}</td><td>${v.minutes} min</td><td>${v.live ? "stream" : "upload"}</td><td><a href="https://www.youtube.com/watch?v=${v.videoId}" target="_blank" rel="noopener">${esc(v.title)}</a></td></tr>`).join("")}</tbody></table></details>`; };
      $("#invOut").innerHTML = `<div class="card">${table("city", r.city || [])}${table("county", r.county || [])}</div>`;
    } catch (e) { $("#invOut").innerHTML = `<p class="err">${esc(e.message)}</p>`; }
    $("#invRun").disabled = false;
  };
  await arcShow();
}
async function arcShow() {
  let r;
  try { r = await api("archiveList", { year: ARC_YEAR }); if (r.error) throw new Error(r.error); }
  catch (e) { $("#arcOut").innerHTML = `<p class="err">${esc(e.message)}${/Unknown action/.test(e.message) ? " — the server side (api/admin.js and lib/pipeline.js) hasn't been deployed yet." : ""}</p>`; return; }
  if (!r.meetings.length) { $("#arcOut").innerHTML = `<p class="muted">No ${ARC_YEAR} meetings yet. Click "1. Find documents" first.</p>`; return; }
  const by = {}; for (const m of r.meetings) (by[m.body] ||= []).push(m);
  const mark = (ok, word) => ok ? `<span style="color:#1a8f4a">${word}</span>` : `<span class="muted">—</span>`;
  const done = (list) => list.filter((m) => m.status === "drafted" || m.status === "approved").length;
  $("#arcOut").innerHTML = `<p class="meta">${r.meetings.length} meetings in ${ARC_YEAR} · ${done(r.meetings)} written up · spent so far $${(r.meetings.reduce((a, m) => a + (m.cents || 0), 0) / 100).toFixed(2)}</p>
    ${BODY_ORDER.filter((b) => by[b]).map((b) => { const list = by[b]; const can = list.filter(arcDraftable); const wait = list.filter(arcWaitingVideo); return `
      <div class="card" data-board="${b}">
      <h3 style="margin:0 0 8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">${esc(BODY_NAMES[b] || b)} <span class="meta">${list.length} meetings · ${done(list)} done${wait.length ? ` · ${wait.length} waiting on transcripts` : ""}${can.length ? ` · ${can.length} ready` : ""}</span>
        ${can.length ? `<button data-arcdraft="${b}" class="primary" title="Uses the Claude API">Draft ${can.length} (about $${((can.length * COST[b]) / 100).toFixed(2)})</button>` : ""}</h3>
      <table class="meta" style="width:100%"><tbody>${list.map((m) => `<tr data-row="${m.id}"><td style="white-space:nowrap"><a href="#/m/${m.id}">${m.date}</a></td><td>${mark(m.packet, m.agendaOnly ? "agenda" : "packet")}</td><td>${mark(m.minutes, "minutes")}</td><td>${mark(m.video, "video")}</td><td>${mark(m.transcript, "transcript")}</td><td class="st" style="width:45%">${arcStatusCell(m)}</td></tr>`).join("")}</tbody></table>
      </div>`; }).join("")}`;
  document.querySelectorAll("[data-arcdraft]").forEach((btn) => btn.onclick = () => arcDraft(btn.dataset.arcdraft, (by[btn.dataset.arcdraft] || []).filter(arcDraftable)));
}
async function arcDraft(b, list) {
  if (!confirm(`Draft ${list.length} ${BODY_NAMES[b] || b} meetings from ${ARC_YEAR} with the Claude API?\n\nAbout ${COST[b]}¢ each, roughly $${((list.length * COST[b]) / 100).toFixed(2)} total. You can stop part way; finished ones are kept.`)) return;
  ARC_STOP = false;
  const prog = $("#arcProgress"), bar = $("#arcBar"), text = $("#arcProgText");
  prog.style.display = ""; $("#arcStop").textContent = "Stop";
  document.querySelectorAll("[data-arcdraft]").forEach((x) => (x.disabled = true));
  let spent = 0, done = 0, failed = 0;
  const row = (id) => document.querySelector(`[data-row="${id}"] .st`);
  for (const m of list) {
    if (ARC_STOP) break;
    text.textContent = `${BODY_NAMES[b] || b}: drafting ${m.date} (${done + 1} of ${list.length}) · spent $${(spent / 100).toFixed(2)}`;
    const cell = row(m.id); if (cell) cell.innerHTML = `<span style="color:#8a5a00">Drafting… (about a minute)</span>`;
    try {
      const r = await api("", { id: m.id }, "/api/draft");
      spent += r.cents || 0;
      if (cell) cell.innerHTML = `<b>${r.items} items</b> · ${r.meta?.hadMinutes ? "from minutes" : r.meta?.hadVideo ? "from video" : "from packet"} · ${r.cents}¢ · <a href="#/m/${m.id}">open</a>`;
    } catch (e) { failed++; if (cell) cell.innerHTML = `<span class="err">${esc(e.message)}</span>`; }
    done++;
    bar.style.width = `${Math.round((done / list.length) * 100)}%`;
  }
  text.textContent = `${ARC_STOP ? "Stopped" : "Done"}: ${done - failed} drafted${failed ? `, ${failed} failed` : ""} · spent $${(spent / 100).toFixed(2)}`;
  $("#arcStop").style.display = "none";
  toast(text.textContent, 9000);
  setTimeout(arcShow, 1500);
}

// ---------- Setup pages (Settings used to be one long page)
async function viewMembers() {
  OV = await api("overview"); setBodies(OV.bodies);
  const roster = OV.roster;
  $("#view").innerHTML = `<div class="phead"><div><h1>Board members</h1><p class="sub">Used to fix names in captions and to sort votes by party on the internal view.</p></div><button id="saveRoster" class="primary">Save members</button></div>
    <div class="cols2">${Object.entries(roster).map(([body, list]) => `<div class="card"><h3 class="bh"><i class="bdot" style="background:${BOARD_COLOR[body] || "#888"}"></i>${esc(BODY_NAMES[body] || body)}</h3>
      <div data-roster="${body}">${list.map((r) => rosterRow(r)).join("")}</div>
      <button data-addr="${body}" class="linkish">+ Add member</button></div>`).join("")}</div>`;
  document.querySelectorAll("[data-addr]").forEach((b) => b.onclick = () => $(`[data-roster="${b.dataset.addr}"]`).insertAdjacentHTML("beforeend", rosterRow({ name: "" })));
  $("#saveRoster").onclick = async () => {
    const out = {};
    document.querySelectorAll("[data-roster]").forEach((box) => {
      out[box.dataset.roster] = [...box.querySelectorAll(".rrow")].map((r) => ({ name: r.querySelector("[name=n]").value.trim(), title: r.querySelector("[name=t]").value.trim(), party: r.querySelector("[name=p]").value })).filter((r) => r.name);
    });
    await api("roster", { roster: out }); toast("Saved.");
  };
}
async function viewAskSettings() {
  $("#view").innerHTML = `<div class="phead"><div><h1>Ask and spending</h1><p class="sub">Who can use the Ask page, their limits, and what it has cost.</p></div></div><div class="card" id="askBox"><p class="muted">Loading…</p></div>`;
  await askSettings();
}
async function viewAlerts() {
  $("#view").innerHTML = `<div class="phead"><div><h1>Alerts</h1><p class="sub">Phone alerts people turn on from the public site.</p></div></div><div class="card" id="pushBox"><p class="muted">Loading…</p></div>`;
  await pushSettings();
}
async function viewTools() {
  OV = await api("overview");
  const bm = bookmarklet(location.origin);
  $("#view").innerHTML = `<div class="phead"><div><h1>Tools</h1><p class="sub">Things you need now and then.</p></div></div>
    <div class="cols2">
      <div class="card"><h3>Daily check</h3>
        <p>Runs every morning: looks for new agendas and minutes, drafts up to two meetings that have everything they need, checks up to four drafts against minutes, and previews up to two upcoming agendas. Uses the Claude API.</p>
        <div class="actions"><button id="runNow">Run it now</button><span id="runOut" class="meta"></span></div>
        ${OV.lastRun ? `<details><summary>Last run, ${esc(new Date(OV.lastRun.at).toLocaleString())}</summary><pre class="meta" style="white-space:pre-wrap">${esc(JSON.stringify(OV.lastRun, null, 1))}</pre></details>` : ""}</div>
      <div class="card"><h3>Browser button for transcripts</h3>
        <p>Drag this to your bookmarks bar: <a class="bm" href="${esc(bm)}">Send to localmeetings</a></p>
        <p class="muted">Use it if the Mac job misses a meeting. Open the meeting video on YouTube, click the bookmark, and the transcript is sent here.</p></div>
      <div class="card"><h3>Import from a Claude chat</h3>
        <p class="muted">Drafts, minutes checks or reference documents made in a Claude chat (.json).</p>
        <label class="btn">Choose files<input id="importFile" type="file" accept=".json,application/json" multiple hidden></label></div>
      <div class="card"><h3>Export for Claude</h3>
        <p class="muted">Downloads every draft so Claude can check them against minutes in a chat, on your plan.</p>
        <button id="export">Download export</button></div>
    </div>`;
  $("#runNow").onclick = async () => {
    $("#runNow").disabled = true; $("#runOut").textContent = "Running… this can take a few minutes if it drafts.";
    try { const r = await fetch("/api/cron", { headers: { "x-admin-code": CODE } }).then((x) => x.json()); $("#runOut").textContent = r.error ? r.error : `Found ${r.scan.packets} documents; drafted ${r.drafted.length}, checked ${r.checked?.length || 0} against minutes, previewed ${r.previewed?.length || 0}.${r.errors?.length ? " Problems: " + r.errors.join("; ") : ""}`; } catch (e) { $("#runOut").textContent = e.message; }
    $("#runNow").disabled = false;
  };
  $("#importFile").onchange = async (e) => {
    const files = [];
    try { for (const f of e.target.files) files.push(JSON.parse(await f.text())); } catch (err) { return toast("One of those files isn't valid JSON."); }
    try { const r = await api("import", { files }); toast(r.done.join(" · "), 6000); } catch (err) { toast(err.message, 6000); }
    e.target.value = "";
  };
  $("#export").onclick = async () => {
    const data = await api("export");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
    a.download = `localmeetings-export-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    toast("Saved to your Downloads. Move it into Vote Tracker/data and tell Claude in the chat.", 7000);
  };
}
// Ask page: access codes, limits and the question log
async function pushSettings() {
  const d = await api("pushStatus");
  const box = $("#pushBox");
  box.innerHTML = `
    ${d.ready ? `<p><strong>${d.subscribers}</strong> phone${d.subscribers === 1 ? "" : "s"} subscribed${d.stats && d.subscribers ? ` · agenda ${d.stats.kinds.agenda}, starting soon ${d.stats.kinds.starting}, what happened ${d.stats.kinds.published} · County Council ${d.stats.groups.council}, Commissioners ${d.stats.groups.commissioners}, County Plan ${d.stats.groups.plan}, Kokomo Council ${d.stats.groups["city-council"]}, other Kokomo boards ${d.stats.groups["city-boards"]}` : ""}. People turn alerts on from the home page or <a href="/#/alerts" target="_blank" rel="noopener">/#/alerts</a>. Each quick check sends new agenda summaries and new write-ups (7 a.m. to 9 p.m.); the live check sends "starts in an hour."${d.since ? ` Announcing since ${new Date(d.since).toLocaleString()}.` : " Nothing announced yet: the first quick check after deploy marks what already exists as old news."}</p>
      <h3 style="margin-top:1rem">Send an alert to every subscriber</h3>
      <div class="row" style="align-items:flex-end;flex-wrap:wrap">
        <div class="grow"><label>Title (what shows in bold)</label><input id="pushTitle" placeholder="e.g. County Council moved to Thursday" maxlength="80"></div>
        <div class="grow" style="flex-basis:100%"><label>Message (optional)</label><input id="pushBody" placeholder="One or two sentences." maxlength="240"></div>
        <div class="grow"><label>Opens this page when tapped</label><input id="pushUrl" placeholder="/#/calendar" value="/"></div>
        <div><button id="pushSend" class="primary">Send alert</button></div>
        <div><button id="pushTest">Send a test instead</button></div>
      </div>
      <p class="muted">Goes to every phone at once and can't be unsent, so read it twice. Tapping the alert opens the page you give (a site path like <code>/#/m/council-2026-10-08</code>, or a full link).</p>`
    : `<p class="err">Not set up: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY aren't in Vercel yet. Run <code>npx web-push generate-vapid-keys</code> on your Mac, add both keys as environment variables (plus VAPID_SUBJECT = mailto:your address), and redeploy.</p>`}
    ${d.log?.length ? `<details style="margin-top:.8rem"><summary>Sent (${d.log.length})</summary>${d.log.map((e) => `<div class="issue-ev">${new Date(e.at).toLocaleString()} · <strong>${esc(e.title)}</strong> · ${e.sent} sent${e.skipped ? `, ${e.skipped} opted out` : ""}${e.dropped ? `, ${e.dropped} dropped` : ""}${e.failed ? `, <span class="err">${e.failed} failed</span>` : ""}<div class="muted">${esc(e.body || "")}</div></div>`).join("")}</details>` : ""}`;
  $("#pushTest")?.addEventListener("click", async () => { const r = await api("pushTest"); toast(`Test sent to ${r.sent}${r.failed ? `, ${r.failed} failed` : ""}.`); pushSettings(); });
  $("#pushSend")?.addEventListener("click", async () => {
    const title = $("#pushTitle").value.trim(), body = $("#pushBody").value.trim(), url = $("#pushUrl").value.trim() || "/";
    if (!title) return toast("Give the alert a title.");
    if (!confirm(`Send to ${d.subscribers} phone${d.subscribers === 1 ? "" : "s"}?\n\n${title}\n${body}`)) return;
    const r = await api("pushSend", { title, body, url }); toast(`Sent to ${r.sent}${r.failed ? `, ${r.failed} failed` : ""}.`); pushSettings();
  });
}
const cents = (c) => (c == null ? "" : c < 100 ? `${Math.round(c * 10) / 10}¢` : `$${(c / 100).toFixed(2)}`);
async function askSettings(newCode) {
  const d = await api("members");
  const box = $("#askBox");
  box.innerHTML = `
    <p>People sign in at <a href="/ask.html" target="_blank" rel="noopener">${esc(location.origin)}/ask.html</a> with a code you give them. You can use it with your review code, no separate sign-in.</p>
    ${newCode ? `<div class="hold" style="background:var(--soft);border-color:var(--accent)"><strong>Code for ${esc(newCode.member.name)}:</strong> <code style="font-size:1.1rem">${esc(newCode.code)}</code><div class="meta">Copy it now. It isn't shown again; if it's lost, turn this one off and make a new one.</div></div>` : ""}
    <p><strong>${cents(d.monthCents)}</strong> spent this month of a <strong>${cents(d.config.monthlyCents)}</strong> limit.</p>
    <div class="row" style="align-items:flex-end;margin-bottom:1rem">
      <div><label>Monthly limit for everyone ($)</label><input id="capM" type="number" min="0" step="1" value="${d.config.monthlyCents / 100}"></div>
      <div><label>Default daily limit per person ($)</label><input id="capD" type="number" min="0" step="0.25" value="${d.config.dailyCents / 100}"></div>
      <div><button id="saveCaps">Save limits</button></div>
    </div>
    <table><thead><tr><th>Name</th><th>Can see research</th><th>Daily limit</th><th>Today</th><th>Code</th></tr></thead><tbody>
      ${d.members.map((m) => `<tr><td>${esc(m.name)}</td><td><input type="checkbox" data-research="${m.id}" ${m.research ? "checked" : ""} style="width:auto"></td><td><input data-daily="${m.id}" type="number" min="0" step="0.25" placeholder="default" value="${m.dailyCents != null ? m.dailyCents / 100 : ""}" style="width:7rem"></td><td>${cents(m.today)}</td><td>${m.active ? `<button data-off="${m.id}" class="danger">Turn off</button>` : `<span class="muted">Off</span> <button data-on="${m.id}">Turn on</button>`}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">No one yet.</td></tr>`}
    </tbody></table>
    <div class="row" style="align-items:flex-end;margin-top:.8rem">
      <div class="grow"><label>Add someone</label><input id="mName" placeholder="Name"></div>
      <div><label><input id="mResearch" type="checkbox" style="width:auto"> Can see research (flags, repeat players)</label></div>
      <div><button id="addMember" class="primary">Create code</button></div>
    </div>
    <details style="margin-top:1rem"><summary>Recent questions (${d.log.length})</summary>
      ${d.log.map((e) => `<div class="issue-ev"><strong>${esc(e.memberName)}</strong> · ${new Date(e.at).toLocaleString()} · ${esc(e.mode)} · ${cents(e.costCents)}${e.pinned ? " · pinned" : ""}<div>${esc(e.question)}</div><div class="meta">${esc(e.answer)}</div></div>`).join("") || `<p class="muted">None yet.</p>`}
    </details>`;
  $("#saveCaps").onclick = async () => { await api("askConfig", { monthlyCents: Math.round(+$("#capM").value * 100), dailyCents: Math.round(+$("#capD").value * 100) }); toast("Limits saved."); askSettings(); };
  $("#addMember").onclick = async () => { const name = $("#mName").value.trim(); if (!name) return toast("Add a name."); const r = await api("addMember", { name, research: $("#mResearch").checked }); askSettings(r); };
  box.onchange = async (e) => {
    const t = e.target;
    if (t.dataset.research) { await api("updateMember", { id: t.dataset.research, patch: { research: t.checked } }); toast("Saved."); }
    if (t.dataset.daily !== undefined && t.dataset.daily) { await api("updateMember", { id: t.dataset.daily, patch: { dailyCents: t.value === "" ? null : Math.round(+t.value * 100) } }); toast("Saved."); }
  };
  box.onclick = async (e) => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.off) { await api("updateMember", { id: t.dataset.off, patch: { active: false } }); askSettings(); }
    if (t.dataset.on) { await api("updateMember", { id: t.dataset.on, patch: { active: true } }); askSettings(); }
  };
}

const rosterRow = (r) => `<div class="row rrow" style="margin-bottom:.4rem">
  <div class="grow"><input name="n" placeholder="Name" value="${esc(r.name)}"></div>
  <div><input name="t" placeholder="Title (optional)" value="${esc(r.title)}"></div>
  <div><select name="p">${[["", "Party"], ["R", "Republican"], ["D", "Democrat"], ["I", "Independent"]].map(([v, l]) => `<option value="${v}" ${v === (r.party || "") ? "selected" : ""}>${l}</option>`).join("")}</select></div>
</div>`;

function bookmarklet(origin) {
  const code = `(async()=>{const O=${JSON.stringify(origin)};const id=new URLSearchParams(location.search).get('v');if(!/youtube\\.com$/.test(location.hostname)||!id){alert('Open the meeting video on YouTube first.');return}const w=window.open(O+'/receive.html','vtreceive','width=420,height=320');const q='ytd-transcript-segment-renderer,transcript-segment-view-model';const S=(ms)=>new Promise(r=>setTimeout(r,ms));let segs=document.querySelectorAll(q);if(!segs.length){document.querySelector('#description #expand, tp-yt-paper-button#expand')?.click();await S(700);const b=[...document.querySelectorAll('button')].find(b=>/show transcript/i.test((b.getAttribute('aria-label')||'')+' '+b.textContent));if(!b){w&&w.close();alert('This video has no transcript button.');return}b.click();for(let i=0;i<40&&!(segs=document.querySelectorAll(q)).length;i++)await S(500);await S(800);segs=document.querySelectorAll(q)}const out=[...segs].map(s=>{const ts=(s.querySelector('.segment-timestamp')||{}).textContent;const tx=(s.querySelector('.segment-text')||{}).textContent;if(ts&&tx)return[ts.trim(),tx.trim()];const p=s.innerText.trim().split(/\\n+/);return[p[0].trim(),p.slice(1).join(' ').replace(/^\\s*\\d+ (hours?|minutes?|seconds?)(, \\d+ (minutes?|seconds?))*\\s*/,'').trim()]}).filter(x=>/^\\d/.test(x[0])&&x[1]);const meta=(n)=>(document.querySelector('meta[itemprop="'+n+'"]')||{}).content||'';const title=(document.querySelector('h1.ytd-watch-metadata, h1 yt-formatted-string')||{}).textContent||document.title.replace(/ - YouTube$/,'');const date=(meta('uploadDate')||meta('datePublished')).slice(0,10);const iso=meta('duration').match(/PT(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+)S)?/)||[];const duration=Math.round((document.querySelector('video')||{}).duration||0)||((+iso[1]||0)*3600+(+iso[2]||0)*60+(+iso[3]||0));const own=(document.querySelector('ytd-watch-metadata #owner a[href*="/@"], ytd-video-owner-renderer a[href*="/@"]')||{}).href||'';const channelId=meta('channelId')||(own.match(/@[^/?]+/)||[''])[0];const data={videoId:id,channelId,title:title.trim(),date,duration,segments:out};const h=(e)=>{if(e.origin!==O||e.data!=='vt-ready')return;w.postMessage({vt:data},O);window.removeEventListener('message',h)};window.addEventListener('message',h)})()`;
  return "javascript:" + encodeURIComponent(code);
}


// ---------- Posts: Facebook drafts from the public record
// Tabs: Ideas (what's worth posting), Drafts (list + one open editor), Posted (compact history), Style.
let PO = null; // posts overview cache
const PCOST = "about 1–2¢";
let POST_TAB = sessionStorage.getItem("posts-tab") || "";
let POST_SEL = null; // key of the open draft or posted item
const OLD_DAYS = 14;
const narrow = () => window.matchMedia("(max-width: 800px)").matches;
const ago = (iso) => { const d = (Date.now() - Date.parse(iso)) / 864e5; return d < 1 ? "today" : d < 2 ? "yesterday" : `${Math.floor(d)} days ago`; };
const draftTitle = (d) => d?.card?.headline || (d?.text || "").split("\n")[0].slice(0, 90);

async function viewPosts(opts = {}) {
  if (!opts.keep || !PO) PO = await api("posts");
  if (opts.tab) POST_TAB = opts.tab;
  if (opts.sel !== undefined) POST_SEL = opts.sel;
  const postedKeys = new Set(PO.log.map((l) => l.key));
  const open = PO.drafts.filter((d) => !postedKeys.has(d.key));
  if (!POST_TAB) POST_TAB = open.length ? "drafts" : "ideas";
  sessionStorage.setItem("posts-tab", POST_TAB);
  const ideas = PO.suggestions.filter((s) => !s.posted && !s.dismissed);
  const tabs = [["ideas", `Ideas (${ideas.length})`], ["drafts", `Drafts (${open.length})`], ["posted", `Posted (${PO.log.length})`], ["style", "Style"]];
  const v = $("#view");
  v.innerHTML = `<div class="ptop"><h1>Posts</h1><div class="ptabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" class="${POST_TAB === k ? "on" : ""}" data-tab="${k}">${l}</button>`).join("")}</div></div><div id="pbody"></div>`;
  v.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => viewPosts({ keep: true, tab: b.dataset.tab, sel: null }));
  const body = $("#pbody");
  if (POST_TAB === "ideas") return ideasTab(body, ideas);
  if (POST_TAB === "drafts") return draftsTab(body, open);
  if (POST_TAB === "posted") return postedTab(body);
  body.innerHTML = `<div class="card" id="pStyle"></div>`; styleForm();
}

function ideasTab(body, ideas) {
  const hidden = PO.suggestions.filter((s) => s.dismissed && !s.posted);
  const typeOpts = Object.entries(PO.types).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join("");
  const drafted = new Map(PO.drafts.map((d) => [d.key, d]));
  body.innerHTML = `<div class="card pmake"><div class="row">
      <div><label>Draft a post</label><select id="pType">${typeOpts}</select></div>
      <div class="grow"><label>About</label><select id="pRef"></select></div>
      <div style="flex:0 0 auto"><button class="primary" id="pGo">Draft (${PCOST})</button></div></div></div>
    <p class="muted">Worth posting now. Suggestions are free; drafting costs ${PCOST}.</p>
    <div class="card plist">${ideas.length ? ideas.map((s, i) => `<div class="ps-row">
      <div><span class="lbl">${esc(s.label)}</span> <b>${esc(s.title)}</b><div class="meta">${esc(s.why)}</div></div>
      <div class="actions"><button class="linkish" data-dismiss="${esc(s.key)}" title="Hide this idea">Not posting</button>${drafted.has(s.key) ? `<button data-open="${esc(s.key)}">Open draft</button>` : `<button class="primary" data-sug="${i}">Draft</button>`}</div></div>`).join("") : `<p class="muted">Nothing new right now.</p>`}</div>
    ${hidden.length ? `<details class="pold"><summary>Not posting (${hidden.length})</summary><div class="card plist">${hidden.map((s) => `<div class="ps-row"><div><span class="lbl">${esc(s.label)}</span> <span class="muted">${esc(s.title)}</span></div><div class="actions"><button class="linkish" data-undismiss="${esc(s.key)}">Bring back</button></div></div>`).join("")}</div></details>` : ""}`;
  const refsFor = (type) => type === "headsup" ? PO.targets.upcoming : type === "second" ? PO.targets.issues : type === "numbers" ? PO.targets.amounts : type === "explain" ? PO.targets.kinds : [{ ref: new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10), label: type === "week" ? "The next seven days" : "The past seven days" }];
  const fillRefs = () => { const list = refsFor($("#pType").value); $("#pRef").innerHTML = list.length ? list.map((r) => `<option value="${esc(r.ref)}">${esc(r.label)}</option>`).join("") : `<option value="">Nothing to pick</option>`; };
  $("#pType").onchange = fillRefs; fillRefs();
  $("#pGo").onclick = async (e) => { const ref = $("#pRef").value; if (!ref) return toast("Nothing to draft for that type yet."); await runDraft(e.target, { type: $("#pType").value, ref }); };
  body.querySelectorAll("[data-sug]").forEach((b) => b.onclick = async () => { const s = ideas[+b.dataset.sug]; await runDraft(b, { type: s.type, ref: s.ref, key: s.key }); });
  body.querySelectorAll("[data-open]").forEach((b) => b.onclick = () => viewPosts({ keep: true, tab: "drafts", sel: b.dataset.open }));
  body.querySelectorAll("[data-dismiss],[data-undismiss]").forEach((b) => b.onclick = async () => { const on = !!b.dataset.dismiss; await api("postDismiss", { key: b.dataset.dismiss || b.dataset.undismiss, on }); toast(on ? "Hidden. Find it under “Not posting” to bring it back." : "Back in Ideas."); await viewPosts({ tab: "ideas" }); refreshCounts(); });
}

// A list on the left, the open item on the right. On a phone: the list, or the open item with a way back.
function splitView(body, rowsHtml, emptyHtml, openEl, backLabel) {
  if (narrow() && openEl) {
    body.innerHTML = `<button class="linkish pback">← ${esc(backLabel)}</button><div id="pOpen"></div>`;
    $(".pback", body).onclick = () => viewPosts({ keep: true, sel: "" });
    $("#pOpen", body).append(openEl);
    return;
  }
  body.innerHTML = `<div class="psplit"><div class="card plist pside">${rowsHtml || emptyHtml}</div><div id="pOpen">${openEl ? "" : `<p class="muted">Pick one from the list.</p>`}</div></div>`;
  if (openEl) $("#pOpen", body).append(openEl);
}

function draftsTab(body, open) {
  const fresh = open.filter((d) => Date.now() - Date.parse(d.at) < OLD_DAYS * 864e5), old = open.filter((d) => !fresh.includes(d));
  if (POST_SEL === null) POST_SEL = narrow() ? "" : (fresh[0] || old[0])?.key || "";
  const sel = open.find((d) => d.key === POST_SEL);
  const row = (d) => `<button class="prow ${d.key === POST_SEL ? "on" : ""}" data-sel="${esc(d.key)}"><span class="lbl">${esc(d.label)}</span><b>${esc(draftTitle(d))}</b><span class="meta">${esc(ago(d.at))}${d.checks?.length ? " · check before posting" : ""}</span></button>`;
  const rows = fresh.map(row).join("") + (old.length ? `<details class="pold" ${old.some((d) => d.key === POST_SEL) ? "open" : ""}><summary>Older drafts (${old.length})</summary>${old.map(row).join("")}</details>` : "");
  splitView(body, rows, `<p class="muted">No drafts. Start one from Ideas.</p>`, sel ? draftCard(sel, false) : null, "All drafts");
  body.querySelectorAll("[data-sel]").forEach((b) => b.onclick = () => viewPosts({ keep: true, sel: b.dataset.sel }));
}

function postedTab(body) {
  const byKey = new Map(PO.drafts.map((d) => [d.key, d]));
  if (POST_SEL === null) POST_SEL = "";
  const sel = POST_SEL ? byKey.get(POST_SEL) : null;
  const rows = PO.log.map((l) => { const d = byKey.get(l.key); return `<button class="prow pposted ${l.key === POST_SEL ? "on" : ""}" data-sel="${esc(l.key)}" ${d ? "" : "disabled"}>${d ? `<canvas width="1080" height="1350" data-thumb="${esc(l.key)}"></canvas>` : `<span class="pthumb-none"></span>`}<span class="ptxt"><span class="lbl">${esc(PO.types[l.type]?.label || l.type)}</span><b>${esc(d ? draftTitle(d) : l.text.split("\n")[0])}</b><span class="meta">Posted ${esc(fmtDate(l.at.slice(0, 10)))}${d ? "" : " · draft no longer kept"}</span></span></button>`; }).join("");
  splitView(body, rows, `<p class="muted">Nothing marked as posted yet.</p>`, sel ? draftCard(sel, true) : null, "All posted");
  body.querySelectorAll("[data-thumb]").forEach((cv) => drawCard(cv, byKey.get(cv.dataset.thumb).card));
  body.querySelectorAll("[data-sel]").forEach((b) => b.onclick = () => viewPosts({ keep: true, sel: b.dataset.sel }));
}

async function runDraft(btn, body) {
  const old = btn.textContent; btn.disabled = true; btn.textContent = "Writing…";
  try { const { draft } = await api("postDraft", body); toast(`Drafted (${draft.cents}¢).`); await viewPosts({ tab: "drafts", sel: draft.key }); }
  catch (e) { btn.disabled = false; btn.textContent = old; toast(e.message, 6000); }
}

function draftCard(d, posted) {
  const el = document.createElement("div");
  el.className = "card pdraft";
  el.innerHTML = `<div class="pd-head"><div><span class="lbl">${esc(d.label)}</span> <span class="meta">${esc(new Date(d.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))} · ${d.cents}¢${d.tweak ? ` · changed: ${esc(d.tweak)}` : ""}</span></div>${posted ? `<span class="yes">Posted</span>` : ""}</div>
    ${d.checks?.length && !posted ? `<div class="check"><b>Check before posting:</b><ul>${d.checks.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>` : ""}
    <div class="pd-body">
      <div class="pd-text"><textarea rows="14">${esc(d.text)}</textarea>
        <div class="meta pd-count"></div>
        <div class="actions"><button class="primary" data-a="copy">Copy</button>${posted ? "" : `
          <button data-t="Make it shorter">Shorter</button><button data-t="Make it a bit longer, with one more useful detail from the facts">Longer</button><button data-t="Simpler words, shorter sentences">Simpler</button><button data-t="Write a fresh version">Redo</button>`}</div>
        ${posted ? "" : `<div class="row" style="margin-top:.5rem"><div class="grow"><input placeholder="Change just this post, e.g. lead with the jail" data-own></div><div style="flex:0 0 auto"><button data-a="own">Change (${PCOST})</button></div></div>`}
        <div class="actions" style="margin-top:.6rem"><button data-a="posted">${posted ? "Move back to drafts" : "Mark posted"}</button>${posted ? "" : `<button class="danger" data-a="del">Delete</button>`}</div>
      </div>
      <div class="pd-img"><canvas width="1080" height="1350"></canvas><div class="actions"><button data-a="png">Download image</button></div></div>
    </div>`;
  const ta = $("textarea", el), cnt = $(".pd-count", el);
  const count = () => { const w = ta.value.trim().split(/\s+/).filter(Boolean).length; cnt.textContent = `${w} words · ${ta.value.length} characters`; };
  ta.oninput = count; count();
  const canvas = $("canvas", el);
  drawCard(canvas, d.card);
  const tweak = async (btn, t) => { const old = btn.textContent; btn.disabled = true; btn.textContent = "Writing…"; try { const { draft } = await api("postDraft", { type: d.type, ref: d.ref, key: d.key, tweak: t, current: ta.value }); toast(`Changed (${draft.cents}¢).`); await viewPosts({ sel: d.key }); } catch (e) { btn.disabled = false; btn.textContent = old; toast(e.message, 6000); } };
  el.querySelectorAll("[data-t]").forEach((b) => b.onclick = () => tweak(b, b.dataset.t));
  el.querySelector('[data-a="own"]')?.addEventListener("click", (e) => { const t = $("[data-own]", el).value.trim(); if (!t) return toast("Say what to change."); tweak(e.target, t); });
  el.querySelector('[data-a="copy"]').onclick = async () => { try { await navigator.clipboard.writeText(ta.value); toast("Copied. Paste it into Facebook."); } catch (e) { ta.select(); document.execCommand("copy"); toast("Copied."); } };
  el.querySelector('[data-a="posted"]').onclick = async () => { await api("postMark", { key: d.key, on: !posted }); toast(posted ? "Back in Drafts." : "Moved to Posted."); await viewPosts({ sel: null }); };
  el.querySelector('[data-a="del"]')?.addEventListener("click", async () => { if (!confirm("Delete this draft?")) return; await api("postDelete", { key: d.key }); await viewPosts({ sel: null }); });
  el.querySelector('[data-a="png"]').onclick = () => { const a = document.createElement("a"); a.download = `second-reading-${d.key.replace(/[^\w-]+/g, "-")}.png`; a.href = canvas.toDataURL("image/png"); a.click(); };
  return el;
}

// The post image. One board: that board's color from the site, white type. Several boards (or none): white, with a
// strip of each board's color across the top. Each post type has its own layout; only real sequences get numbered steps.
const BOARD_COLOR = { council: "#0b7a6e", commissioners: "#8a5a00", plan: "#5b8a3c", "city-council": "#2b6cb0", "city-plan": "#6b4fbb", "city-bza": "#6b4fbb", "city-works": "#6b4fbb" };
async function drawCard(cv, card) {
  try { await Promise.all(['700 80px "Fraunces"', 'italic 400 30px "Lora"', '400 30px "Inter"', '800 40px "Inter"'].map((f) => document.fonts.load(f))); } catch (e) {}
  const boards = (card.boards || []).filter((b) => BOARD_COLOR[b]);
  const one = boards.length === 1 ? BOARD_COLOR[boards[0]] : null;
  const C = { bg: one || "#ffffff", ink: one ? "#ffffff" : "#1c1c1c", soft: one ? "rgba(255,255,255,.88)" : "#3a3a3a", faint: one ? "rgba(255,255,255,.45)" : "#b9b5ad", rule: one ? "rgba(255,255,255,.35)" : "#e2dfd8" };
  const colorOf = (b) => one ? C.ink : BOARD_COLOR[b] || "#1c1c1c";
  const x = cv.getContext("2d"), W = 1080, H = 1350, L = 88, R = W - 88, BOTTOM = H - 140;
  x.fillStyle = C.bg; x.fillRect(0, 0, W, H); x.textBaseline = "alphabetic"; x.textAlign = "left";
  if (!one) { const cols = [...new Set(boards.map((b) => BOARD_COLOR[b]))]; const list = cols.length ? cols : ["#1c1c1c"]; list.forEach((c, i) => { x.fillStyle = c; x.fillRect((W / list.length) * i, 0, W / list.length + 1, 22); }); }
  const font = (f) => (x.font = f);
  const wrap = (text, f, width) => { font(f); const out = []; let line = ""; for (const w of String(text || "").split(/\s+/).filter(Boolean)) { const t = line ? line + " " + w : w; if (x.measureText(t).width > width && line) { out.push(line); line = w; } else line = t; } if (line) out.push(line); return out; };
  const text = (t, f, color, X, Y, align = "left") => { font(f); x.fillStyle = color; x.textAlign = align; x.fillText(t, X, Y); x.textAlign = "left"; };
  const fit = (t, weight, family, max, min, width, maxLines) => { let s = max, ls; do { ls = wrap(t, `${weight} ${s}px ${family}`, width); s -= 4; } while ((ls.length > maxLines || ls.some((l) => x.measureText(l).width > width)) && s > min); return { size: s + 4, lines: ls }; };
  const pill = (t, X, Y) => { font('700 26px "Inter", sans-serif'); const w = x.measureText(t).width + 28; x.fillStyle = one ? "rgba(255,255,255,.18)" : "#f3eee2"; x.beginPath(); x.roundRect(X, Y - 30, w, 42, 21); x.fill(); x.fillStyle = C.ink; x.fillText(t, X + 14, Y); return w; };

  text("Second Reading", '700 40px "Fraunces", Georgia, serif', C.ink, L, 116);
  text(card.series || "", 'italic 400 32px "Lora", Georgia, serif', C.ink, R, 116, "right");
  text("SecondReading.org", '800 44px "Inter", sans-serif', C.ink, L, H - 62);
  text("Kokomo and Howard County", 'italic 400 28px "Lora", Georgia, serif', C.soft, R, H - 64, "right");
  const header = (maxSize = 112) => {
    const h = fit(card.headline, 700, '"Fraunces", Georgia, serif', maxSize, 56, R - L, (card.items?.length || card.rows?.length || card.steps?.length || 0) >= 4 ? 2 : 3);
    let y = 158 + h.size; for (const l of h.lines) { text(l, `700 ${h.size}px "Fraunces", Georgia, serif`, C.ink, L, y); y += h.size * 0.98; }
    if (card.sub) { y += 10; for (const l of wrap(card.sub, 'italic 400 36px "Lora", Georgia, serif', R - L)) { text(l, 'italic 400 36px "Lora", Georgia, serif', C.soft, L, y); y += 46; } }
    return y + 30;
  };
  const layout = card.layout || "items";

  if (layout === "number") {
    // Plan every line, then shrink everything together until it fits between the header and the footer
    const plan = (k) => {
      const out = []; let y = 170;
      const fig = fit(card.figure || card.headline, 700, '"Fraunces", Georgia, serif', Math.round(220 * k), 70, R - L, 1);
      const figLines = fig.lines.length === 1 && x.measureText(fig.lines[0]).width <= R - L ? fig : fit(card.figure || card.headline, 700, '"Fraunces", Georgia, serif', Math.round(170 * k), 60, R - L, 2);
      for (const l of figLines.lines) { y += figLines.size * 0.92; out.push([l, `700 ${figLines.size}px "Fraunces", Georgia, serif`, C.ink, y]); y += figLines.size * 0.12; }
      if (card.figure && card.headline) { const hs = Math.round(68 * k); y += 34 * k; for (const l of wrap(card.headline, `700 ${hs}px "Fraunces", Georgia, serif`, R - L)) { y += hs; out.push([l, `700 ${hs}px "Fraunces", Georgia, serif`, C.ink, y]); y += hs * 0.08; } }
      if (card.sub) { const ss = Math.round(38 * k); y += 18 * k; for (const l of wrap(card.sub, `italic 400 ${ss}px "Lora", Georgia, serif`, R - L)) { y += ss * 1.3; out.push([l, `italic 400 ${ss}px "Lora", Georgia, serif`, C.soft, y]); } }
      let rule = null; const ctxStart = out.length;
      if ((card.context || []).length) { y += 44 * k; rule = y; y += 20 * k; const cs = Math.round(38 * k); for (const c of card.context) { y += 18 * k; for (const l of wrap(c, `400 ${cs}px "Inter", sans-serif`, R - L)) { y += cs * 1.32; out.push([l, `400 ${cs}px "Inter", sans-serif`, C.ink, y]); } } }
      // Spare room goes above the context, so it sits just over the footer instead of leaving a hole at the bottom
      const spare = BOTTOM - 40 - y;
      if (rule != null && spare > 0) { rule += spare; for (let i = ctxStart; i < out.length; i++) out[i][3] += spare; }
      return { out, rule, end: y };
    };
    let k = 1, pl = plan(k);
    while (pl.end > BOTTOM - 20 && k > 0.55) { k -= 0.05; pl = plan(k); }
    if (pl.rule) { x.fillStyle = C.rule; x.fillRect(L, pl.rule, R - L, 3); }
    for (const [t, f, c, y] of pl.out) text(t, f, c, L, y);
    return;
  }

  const top = header();
  if (layout === "week") {
    const rows = card.rows || []; const avail = BOTTOM - top; const rowH = Math.min(190, avail / Math.max(1, rows.length));
    const ts = rowH < 110 ? 26 : rowH < 150 ? 30 : 36; let y = top;
    rows.forEach((r, i) => {
      if (i) { x.fillStyle = C.rule; x.fillRect(L, y, R - L, 2); }
      const by = y + ts + 18;
      text(r.day, `800 ${ts + 12}px "Inter", sans-serif`, C.ink, L, by + 4);
      text(r.date, `400 ${ts - 2}px "Inter", sans-serif`, C.soft, L, by + ts + 10);
      const X = L + 190;
      font(`800 ${ts}px "Inter", sans-serif`); x.fillStyle = colorOf(r.board); x.fillText(r.boardName, X, by);
      const bw = x.measureText(r.boardName).width; if (r.time) text("  " + r.time, `400 ${ts}px "Inter", sans-serif`, C.soft, X + bw, by);
      const ls = wrap(r.line, `400 ${ts}px "Inter", sans-serif`, R - X).slice(0, rowH < 100 ? 1 : 2);
      ls.forEach((l, k) => text(k === ls.length - 1 && wrap(r.line, `400 ${ts}px "Inter", sans-serif`, R - X).length > ls.length ? l.replace(/\s*\S*$/, "…") : l, `400 ${ts}px "Inter", sans-serif`, C.ink, X, by + (k + 1) * (ts * 1.3)));
      y += rowH;
    });
    return;
  }

  if (layout === "steps") {
    const steps = card.steps || []; const avail = BOTTOM - top - 40; const gapH = Math.min(230, avail / Math.max(1, steps.length)); const big = gapH >= 170, tS = big ? 46 : 36, bS = big ? 34 : 30;
    const cx = L + 36; let y = top + 36;
    if (steps.length > 1) { x.fillStyle = C.rule; x.fillRect(cx - 2.5, y, 5, gapH * (steps.length - 1)); }
    steps.forEach((st, i) => {
      const col = colorOf(st.board), later = st.state === "later";
      if (st.state === "done") { x.fillStyle = col; x.beginPath(); x.arc(cx, y, 36, 0, Math.PI * 2); x.fill(); x.strokeStyle = C.bg; x.lineWidth = 7; x.beginPath(); x.moveTo(cx - 14, y + 1); x.lineTo(cx - 3, y + 12); x.lineTo(cx + 16, y - 11); x.stroke(); }
      else if (st.state === "next") { x.fillStyle = C.bg; x.beginPath(); x.arc(cx, y, 36, 0, Math.PI * 2); x.fill(); x.strokeStyle = col; x.lineWidth = 8; x.stroke(); text(String(i + 1), '800 32px "Inter", sans-serif', col, cx, y + 11, "center"); }
      else if (later) { x.fillStyle = C.bg; x.beginPath(); x.arc(cx, y, 36, 0, Math.PI * 2); x.fill(); x.strokeStyle = C.faint; x.lineWidth = 4; x.stroke(); text(String(i + 1), '700 30px "Inter", sans-serif', C.faint, cx, y + 10, "center"); }
      else { x.fillStyle = col; x.beginPath(); x.arc(cx, y, 36, 0, Math.PI * 2); x.fill(); text(String(i + 1), '800 32px "Inter", sans-serif', one ? C.bg : "#ffffff", cx, y + 11, "center"); }
      const X = L + 110;
      const tl = wrap(st.title + (st.state === "next" ? "  ← next" : ""), `800 ${tS}px "Inter", sans-serif`, R - X).slice(0, 2);
      tl.forEach((l, k) => text(l, `800 ${tS}px "Inter", sans-serif`, later ? C.faint : C.ink, X, y + tS * 0.35 + k * tS * 1.15 - (tl.length - 1) * tS * 0.6));
      text(st.boardName + (st.final ? " · final say" : ""), `400 ${bS}px "Inter", sans-serif`, later ? C.faint : one ? C.soft : colorOf(st.board), X, y + tS * 0.35 + (tl.length - 1) * tS * 0.55 + bS * 1.35);
      y += gapH;
    });
    return;
  }

  // items: separate matters, no numbers; each item's tag and note stay with it
  const items = (card.items || (card.points || []).map((p) => ({ title: p.label, text: p.text, board: p.board })));
  let ts = 44;
  const measure = (ts) => items.map((it) => ({ it, body: wrap(it.text, `400 ${ts}px "Inter", sans-serif`, R - L - 28), note: it.note ? wrap(it.note, `italic 400 ${ts - 2}px "Lora", Georgia, serif`, R - L - 28 - (it.tag ? 240 : 0)) : [] }))
    .map((o) => ({ ...o, h: ts * 1.25 + 14 + o.body.length * ts * 1.3 + (o.it.tag || o.note.length ? 20 + Math.max(42, o.note.length * ts * 1.25) : 0) }));
  let m = measure(ts);
  const total = (m) => m.reduce((a, o) => a + o.h, 0) + 56 * (m.length - 1);
  while (total(m) > BOTTOM - top && ts > 24) { ts -= 2; m = measure(ts); }
  while (m.length > 1 && total(m) > BOTTOM - top) m = m.slice(0, -1); // never run into the footer: drop the least important item
  const gap = Math.min(80, Math.max(40, (BOTTOM - top - m.reduce((a, o) => a + o.h, 0)) / Math.max(1, m.length - 1) / 1.6));
  let y = top;
  m.forEach((o, i) => {
    if (i) { x.fillStyle = C.rule; x.fillRect(L, y - gap / 2, R - L, 2); }
    x.fillStyle = colorOf(o.it.board); x.fillRect(L, y + 4, 8, o.h - 8);
    const X = L + 28; let by = y + ts * 1.1;
    text(o.it.title, `800 ${Math.round(ts * 1.25)}px "Inter", sans-serif`, C.ink, X, by); by += 14 + ts * 1.15;
    for (const l of o.body) { text(l, `400 ${ts}px "Inter", sans-serif`, C.soft, X, by); by += ts * 1.3; }
    if (o.it.tag || o.note.length) { by += 22; let nx = X; if (o.it.tag) nx += pill(o.it.tag, X, by) + 18; o.note.forEach((l, k) => text(l, `italic 400 ${ts - 2}px "Lora", Georgia, serif`, C.ink, nx, by + k * ts * 1.25)); }
    y += o.h + gap;
  });
}

function styleForm() {
  const s = PO.style, el = $("#pStyle");
  const sel = (id, val, opts) => `<select id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${v === val ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  el.innerHTML = `<div class="grid">
    <div><label>Voice</label>${Object.entries(PO.voices).map(([k, t]) => `<label class="radio"><input type="radio" name="voice" value="${k}" ${s.voice === k ? "checked" : ""}> <b>${k}</b> ${esc(t)}</label>`).join("")}</div>
    <div class="row">
      <div><label>First line</label>${sel("sFirst", s.firstLine, [["news", "The news itself"], ["date", "Day and board first"]])}</div>
      <div><label>Item lead-ins</label>${sel("sLead", s.leadIns, [["labels", "Labels (“The rezoning: …”)"], ["sentences", "Full sentences"]])}</div>
      <div><label>Emoji</label>${sel("sEmoji", s.emoji, [["none", "None"], ["one", "One per item"]])}</div>
    </div>
    <div class="row">
      <label class="radio"><input type="checkbox" id="sWho" ${s.whoDecides ? "checked" : ""}> “Who decides:” line</label>
      <label class="radio"><input type="checkbox" id="sFine" ${s.finePrint ? "checked" : ""}> “Fine print:” line when there's a telling detail</label>
    </div>
    <div class="row">
      <div class="grow"><label>Before the link (blank for just the link)</label><input id="sLinkLead" value="${esc(s.linkLead)}" placeholder="Every item, in plain language:"></div>
      <div class="grow"><label>Sign-off (blank for none)</label><input id="sSign" value="${esc(s.signoff)}" placeholder="So every vote has a witness."></div>
    </div>
    <div><label>Never use these words (comma-separated)</label><textarea id="sBanned" rows="2">${esc((s.banned || []).join(", "))}</textarea></div>
    <div><label>Length in words</label><div class="row">${Object.entries(PO.types).map(([k, t]) => `<div><label>${esc(t.label)}</label><div class="lenpair"><input type="number" data-wlo="${k}" value="${s.words?.[k]?.[0] ?? t.words[0]}"> to <input type="number" data-whi="${k}" value="${s.words?.[k]?.[1] ?? t.words[1]}"></div></div>`).join("")}</div></div>
    <div><label>Voice notes (added to every draft)</label><textarea id="sNotes" rows="3" placeholder="e.g. Say Kokomo, not the City of Kokomo.">${esc(s.notes)}</textarea></div>
    <div class="actions"><button id="sTry">Try it (${PCOST})</button><button class="primary" id="sSave">Save</button><button id="sReset">Reset to defaults</button></div>
    <div id="sTryOut"></div></div>`;
  const read = () => ({
    voice: el.querySelector('input[name="voice"]:checked')?.value || "C", firstLine: $("#sFirst").value, leadIns: $("#sLead").value, emoji: $("#sEmoji").value,
    whoDecides: $("#sWho").checked, finePrint: $("#sFine").checked, linkLead: $("#sLinkLead").value.trim(), signoff: $("#sSign").value.trim(),
    banned: $("#sBanned").value.split(",").map((w) => w.trim()).filter(Boolean), notes: $("#sNotes").value.trim(),
    words: Object.fromEntries(Object.keys(PO.types).map((k) => [k, [+el.querySelector(`[data-wlo="${k}"]`).value, +el.querySelector(`[data-whi="${k}"]`).value]])),
  });
  $("#sSave").onclick = async () => { PO.style = (await api("postStyle", { style: read() })).style; toast("Style saved. New drafts will use it."); };
  $("#sReset").onclick = async () => { if (!confirm("Put back the default style?")) return; PO.style = (await api("postStyle", { style: PO.defaults })).style; styleForm(); toast("Defaults restored."); };
  $("#sTry").onclick = async (e) => {
    const b = e.target; b.disabled = true; b.textContent = "Writing…";
    try { const { draft } = await api("postTry", { style: read() }); $("#sTryOut").innerHTML = `<p class="meta">A real ${esc(draft.label)} post with these settings (not saved, ${draft.cents}¢):</p><pre class="pd-try">${esc(draft.text)}</pre>`; }
    catch (err) { toast(err.message, 6000); }
    b.disabled = false; b.textContent = `Try it (${PCOST})`;
  };
}

route();
