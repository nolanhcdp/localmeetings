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
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function showLogin(err = "") { $("#login").hidden = false; $("#view").innerHTML = ""; $("#loginErr").textContent = err; }
$("#loginForm").addEventListener("submit", (e) => { e.preventDefault(); CODE = $("#codeInput").value.trim(); store.set("vt-admin", CODE); $("#login").hidden = true; route(); });

// ---------- Router
window.addEventListener("hashchange", route);
async function route() {
  if (!CODE) return showLogin();
  const h = location.hash.slice(1) || "/";
  document.querySelectorAll(".top nav a").forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + h || (h.startsWith("/m/") && a.getAttribute("href") === "#/") || (h.startsWith("/ref/") && a.getAttribute("href") === "#/library")));
  try {
    if (h.startsWith("/m/")) return await viewMeeting(decodeURIComponent(h.slice(3)));
    if (h === "/videos") return await viewVideos();
    if (h === "/issues") return await viewIssues();
    if (h === "/library") return await viewLibrary();
    if (h.startsWith("/ref/")) return await viewRef(decodeURIComponent(h.slice(5)));
    if (h === "/settings") return await viewSettings();
    return await viewMeetings();
  } catch (e) { if (e.message !== "auth") $("#view").innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

// ---------- Meetings list
let FILTER = store.get("vt-filter") || "review";
let BODYF = store.get("vt-body") || "";
async function viewMeetings() {
  OV = await api("overview"); setBodies(OV.bodies);
  const ms = OV.meetings.filter((m) => !BODYF || m.body === BODYF);
  const counts = { review: ms.filter((m) => m.status === "drafted").length, ready: ms.filter((m) => m.ready).length, waiting: ms.filter((m) => m.status === "waiting" && !m.ready).length, approved: ms.filter((m) => m.status === "approved").length, all: ms.length };
  const show = ms.filter((m) => FILTER === "all" ? true : FILTER === "review" ? m.status === "drafted" || m.status === "error" : FILTER === "ready" ? m.ready : FILTER === "waiting" ? m.status === "waiting" && !m.ready : m.status === "approved");
  const unsorted = OV.videos.filter((v) => !v.meetingId && !["other", "budget"].includes(v.body)).length;
  const lr = OV.lastRun;
  $("#view").innerHTML = `
    <div class="toolbar">
      <div>
        <h1>Meetings</h1>
        <div class="meta">${lr ? `Last daily check ${new Date(lr.at).toLocaleString()}${lr.errors?.length ? ` · <span class="err">${lr.errors.length} problem(s)</span>` : ""}` : "The daily check hasn't run yet."}${unsorted ? ` · <a href="#/videos">${unsorted} video(s) need a meeting</a>` : ""}</div>
      </div>
      <div class="actions">
        <label class="btn" title="Drafts or reference documents made outside the app (.json)">Import<input id="importFile" type="file" accept=".json,application/json" multiple hidden></label>
        <button id="scan">Check for new documents</button>
        <button id="draftAll" class="primary" ${counts.ready ? "" : "disabled"}>Draft all ready (${counts.ready})</button>
      </div>
    </div>
    <div class="filter" style="margin-bottom:.8rem">
      <select id="bodyF" style="width:auto"><option value="">All boards</option>${Object.entries(BODY_NAMES).map(([k, n]) => `<option value="${k}" ${k === BODYF ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>
      ${[["review", "To review"], ["ready", "Ready to draft"], ["waiting", "Waiting on sources"], ["approved", "Approved"], ["all", "All"]].map(([k, l]) => `<button data-f="${k}" class="${FILTER === k ? "on" : ""}">${l} (${counts[k]})</button>`).join("")}
    </div>
    <p id="progress" class="meta"></p>
    ${show.length ? `<table><thead><tr><th>Date</th><th>Body</th><th>Sources</th><th>Status</th><th></th></tr></thead><tbody>
      ${show.map((m) => `<tr>
        <td>${fmtDate(m.date)}</td>
        <td>${BODY_NAMES[m.body] || m.body}</td>
        <td class="src">${src("Agenda", m.hasPacket, OV.bodies?.[m.body]?.docs === null)}${src("Minutes", m.hasMinutes, OV.bodies?.[m.body]?.docs === null)}${m.hasVideo && !m.hasTranscript ? `<span class="no" title="Video found, transcript not in yet. The Mac job retries each morning.">Video, no transcript yet</span>` : src("Video", m.hasVideo)}</td>
        <td>${statusText(m)}</td>
        <td style="text-align:right">${m.ready ? `<button data-draft="${m.id}">Draft</button> ` : ""}${m.status === "drafted" || m.status === "approved" || m.status === "error" ? `<a class="btn ${m.status === "drafted" ? "primary" : ""}" href="#/m/${encodeURIComponent(m.id)}">${m.status === "approved" ? "Open" : "Review"}</a>` : ""}</td>
      </tr>`).join("")}
    </tbody></table>` : `<p class="muted">Nothing here.</p>`}`;
  $("#bodyF").onchange = (e) => { BODYF = e.target.value; store.set("vt-body", BODYF); viewMeetings(); };
  document.querySelectorAll("[data-f]").forEach((b) => b.onclick = () => { FILTER = b.dataset.f; store.set("vt-filter", FILTER); viewMeetings(); });
  document.querySelectorAll("[data-draft]").forEach((b) => b.onclick = () => draftMany([b.dataset.draft]));
  $("#draftAll").onclick = () => draftMany(ms.filter((m) => m.ready).sort((a, b) => a.date.localeCompare(b.date)).map((m) => m.id));
  $("#importFile").onchange = async (e) => {
    const files = [];
    try { for (const f of e.target.files) files.push(JSON.parse(await f.text())); } catch (err) { return toast("One of those files isn't valid JSON."); }
    try { const r = await api("import", { files }); toast(r.done.join(" · "), 6000); viewMeetings(); } catch (err) { toast(err.message, 6000); }
    e.target.value = "";
  };
  $("#scan").onclick = async () => { $("#scan").disabled = true; try { const r = await api("scan"); toast(`Found ${r.packets} documents, ${r.created.length} new meetings.${r.city?.error ? " Kokomo site: " + r.city.error : ""}`, 5000); viewMeetings(); } catch (e) { toast(e.message); $("#scan").disabled = false; } };
}
const src = (label, ok, na) => na ? `<span class="no" title="Not posted online for this body">${label} n/a</span>` : `<span class="${ok ? "yes" : "no"}">${label} ${ok ? "✓" : "–"}</span>`;
function statusText(m) {
  if (m.status === "drafted") return `<span class="status-drafted">Draft ready</span> <span class="meta">${m.items} items${m.needsCheck ? `, ${m.needsCheck} to check` : ""}${m.minutesArrivedAfterDraft ? ", minutes now posted" : ""}${m.videoArrivedAfterDraft ? ", video now in" : ""}</span>`;
  if (m.status === "approved") return `<span class="status-approved">Approved</span> <span class="meta">${m.items} items</span>`;
  if (m.status === "error") return `<span class="status-error">Problem:</span> <span class="meta">${esc(m.error)}</span>`;
  if (m.status === "drafting") return "Drafting…";
  if (m.status === "skipped") return `<span class="muted">Skipped</span>`;
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
  FILTER = "review"; store.set("vt-filter", FILTER);
  await viewMeetings();
  if (failed.length) $("#progress").innerHTML = `<span class="err">${failed.map(esc).join("<br>")}</span>`;
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
    <p><a href="#/">← Meetings</a></p>
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
        <div id="items"></div>
        <p><button id="addItem">Add an item</button></p>
        <div class="stickybar actions">
          ${m.status === "approved"
            ? `<button id="saveBtn" class="primary">Save changes</button><button id="unapprove">Move back to drafts</button>`
            : `<button id="approveBtn" class="primary">Approve</button><button id="saveBtn">Save without approving</button>`}
          <button id="redraft">Redraft with Claude</button>
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
  renderItems();
  $("#view").addEventListener("input", (e) => { if (e.target.matches("[data-k]") && !e.target.closest("#items")) { setPath(CUR.record, e.target.dataset.k, e.target.value); markDirty(); } });
  $("#addItem").onclick = () => { CUR.record.items.push({ title: "New item", whatItIs: "", category: "other", stage: "discussed", vote: { method: "none", result: "no vote" }, confidence: "high", sources: [] }); renderItems(); markDirty(); };
  $("#saveBtn").onclick = () => save(false);
  if ($("#approveBtn")) $("#approveBtn").onclick = () => save(true);
  if ($("#unapprove")) $("#unapprove").onclick = async () => { await api("unapprove", { id: m.id }); toast("Moved back to drafts."); viewMeeting(m.id); };
  if ($("#skip")) $("#skip").onclick = async () => { if (!confirm("Skip this meeting? It won't be drafted or published. You can undo this from All.")) return; await api("skip", { id: m.id }); location.hash = "#/"; };
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
    return `<div class="card item" data-i="${i}">
      <div class="head">
        <h3>${i + 1}. ${esc(it.title)}</h3>
        <div class="actions">
          ${it.videoSeconds != null && CUR.meeting.videoId ? `<button data-seek="${it.videoSeconds}">▶ ${clock(it.videoSeconds)}</button>` : ""}
          <button data-up="${i}" title="Move up">↑</button>
          <button data-del="${i}" class="danger" title="Remove item">Remove</button>
        </div>
      </div>
      ${it.checkNote || it.confidence === "low" ? `<div class="check"><strong>Check:</strong> ${esc(it.checkNote || "Low confidence.")} <span class="meta">(confidence: ${esc(it.confidence)})</span></div>` : ""}
      <div class="grid">
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
      const next = (await api("overview")).meetings.filter((x) => x.status === "drafted").sort((a, b) => a.date.localeCompare(b.date))[0];
      toast(next ? "Approved. Opening the next draft." : "Approved. Nothing else to review.");
      location.hash = next ? `#/m/${encodeURIComponent(next.id)}` : "#/";
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
  const { issues } = await api("issues");
  issues.sort((a, b) => (b.lastDate || "").localeCompare(a.lastDate || ""));
  $("#view").innerHTML = `
    <h1>Issues</h1>
    <p class="muted">Every approved item with an issue key lands on that issue's timeline. These become the public issue pages.</p>
    ${issues.length ? issues.map((i) => `<div class="card item">
      <div class="head"><h3>${esc(i.title)}</h3><span class="meta">${esc(i.key)}</span></div>
      ${i.events.map((ev) => `<div class="issue-ev">${fmtDate(ev.date)} · ${BODY_NAMES[ev.body]} · <strong>${esc(ev.stage)}</strong>${ev.result && ev.result !== "no vote" ? ` (${esc(ev.result)})` : ""} · <a href="#/m/${encodeURIComponent(ev.meetingId)}">${esc(ev.title)}</a>${ev.amount != null ? ` · ${money(ev.amount)}` : ""}</div>`).join("")}
      ${i.nextStep?.text ? `<p><strong>Next:</strong> ${esc(i.nextStep.text)}${i.nextStep.date ? ` (${fmtDate(i.nextStep.date)})` : ""}</p>` : ""}
    </div>`).join("") : `<p class="muted">No approved meetings yet.</p>`}`;
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
      <tr><td>All funds</td><td style="text-align:right"><strong>${money(r.totals.allFunds)}</strong></td></tr>
      <tr><td>General Fund</td><td style="text-align:right">${money(r.totals.generalFund)}</td></tr>
      <tr><td>Other property-tax funds</td><td style="text-align:right">${money(r.totals.otherPropertyTaxFunds)}</td></tr>
      <tr><td>Non-property-tax funds</td><td style="text-align:right">${money(r.totals.nonPropertyTaxFunds)}</td></tr>
      <tr><td>TIF funds</td><td style="text-align:right">${money(r.totals.tifFunds)}</td></tr>
      ${r.tax ? `<tr><td>Property tax rate</td><td style="text-align:right">$${r.tax.rate} per $100${pg(r.tax.page)}</td></tr><tr><td>Property tax levy</td><td style="text-align:right">${money(r.tax.levy)}</td></tr><tr><td>Expected loss to tax caps</td><td style="text-align:right">${money(r.tax.estimatedCapLossAllFunds)}</td></tr>` : ""}
    </tbody></table>` : ""}
    ${r.observations?.length ? `<h2>Worth knowing</h2><div class="card">${r.observations.map((o) => `<p>${esc(o.text)}${pg(o.page)}</p>`).join("")}</div>` : ""}
    ${r.generalFundDepartments?.length ? `<h2>General Fund by department</h2><table><thead><tr><th>Department</th><th style="text-align:right">2027</th><th style="text-align:right">Share</th></tr></thead><tbody>${[...r.generalFundDepartments].sort((a, b) => b.amount - a.amount).map((d) => `<tr><td>${esc(d.name)}</td><td style="text-align:right">${money(d.amount)}</td><td style="text-align:right">${pct(d.amount, r.totals?.generalFund)}</td></tr>`).join("")}</tbody></table>` : ""}
    ${groups.map((g) => `<h2>${esc(g)}</h2><table><thead><tr><th>Fund</th><th style="text-align:right">Budget</th><th style="text-align:right">Tax levy</th><th style="text-align:right">Cash end 2026 (est.)</th><th style="text-align:right">Cash end 2027 (est.)</th><th></th></tr></thead><tbody>${r.funds.filter((f) => f.group === g).map((f) => `<tr><td>${esc(f.code)} ${esc(f.name)}</td><td style="text-align:right">${money(f.budget)}</td><td style="text-align:right">${f.levy ? money(f.levy) : "–"}</td><td style="text-align:right">${money(f.cashEnd2026)}</td><td style="text-align:right">${money(f.cashEnd2027)}</td><td>${pg(f.page)}</td></tr>`).join("")}</tbody></table>`).join("")}`;
}

// ---------- Settings
async function viewSettings() {
  OV = await api("overview"); setBodies(OV.bodies);
  const roster = OV.roster;
  const origin = location.origin;
  const bm = bookmarklet(origin);
  $("#view").innerHTML = `
    <h1>Settings</h1>
    <h2>Browser button for transcripts</h2>
    <div class="card">
      <p>Drag this to your bookmarks bar: <a class="bm" href="${esc(bm)}">Send to localmeetings</a></p>
      <p class="muted">Use it if the Mac job misses a meeting. Open the meeting video on YouTube, click the bookmark, and the transcript is sent here. A small window confirms it.</p>
    </div>
    <h2>Board members</h2>
    <div class="card">
      <p class="muted">Used to fix names in captions, and later to sort votes by party on the internal view.</p>
      ${Object.entries(roster).map(([body, list]) => `<h3>${BODY_NAMES[body] || body}</h3>
        <div data-roster="${body}">${list.map((r) => rosterRow(r)).join("")}</div>
        <button data-addr="${body}">Add member</button>`).join("")}
      <p class="actions" style="margin-top:1rem"><button id="saveRoster" class="primary">Save members</button></p>
    </div>
    <h2>Daily check</h2>
    <div class="card">
      <p>Runs every morning: looks for new agenda packets on the county site, then drafts up to two meetings that have everything they need.</p>
      <button id="runNow">Run it now</button> <span id="runOut" class="meta"></span>
      ${OV.lastRun ? `<pre class="meta" style="white-space:pre-wrap">${esc(JSON.stringify(OV.lastRun, null, 1))}</pre>` : ""}
    </div>`;
  document.querySelectorAll("[data-addr]").forEach((b) => b.onclick = () => $(`[data-roster="${b.dataset.addr}"]`).insertAdjacentHTML("beforeend", rosterRow({ name: "" })));
  $("#saveRoster").onclick = async () => {
    const out = {};
    document.querySelectorAll("[data-roster]").forEach((box) => {
      out[box.dataset.roster] = [...box.querySelectorAll(".rrow")].map((r) => ({ name: r.querySelector("[name=n]").value.trim(), title: r.querySelector("[name=t]").value.trim(), party: r.querySelector("[name=p]").value })).filter((r) => r.name);
    });
    await api("roster", { roster: out }); toast("Saved.");
  };
  $("#runNow").onclick = async () => {
    $("#runNow").disabled = true; $("#runOut").textContent = "Running… this can take a few minutes if it drafts.";
    try { const r = await fetch("/api/cron", { headers: { "x-admin-code": CODE } }).then((x) => x.json()); $("#runOut").textContent = r.error ? r.error : `Found ${r.scan.packets} packets; drafted ${r.drafted.length}; ${r.queued} were ready.`; } catch (e) { $("#runOut").textContent = e.message; }
    $("#runNow").disabled = false;
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

route();
