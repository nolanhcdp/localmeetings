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
  document.querySelectorAll(".top nav a").forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + h || (h.startsWith("/m/") && a.getAttribute("href") === "#/") || (h.startsWith("/ref/") && a.getAttribute("href") === "#/library") || (h.startsWith("/research") && a.getAttribute("href") === "#/research")));
  try {
    if (h.startsWith("/m/")) return await viewMeeting(decodeURIComponent(h.slice(3)));
    if (h === "/videos") return await viewVideos();
    if (h === "/issues") return await viewIssues();
    if (h === "/library") return await viewLibrary();
    if (h.startsWith("/ref/")) return await viewRef(decodeURIComponent(h.slice(5)));
    if (h === "/settings") return await viewSettings();
    if (h === "/queue") return await viewQueue();
    if (h.startsWith("/research")) return await viewResearch(h.split("/")[2] || "flags");
    return await viewMeetings();
  } catch (e) { if (e.message !== "auth") $("#view").innerHTML = `<p class="err">${esc(e.message)}</p>`; }
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
        <div class="meta">${lr ? `Last daily run ${new Date(lr.at).toLocaleString()}${lr.errors?.length ? ` · <span class="err">${lr.errors.length} problem(s)</span>` : ""}` : "The daily run hasn't happened yet."}${OV.lastTick?.at ? ` · Last quick check ${new Date(OV.lastTick.at).toLocaleString()}${OV.lastTick.calendar?.cityError ? ` · <span class="err">City calendar: ${esc(OV.lastTick.calendar.cityError)}</span>` : ""}` : ""}${unsorted ? ` · <a href="#/videos">${unsorted} video(s) need a meeting</a>` : ""}</div>
      </div>
      <div class="actions">
        <label class="btn" title="Drafts, minutes checks or reference documents made in a Claude chat (.json)">Import<input id="importFile" type="file" accept=".json,application/json" multiple hidden></label>
        ${counts.fill ? `<button id="fillOld" class="primary" title="Uses the Claude API">Fill in older meetings (${counts.fill})</button>` : ""}
        <button id="export" title="Download every draft so Claude can check them against minutes in a chat, on your plan">Export for Claude</button>
        <button id="scan" title="Checks the calendars and both document pages, and previews any meeting in the next two days that has a new agenda">Check now</button>
        <button id="draftAll" class="primary" ${counts.ready ? "" : "disabled"}>Draft all ready (${counts.ready})</button>
      </div>
    </div>
    <div class="filter" style="margin-bottom:.8rem">
      <select id="bodyF" style="width:auto"><option value="">All boards</option>${Object.entries(BODY_NAMES).map(([k, n]) => `<option value="${k}" ${k === BODYF ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>
      ${[["live", "Live"], ["held", "Has held items"], ["check", "Minutes to check"], ["upcoming", "Upcoming"], ["ready", "Ready to draft"], ["problems", "Problems"], ["waiting", "Waiting on sources"], ["all", "All"]].map(([k, l]) => `<button data-f="${k}" class="${FILTER === k ? "on" : ""}">${l} (${counts[k]})</button>`).join("")}
    </div>
    <p id="progress" class="meta"></p>
    ${show.length ? `<table><thead><tr><th>Date</th><th>Body</th><th>Sources</th><th>Status</th><th></th></tr></thead><tbody>
      ${show.map((m) => `<tr>
        <td>${fmtDate(m.date)}</td>
        <td>${BODY_NAMES[m.body] || m.body}</td>
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
  $("#importFile").onchange = async (e) => {
    const files = [];
    try { for (const f of e.target.files) files.push(JSON.parse(await f.text())); } catch (err) { return toast("One of those files isn't valid JSON."); }
    try { const r = await api("import", { files }); toast(r.done.join(" · "), 6000); viewMeetings(); } catch (err) { toast(err.message, 6000); }
    e.target.value = "";
  };
  if ($("#fillOld")) $("#fillOld").onclick = () => fillOlder(toFill);
  $("#export").onclick = async () => {
    const data = await api("export");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
    a.download = `localmeetings-export-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    toast("Saved to your Downloads. Move it into Vote Tracker/data and tell Claude in the chat.", 7000);
  };
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
  renderItems();
  $("#view").addEventListener("input", (e) => { if (e.target.matches("[data-k]") && !e.target.closest("#items")) { setPath(CUR.record, e.target.dataset.k, e.target.value); markDirty(); } });
  $("#addItem").onclick = () => { CUR.record.items.push({ title: "New item", whatItIs: "", category: "other", stage: "discussed", vote: { method: "none", result: "no vote" }, confidence: "high", sources: [] }); renderItems(); markDirty(); };
  $("#saveBtn").onclick = () => save(false);
  if ($("#approveBtn")) $("#approveBtn").onclick = () => save(true);
  if ($("#unapprove")) $("#unapprove").onclick = async () => { await api("unapprove", { id: m.id }); toast("Moved back to drafts."); viewMeeting(m.id); };
  if ($("#skip")) $("#skip").onclick = async () => { if (!confirm("Skip this meeting? It won't be drafted or published. You can undo this from All.")) return; await api("skip", { id: m.id }); location.hash = "#/"; };
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
    return `<div class="card item" data-i="${i}">
      <div class="head">
        <h3>${i + 1}. ${esc(it.title)}</h3>
        <div class="actions">
          ${it.videoSeconds != null && CUR.meeting.videoId ? `<button data-seek="${it.videoSeconds}">▶ ${clock(it.videoSeconds)}</button>` : ""}
          <button data-up="${i}" title="Move up">↑</button>
          <button data-del="${i}" class="danger" title="Remove item">Remove</button>
        </div>
      </div>
      ${itemBanner(it, i)}
      ${it.checkNote || it.confidence === "low" ? `<div class="check"><strong>Note${it.confidence === "low" ? " (shown publicly)" : ""}:</strong> ${esc(it.checkNote || "Low confidence.")} <span class="meta">(confidence: ${esc(it.confidence)})</span></div>` : ""}
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
  const { issues, kinds = [] } = await api("issues");
  issues.sort((a, b) => (b.lastDate || "").localeCompare(a.lastDate || ""));
  const kindSel = (i) => `<select data-kind="${esc(i.key)}" title="Which road this issue is on (sets the public page's roadmap)"><option value="" ${!i.kindOverride ? "selected" : ""}>Auto${i.guessed ? `: ${esc(kinds.find((k) => k.kind === i.guessed)?.label || i.guessed)}` : ": no roadmap"}</option>${kinds.map((k) => `<option value="${k.kind}" ${i.kindOverride === k.kind ? "selected" : ""}>${esc(k.label)}</option>`).join("")}<option value="none" ${i.kindOverride === "none" ? "selected" : ""}>No roadmap</option></select>`;
  $("#view").innerHTML = `
    <h1>Issues</h1>
    <p class="muted">Every published item with an issue key lands on that issue's timeline; these are the public issue pages. Each issue is put on a "road" (rezoning, variance, appropriation…) automatically from its items; fix one with the dropdown. <button id="rebuild">Rebuild all timelines</button></p>
    ${issues.length ? issues.map((i) => `<div class="card item">
      <div class="head"><h3>${esc(i.title)}</h3><span class="meta">${esc(i.key)}</span></div>
      <div class="row" style="align-items:center;gap:.5rem;margin:.3rem 0 .5rem"><span class="muted">Road:</span>${kindSel(i)}</div>
      ${i.events.map((ev) => `<div class="issue-ev">${fmtDate(ev.date)} · ${BODY_NAMES[ev.body]} · <strong>${esc(ev.stage)}</strong>${ev.result && ev.result !== "no vote" ? ` (${esc(ev.result)})` : ""} · <a href="#/m/${encodeURIComponent(ev.meetingId)}">${esc(ev.title)}</a>${ev.amount != null ? ` · ${money(ev.amount)}` : ""}</div>`).join("")}
      ${i.nextStep?.text ? `<p><strong>Next:</strong> ${esc(i.nextStep.text)}${i.nextStep.date ? ` (${fmtDate(i.nextStep.date)})` : ""}</p>` : ""}
    </div>`).join("") : `<p class="muted">No issues yet. Click Rebuild if you have published meetings.</p>`}`;
  $("#rebuild").onclick = async () => { const r = await api("rebuildIssues"); toast(`Rebuilt ${r.issues} issues.`); viewIssues(); };
  $("#view").onchange = async (e) => { const t = e.target.closest("[data-kind]"); if (!t) return; await api("issueKind", { key: t.dataset.kind, kind: t.value }); toast("Saved."); };
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
    <h2>Ask page (core group)</h2>
    <div class="card" id="askBox"><p class="muted">Loading…</p></div>
    <h2>Phone alerts</h2>
    <div class="card" id="pushBox"><p class="muted">Loading…</p></div>
    <h2>Daily check</h2>
    <div class="card">
      <p>Runs every morning: looks for new agendas and minutes, drafts up to two meetings that have everything they need, checks up to four drafts against minutes that came out since, and writes previews for up to two upcoming agendas. All of these use the Claude API.</p>
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
  askSettings(); pushSettings();
  $("#runNow").onclick = async () => {
    $("#runNow").disabled = true; $("#runOut").textContent = "Running… this can take a few minutes if it drafts.";
    try { const r = await fetch("/api/cron", { headers: { "x-admin-code": CODE } }).then((x) => x.json()); $("#runOut").textContent = r.error ? r.error : `Found ${r.scan.packets} documents; drafted ${r.drafted.length}, checked ${r.checked?.length || 0} against minutes, previewed ${r.previewed?.length || 0}.${r.errors?.length ? " Problems: " + r.errors.join("; ") : ""}`; } catch (e) { $("#runOut").textContent = e.message; }
    $("#runNow").disabled = false;
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

route();
