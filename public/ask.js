// Ask page: sign in with an access code, ask a question, read a cited answer.
const $ = (s) => document.querySelector(s);
const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} } };
let CODE = store.get("lm-ask") || "";
const ADMIN = store.get("vt-admin") || ""; // Nolan's review-page code works here too
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dt = (d) => new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const cents = (c) => (c < 1 ? `${(c || 0).toFixed(1)}¢` : c < 100 ? `${Math.round(c)}¢` : `$${(c / 100).toFixed(2)}`);
const ts = (s) => { s = Math.max(0, s | 0); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(x).padStart(2, "0")}`; };

async function api(action, body = {}) {
  const headers = { "content-type": "application/json" };
  if (CODE) headers["x-access-code"] = CODE; else if (ADMIN) headers["x-admin-code"] = ADMIN;
  const res = await fetch("/api/ask", { method: "POST", headers, body: JSON.stringify({ action, ...body }) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { signOut(data.error); throw new Error("auth"); }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function signOut(msg = "") { CODE = ""; store.set("lm-ask", null); $("#app").hidden = true; $("#signin").hidden = false; $("#signout").hidden = true; $("#who").textContent = ""; $("#signinErr").textContent = msg; }
$("#signinForm").addEventListener("submit", async (e) => { e.preventDefault(); CODE = $("#code").value.trim(); store.set("lm-ask", CODE); start(); });
$("#signout").onclick = () => signOut();

// ---- tiny markdown: paragraphs, headings, lists, tables, bold/italic, and [[ref]] citations
function md(text, refs) {
  const cite = (ref) => {
    const r = refs?.[ref];
    if (!r) return "";
    const n = order.indexOf(ref) + 1 || (order.push(ref), order.length);
    return `<a class="cite" href="/#/m/${encodeURIComponent(r.meetingId)}${r.idx != null ? `#item-${r.idx}` : ""}" target="_blank" rel="noopener" title="${esc(`${r.board}, ${dt(r.date)}: ${r.title}`)}">${n}</a>`;
  };
  const order = [];
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*]+)\*/g, "$1<i>$2</i>").replace(/\[\[([a-z0-9-]+(?:#\d+)?)\]\]/g, (_, r) => cite(r));
  const lines = String(text || "").split("\n");
  let html = "", i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*\|/.test(l)) {
      const rows = []; while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const body = rows.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r));
      html += `<div class="tablewrap"><table><thead><tr>${cells(body[0]).map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.slice(1).map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      continue;
    }
    if (/^\s*[-*•] /.test(l)) { let items = []; while (i < lines.length && /^\s*[-*•] /.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*•] /, "")); html += `<ul>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>`; continue; }
    if (/^\s*\d+[.)] /.test(l)) { let items = []; while (i < lines.length && /^\s*\d+[.)] /.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)] /, "")); html += `<ol>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</ol>`; continue; }
    const h = l.match(/^#{1,4}\s+(.*)/);
    if (h) { html += `<h3>${inline(h[1])}</h3>`; i++; continue; }
    if (!l.trim()) { i++; continue; }
    let para = []; while (i < lines.length && lines[i].trim() && !/^\s*([-*•] |\d+[.)] |\||#)/.test(lines[i])) para.push(lines[i++]);
    html += `<p>${inline(para.join(" "))}</p>`;
  }
  const src = order.map((ref, n) => { const r = refs[ref]; return `<li>${n + 1}. <a href="/#/m/${encodeURIComponent(r.meetingId)}${r.idx != null ? `#item-${r.idx}` : ""}" target="_blank" rel="noopener">${esc(r.board)}, ${esc(dt(r.date))}: ${esc(r.title)}</a>${r.label === "held" ? " <span class='tag unclear'>unverified</span>" : r.label === "video" ? " <span class='muted'>(from video)</span>" : ""}${r.videoId && r.seconds != null ? ` · <a href="https://www.youtube.com/watch?v=${esc(r.videoId)}&t=${r.seconds}s" target="_blank" rel="noopener">watch ${ts(r.seconds)}</a>` : ""}</li>`; });
  return `<div class="md">${html}</div>${src.length ? `<ol class="sourcesl" style="list-style:none;padding-left:0">${src.join("")}</ol>` : ""}`;
}

function showAnswer(e) {
  $("#answer").innerHTML = `<article class="card answer">
    <div class="q">${esc(e.question)}</div>
    ${md(e.answer, e.refs)}
    <div class="ansfoot">
      <span>${e.mode === "deep" ? "Deep" : "Quick"} · ${e.cached ? "saved answer, free" : cents(e.costCents)}</span>
      <span>${esc(dt(e.at))}${e.memberName && ME && e.memberName !== ME.name ? ` · asked by ${esc(e.memberName)}` : ""}</span>
      ${e.memberName === ME?.name || ME?.admin ? `<button class="linkbtn" id="pinBtn">${e.pinned ? "Unpin" : "Pin for the group"}</button>` : ""}
      <button class="linkbtn" id="copyBtn">Copy</button>
    </div>
  </article>`;
  $("#pinBtn")?.addEventListener("click", async () => { const r = await api("pin", { id: e.id, on: !e.pinned }); showAnswer(r.entry); lists(); });
  $("#copyBtn").onclick = () => navigator.clipboard?.writeText(`${e.question}\n\n${e.answer.replace(/\[\[[^\]]+\]\]/g, "")}`);
  $("#answer").scrollIntoView({ behavior: "smooth", block: "start" });
}

let ME = null;
function spendLine(s) {
  const parts = [];
  if (s.dailyCents != null) parts.push(`${cents(Math.max(0, s.dailyCents - s.dayCents))} left today`);
  if (ME?.admin) parts.push(`${cents(s.monthCents)} of ${cents(s.monthlyCents)} used this month by everyone`);
  $("#spend").textContent = parts.join(" · ");
}
const EXAMPLES = [
  "What did the Kokomo council approve that was paid for with TIF money?",
  "Who has missed the most meetings this year?",
  "Every recorded no vote on the County Council, by member",
  "Which developers or companies keep showing up?",
  "What's on upcoming agendas that the public can speak on?",
  "How much of Kokomo's General Fund goes to police and fire?",
];

async function lists() {
  const [p, m] = await Promise.all([api("pinned"), api("mine")]);
  const card = (e) => `<div class="card" data-id="${esc(e.id)}"><b>${esc(e.question)}</b><div class="meta">${esc(dt(e.at))}${e.memberName ? ` · ${esc(e.memberName)}` : ""}${e.research ? " · research" : ""}</div></div>`;
  $("#pinned").innerHTML = p.entries.map(card).join("") || `<p class="muted">Nothing pinned yet. Pin a good answer to share it with the group.</p>`;
  $("#mine").innerHTML = m.entries.map(card).join("") || `<p class="muted">Your questions will show up here.</p>`;
  for (const box of ["#pinned", "#mine"]) $(box).onclick = async (ev) => { const c = ev.target.closest("[data-id]"); if (c) showAnswer((await api("get", { id: c.dataset.id })).entry); };
}

async function start() {
  try {
    const r = await api("whoami");
    ME = r.me;
    $("#signin").hidden = true; $("#app").hidden = false; $("#signout").hidden = !CODE;
    $("#who").textContent = `${ME.name}${ME.research ? " · records + research" : ""}`;
    spendLine(r.spend);
    $("#examples").innerHTML = EXAMPLES.map((x) => `<button type="button" class="chip">${esc(x)}</button>`).join("");
    $("#examples").onclick = (e) => { const b = e.target.closest(".chip"); if (b) { $("#q").value = b.textContent; $("#q").focus(); } };
    lists();
  } catch (e) { if (e.message !== "auth") $("#signinErr").textContent = e.message; }
}

$("#askForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const question = $("#q").value.trim();
  if (question.length < 4) return;
  const mode = document.querySelector("[name=mode]:checked").value;
  $("#askBtn").disabled = true;
  $("#answer").innerHTML = `<div class="card answer"><div class="q">${esc(question)}</div><p class="thinking">Looking through the records</p></div>`;
  try { const r = await api("ask", { question, mode }); showAnswer(r.entry); spendLine(r.spend); lists(); }
  catch (err) { if (err.message !== "auth") $("#answer").innerHTML = `<div class="card answer"><div class="q">${esc(question)}</div><p class="err">${esc(err.message)}</p></div>`; }
  $("#askBtn").disabled = false;
});
$("#q").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) $("#askForm").requestSubmit(); });

if (CODE || ADMIN) start(); else signOut();
