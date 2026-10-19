#!/usr/bin/env node
// Pulls the Indiana Gateway bulk files we use, one request per file, into data/gateway/raw/.
// Gateway's download page is an old ASP.NET form (hidden __VIEWSTATE fields, dropdowns that post back when
// they change), so this script plays the form the way a browser would: load the page, pick the data set, let
// the page rebuild the file list, pick the file, unit type and year, then press Download and save the stream.
//
//   node mac/pull-gateway.mjs --probe          # just show the form's dropdowns and options (run this first)
//   node mac/pull-gateway.mjs                  # download everything in WANT below (skips files already present)
//   node mac/pull-gateway.mjs --only afr       # or --only budget
//
// Runs on the Mac, not in Vercel: Gateway blocks nothing, but the files are statewide and big.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";

const PAGE = "https://gateway.ifionline.org/public/download.aspx";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "gateway", "raw");
const args = process.argv.slice(2);
const PROBE = args.includes("--probe");
const ONLY = (args[args.indexOf("--only") + 1] || "").toLowerCase();

// What we want: [data set label, file label (matched loosely), short name]
const WANT = [
  ["Budget Data", "Form 4B", "budget-form4b"],
  ["Budget Data", "Form 4A", "budget-form4a"],
  ["Budget Data", "Form 1", "budget-form1"],
  ["Budget Data", "Form 2", "budget-form2"],
  ["Annual Financial Reports", "Cash and Investments", "afr-cash"],
  ["Annual Financial Reports", "Disbursements by Fund and Department", "afr-disburse-dept"],
  ["Annual Financial Reports", "Disbursements by Fund", "afr-disburse-fund"],
  ["Annual Financial Reports", "Detailed Receipts", "afr-receipts"],
  ["Annual Financial Reports", "Debt", "afr-debt"],
  ["Annual Financial Reports", "Leases", "afr-leases"],
].filter(([ds]) => !ONLY || (ONLY === "afr" ? /Annual/.test(ds) : /Budget/.test(ds)));
const UNIT_TYPES = ["County", "City/Town"];
const YEAR = "All";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 SecondReading/1.0 (+https://secondreading.org)";
let cookie = "";
async function req(method, body) {
  const res = await fetch(PAGE, { method, redirect: "manual", headers: { "user-agent": UA, ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}) }, body });
  const sc = res.headers.getSetCookie?.() || []; if (sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
  return res;
}
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

// Read every form field off the page: hidden inputs, selects (with options), buttons
function parseForm(html) {
  const fields = {}; const selects = {}; const buttons = [];
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0]; const name = (tag.match(/\bname="([^"]+)"/i) || [])[1]; if (!name) continue;
    const type = ((tag.match(/\btype="([^"]+)"/i) || [])[1] || "text").toLowerCase(); const value = decode((tag.match(/\bvalue="([^"]*)"/i) || [])[1] || "");
    if (type === "submit" || type === "button" || type === "image") buttons.push({ name, value }); else if (type !== "checkbox" && type !== "radio") fields[name] = value;
  }
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const name = (m[1].match(/\bname="([^"]+)"/i) || [])[1]; if (!name) continue;
    const opts = [...m[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map((o) => ({ value: decode((o[1].match(/\bvalue="([^"]*)"/i) || [])[1] ?? o[2].trim()), label: decode(o[2].replace(/<[^>]+>/g, "").trim()), selected: /\bselected\b/i.test(o[1]) }));
    selects[name] = opts; fields[name] = (opts.find((o) => o.selected) || opts[0] || {}).value || "";
  }
  return { fields, selects, buttons };
}
const pick = (selects, re) => Object.keys(selects).find((n) => re.test(n)) || null;
const option = (opts, label) => opts.find((o) => o.label.toLowerCase() === label.toLowerCase()) || opts.find((o) => o.label.toLowerCase().includes(label.toLowerCase())) || null;
const encode = (fields) => new URLSearchParams(fields).toString();

async function loadPage() { const r = await req("GET"); return parseForm(await r.text()); }
// A dropdown change is a postback: __EVENTTARGET names the control, the server rebuilds the dependent lists
async function postback(form, target) {
  const body = encode({ ...form.fields, __EVENTTARGET: target, __EVENTARGUMENT: "" });
  const r = await req("POST", body); return parseForm(await r.text());
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  let form = await loadPage();
  const dsName = pick(form.selects, /data.?set|ddlData|ds/i) || Object.keys(form.selects)[0];
  if (PROBE || !dsName) {
    console.log("Selects on the page:"); for (const [n, opts] of Object.entries(form.selects)) console.log(`  ${n}: ${opts.map((o) => `${o.label}=${o.value}`).join(" | ")}`);
    console.log("Buttons:", form.buttons.map((b) => `${b.name}="${b.value}"`).join(", "));
    if (PROBE) return;
  }
  const done = [], failed = [];
  for (const unitType of UNIT_TYPES) for (const [dsLabel, fileLabel, short] of WANT) {
    const outFile = path.join(OUT, `${short}-${unitType.replace(/\W+/g, "").toLowerCase()}-${YEAR.toLowerCase()}.txt`);
    if (fs.existsSync(outFile) && fs.statSync(outFile).size > 1000) { console.log(`have   ${path.basename(outFile)}`); continue; }
    try {
      form = await loadPage();
      // 1. data set
      const ds = option(form.selects[dsName], dsLabel); if (!ds) throw new Error(`no data set option like "${dsLabel}"`);
      if (form.fields[dsName] !== ds.value) { form.fields[dsName] = ds.value; form = await postback(form, dsName); }
      // 2. file type (the list depends on the data set)
      const fileName = pick(form.selects, /file|ddlFile|rpt/i); if (!fileName) throw new Error("no file dropdown after choosing the data set");
      const f = option(form.selects[fileName], fileLabel); if (!f) throw new Error(`no file option like "${fileLabel}" (have: ${form.selects[fileName].map((o) => o.label).join("; ")})`);
      if (form.fields[fileName] !== f.value) { form.fields[fileName] = f.value; form = await postback(form, fileName); }
      // 3. unit type and year
      const utName = pick(form.selects, /unit/i), yrName = pick(form.selects, /year|yr/i);
      if (!utName || !yrName) throw new Error(`missing unit/year dropdowns (${Object.keys(form.selects).join(", ")})`);
      const ut = option(form.selects[utName], unitType); if (!ut) throw new Error(`no unit type like "${unitType}"`);
      if (form.fields[utName] !== ut.value) { form.fields[utName] = ut.value; form = await postback(form, utName); }
      const yr = option(form.selects[yrName], YEAR) || form.selects[yrName][0]; form.fields[yrName] = yr.value;
      // 4. download
      const btn = form.buttons.find((b) => /download/i.test(b.value) || /download|btn/i.test(b.name)); if (!btn) throw new Error("no Download button");
      const body = encode({ ...form.fields, [btn.name]: btn.value, __EVENTTARGET: "", __EVENTARGUMENT: "" });
      process.stdout.write(`pull   ${path.basename(outFile)} … `);
      const t0 = Date.now();
      const r = await req("POST", body);
      const ctype = r.headers.get("content-type") || "";
      if (!r.ok || /text\/html/i.test(ctype)) { const t = await r.text(); throw new Error(`got ${r.status} ${ctype.split(";")[0]} instead of a file${/error|invalid/i.test(t) ? " (page shows an error)" : ""}`); }
      const tmp = outFile + ".part"; const ws = fs.createWriteStream(tmp); let bytes = 0;
      for await (const chunk of r.body) { ws.write(chunk); bytes += chunk.length; }
      await new Promise((res) => ws.end(res));
      fs.renameSync(tmp, outFile);
      console.log(`${(bytes / 1048576).toFixed(1)} MB in ${Math.round((Date.now() - t0) / 1000)}s`);
      done.push(outFile);
    } catch (e) { console.log(`FAILED ${short} (${unitType}): ${e.message}`); failed.push({ short, unitType, error: e.message }); }
  }
  console.log(`\n${done.length} downloaded, ${failed.length} failed.`);
  if (failed.length) { console.log("Run with --probe and send the output along with the FAILED lines."); process.exitCode = 1; }
}
main().catch((e) => { console.error(e); process.exit(1); });
