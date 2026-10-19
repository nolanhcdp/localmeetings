#!/usr/bin/env node
// Builds the site's budget data from Indiana Gateway bulk files.
//   node mac/gateway-build.mjs            # reads data/gateway/raw/*.txt, writes five files to public/gateway/
//
// Gateway's files are statewide and pipe-delimited. We keep only our two units (Kokomo Civil City, Howard County),
// check the forms against each other, and write small JSON the site serves as static files (no Redis, no bandwidth).
// Nothing here guesses: a number is either the unit's own adopted figure from Form 4B, or a line that adds up to it.
// Where the forms disagree, the JSON says so and the site shows the fund total without the breakdown.
import fs from "node:fs"; import path from "node:path"; import readline from "node:readline"; import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(ROOT, "data", "gateway", "raw");
const OUT = path.join(ROOT, "public", "gateway");
const FROM_YEAR = 2012; // keep everything Gateway has; the site decides what to show

// Our units. Gateway: cnty_cd 34 = Howard; unit_type 3 = city/town, 1 = county.
const UNITS = {
  kokomo: { label: "City of Kokomo", gov: "city", cnty_cd: "34", unit_type: "3", unit_code: "0110", match: /KOKOMO CIVIL CITY/i },
  howard: { label: "Howard County", gov: "county", cnty_cd: "34", unit_type: "1", unit_code: "0000", match: /HOWARD COUNTY/i },
};
// Budget fund (state code) ↔ financial-report fund (Gateway Fund_code) pairs that aren't the same name but are the same
// fund. Only pairs a person has confirmed go here; the builder proposes the rest on the admin page and never uses them.
const PINNED = {
  kokomo: { "2102": "102006" /* Aviation/Airport ↔ Aviation */, "2120": "902005" /* Cemetery ↔ Cemetery Operating */, "2379": "104049" /* Cum. Capital Imp (cig tax) ↔ Cumulative Capital Improvement */, "9502": "902969" /* Transit Center ↔ FTA-Transit Center */, "9504": "102033" /* Local Law Enforcement Cont Ed */ },
  howard: { "0101": "101000" /* General ↔ County General */, "0702": "101176" /* Highway ↔ Motor Vehicle Highway */, "0124": "901224" /* 2015 Reassessment ↔ Reassessment */, "9502": "101197" /* Storm Water Mgmt Operation */, "9541": "101189" /* Recorder's Records Perpetuation */, "9528": "908109" /* STOP Violence Against Women */, "9501": "909135" /* Pretrial Services Grant (2024) */, "9551": "909121" /* Adult Prob Case Management Grant */, "9527": "101216" /* Auditor's Ineligible Homestead Deduction */, "9505": "102150" /* Supplemental Juvenile Probation */, "1157": "101170" /* Public Safety Access Point ↔ LIT - Public Safety PSAP */ },
};
// A report fund is pass-through when nearly all of its money leaves as "Other Disbursements": the county's property-tax
// settlement to every other unit, income-tax certified shares, payroll and insurance clearing, trust accounts. Real
// spending on operations is everything else. Both totals are kept; the page says which is which.
const passThrough = (f) => { const other = f.byClass["Other Disbursements"] || 0; return f.disbursements > 0 && other / f.disbursements >= 0.9 && (other > 1e6 || /settlement|clearing|trust|certified shares|tax relief|surplus|treasurer|payroll|insurance/i.test(f.name)); };
// Which raw file is which form: by the columns it carries, not its name
const KINDS = [
  { kind: "form4b", need: ["Total budget estimate_adopted", "Net Tax Rate_adopted"] },
  { kind: "form4a", need: ["category_type_id_string", "amount_approved"] },
  { kind: "form1", need: ["item_approved_amt", "department_cd"] },
  { kind: "form2", need: ["adopted_amount", "item_ref_code"] },
  { kind: "afr_cash", need: ["beg_cash_inv", "cash_bal"] },
  { kind: "afr_disburse_dept", need: ["disburse_code", "department_code"] },
  { kind: "afr_disburse", need: ["disburse_code", "class_name"] },
  { kind: "afr_receipts", need: ["Receipt_Code", "receipt_class_code"] },
  { kind: "afr_debt", need: ["debt_class_name", "end_principal_bal"] },
  { kind: "afr_cash", need: ["beg_cash_inv", "cash_bal"] },
  { kind: "afr_leases", need: ["lessor", "annual_payment"] },
];
const num = (s) => { const n = parseFloat(String(s ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round(n * 100) / 100;
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

// Stream a statewide file, keep only our units' rows (header-driven; column order may change between years)
async function scan(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  let header = null, kind = null; const rows = { kokomo: [], howard: [] }; let n = 0;
  for await (const line of rl) {
    if (!header) {
      header = line.replace(/^﻿/, "").split("|").map((h) => h.trim());
      kind = (KINDS.find((k) => k.need.every((c) => header.includes(c))) || {}).kind || null;
      if (!kind) { rl.close(); return { file, kind: null, rows, n: 0 }; }
      continue;
    }
    n++;
    // cheap pre-filter before splitting: Howard County appears in every row of ours
    if (!line.includes("|Howard|") && !line.includes("|HOWARD|")) continue;
    const cells = line.split("|"); const row = {};
    header.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    const cnty = clean(row.cnty_cd || row.county_cd_fk).replace(/^0+/, ""); const ut = clean(row.unit_type || row.budget_unit_type);
    for (const [u, def] of Object.entries(UNITS)) {
      const utOk = ut === def.unit_type || /^(county|city)/i.test(ut) && (def.gov === "county") === /^county/i.test(ut);
      if (cnty === "34" && utOk && def.match.test(row.unit_name || "")) rows[u].push(row);
    }
  }
  return { file, kind, rows, n };
}

// ---- Budget forms → per unit, per year
function buildBudget(unit, def, data) {
  const years = new Map();
  const Y = (y) => years.get(y) || years.set(y, { year: +y, funds: new Map(), revenue: [], checks: [] }).get(y);
  for (const r of data.form4b || []) {
    const y = Y(r.year); const code = clean(r.fund_cd);
    const levy = num(r["Net amount to be raised_adopted"]) || num(r["NET AMT TO BE RAISED BY TAX LEVY_adopted"]) || num(r["Amt to be raised taxLevy_adopted"]) || num(r["amount to be raised-taxLevy_adopted"]);
    y.funds.set(code, { code, name: clean(r.fund_description), adopted: num(r["Total budget estimate_adopted"]), published: num(r["Total budget estimate_published"]), rate: num(r["Net Tax Rate_adopted"]), levy, nav: num(r["Net Assessed Valuation"]), cashJune30: num(r["Actual cash balance_adopted"]), miscRevenue: num(r["Misc revenue from Form 2 ColB_adopted"]), lines: null, departments: null, categories: null, f1Total: null, detail: "none" });
  }
  // Form 1: line items. Only trusted for a fund when they add up to that fund's 4B adopted total.
  const f1 = new Map(); // "year|fund" -> rows
  for (const r of data.form1 || []) { const k = `${r.year}|${clean(r.fund_cd)}`; (f1.get(k) || f1.set(k, []).get(k)).push(r); }
  for (const [k, rows] of f1) {
    const [yr, code] = k.split("|"); const y = Y(yr);
    let fund = y.funds.get(code);
    if (!fund) { fund = { code, name: clean(rows[0].fund_description), adopted: null, published: null, rate: 0, levy: 0, nav: 0, lines: null, departments: null, categories: null, f1Total: null, detail: "none", note: "In the line-item form but not the financial statement" }; y.funds.set(code, fund); }
    const total = rows.reduce((a, r) => a + num(r.item_approved_amt), 0);
    fund.f1Total = r2(total);
    const ok = fund.adopted != null && Math.abs(total - fund.adopted) <= Math.max(1, fund.adopted * 0.0005);
    if (!ok) {
      // The county's export carries duplicated department blocks (e.g., "NO DEPARTMENT" and "No Department" with the
      // same lines). If dropping exact duplicate line sets makes it add up, use that; otherwise keep only the total.
      const seen = new Map(); const dedup = [];
      for (const r of rows) { const sig = `${clean(r.department_description).toLowerCase()}|${clean(r.item_description).toLowerCase()}|${r.item_approved_amt}`; if (seen.has(sig)) continue; seen.set(sig, 1); dedup.push(r); }
      const t2 = dedup.reduce((a, r) => a + num(r.item_approved_amt), 0);
      if (fund.adopted != null && Math.abs(t2 - fund.adopted) <= Math.max(1, fund.adopted * 0.0005)) { rows.splice(0, rows.length, ...dedup); fund.detail = "deduped"; }
      else { fund.detail = "mismatch"; y.checks.push({ fund: code, name: fund.name, kind: "form1-vs-4b", f1: r2(total), adopted: fund.adopted, note: "Line items don't add up to the adopted fund total; only the total is used." }); continue; }
    } else fund.detail = "lines";
    const cats = {}, depts = {};
    for (const r of rows) {
      const amt = num(r.item_approved_amt); const cat = clean(r.expenditure_cat_description) || "Other"; const dep = clean(r.department_description) || "No department";
      cats[cat] = r2((cats[cat] || 0) + amt);
      const d = depts[dep] || (depts[dep] = { name: dep, total: 0, categories: {} }); d.total = r2(d.total + amt); d.categories[cat] = r2((d.categories[cat] || 0) + amt);
    }
    fund.categories = cats; fund.departments = Object.values(depts).sort((a, b) => b.total - a.total);
    fund.lines = rows.filter((r) => num(r.item_approved_amt) !== 0).map((r) => ({ department: clean(r.department_description), category: clean(r.expenditure_cat_description), item: clean(r.item_description), code: clean(r.item_ref_code), published: num(r.item_amt), adopted: num(r.item_approved_amt) }));
  }
  // Form 2: expected revenue other than property tax, by fund and category
  for (const r of data.form2 || []) { const y = Y(r.year); y.revenue.push({ fund: clean(r.fund_cd), fundName: clean(r.fund_description), category: clean(r.expenditure_cat_description), item: clean(r.item_description), code: clean(r.item_ref_code), amount: num(r.adopted_amount) }); }
  // Per-year summary. "core" = funds that appear in every year of the window, so a trend line compares like with like.
  const list = [...years.values()].filter((y) => y.year >= FROM_YEAR).sort((a, b) => a.year - b.year);
  const window = list.filter((y) => y.year >= 2020);
  const core = new Set([...(window[0]?.funds.keys() || [])].filter((c) => window.every((y) => y.funds.has(c) && y.funds.get(c).adopted != null)));
  for (const y of list) {
    const funds = [...y.funds.values()].filter((f) => f.adopted != null);
    const sum = (sel) => r2(funds.filter(sel).reduce((a, f) => a + f.adopted, 0));
    y.total = sum(() => true); y.coreTotal = sum((f) => core.has(f.code)); y.tifTotal = sum((f) => /\bTIF\b/i.test(f.name)); y.otherTotal = r2(y.total - y.coreTotal - sum((f) => /\bTIF\b/i.test(f.name) && !core.has(f.code)));
    y.levy = r2(funds.reduce((a, f) => a + f.levy, 0)); y.rate = r2(funds.reduce((a, f) => a + f.rate, 0) * 10000) / 10000;
    y.nav = Math.max(0, ...funds.map((f) => f.nav)); y.fundCount = funds.length; y.coreFundCount = funds.filter((f) => core.has(f.code)).length;
    y.revenueTotal = r2(y.revenue.reduce((a, r) => a + r.amount, 0));
    y.categories = {}; for (const f of funds) for (const [c, v] of Object.entries(f.categories || {})) y.categories[c] = r2((y.categories[c] || 0) + v);
    y.detailCoverage = r2(funds.filter((f) => f.detail === "lines" || f.detail === "deduped").reduce((a, f) => a + f.adopted, 0) / (y.total || 1));
    y.funds = funds.sort((a, b) => b.adopted - a.adopted).map((f) => ({ ...f, core: core.has(f.code), tif: /\bTIF\b/i.test(f.name) }));
    const prev = list[list.indexOf(y) - 1];
    if (prev) { const added = y.funds.filter((f) => !prev.funds.some((p) => p.code === f.code)).map((f) => f.name); const dropped = prev.funds.filter((p) => !y.funds.some((f) => f.code === p.code)).map((f) => f.name); y.fundChanges = { added, dropped }; }
  }
  return { unit, label: def.label, gov: def.gov, unitCode: def.unit_code, source: "Indiana Gateway for Government Units, Budget Data (Forms 1, 2, 4B), bulk download", builtAt: new Date().toISOString(), coreFunds: [...core], years: list };
}

// ---- Annual financial reports → actuals per unit, per year (when the files are present)
function buildActuals(data) {
  const years = new Map(); const Y = (y) => years.get(y) || years.set(y, { year: +y, funds: new Map(), debt: [], leases: [], checks: [] }).get(y);
  const fkey = (r) => clean(r.Fund_code || r.fund_code || r.unit_fund_number);
  for (const r of data.afr_cash || []) { const y = Y(r.year); const code = fkey(r); y.funds.set(code, { code, local: clean(r.unit_fund_number), name: clean(r.unit_fund_name || r.fund_name), enterprise: clean(r.ent_name), begin: num(r.beg_cash_inv), receipts: num(r.r_bal), disbursements: num(r.d_bal), end: num(r.cash_bal), byClass: {}, byDepartment: {}, byReceiptClass: {} }); }
  for (const r of data.afr_disburse || []) { const y = Y(r.year); const f = y.funds.get(fkey(r)); if (!f) continue; const c = clean(r.disburse_class_name || r.class_name) || "Other"; f.byClass[c] = r2((f.byClass[c] || 0) + num(r.amount)); }
  for (const r of data.afr_disburse_dept || []) { const y = Y(r.year); const f = y.funds.get(fkey(r)); if (!f) continue; const d = clean(r.department_name) || "No department"; f.byDepartment[d] = r2((f.byDepartment[d] || 0) + num(r.amount)); }
  for (const r of data.afr_receipts || []) { const y = Y(r.year); const f = y.funds.get(fkey(r)); if (!f) continue; const c = clean(r.Receipt_Class_Name || r.receipt_class_name) || "Other"; f.byReceiptClass[c] = r2((f.byReceiptClass[c] || 0) + num(r.amount)); }
  for (const r of data.afr_debt || []) Y(r.year).debt.push({ cls: clean(r.debt_class_name), description: clean(r.debt_description || r.description), enterprise: clean(r.ent_name), outstanding: num(r.end_principal_bal), dueNextYear: num(r.principal_amt_due_1yr) });
  for (const r of data.afr_leases || []) Y(r.year).leases.push({ lessor: clean(r.lessor), description: clean(r.lease_description), annual: num(r.annual_payment), from: clean(r.beginning_date), to: clean(r.ending_date) });
  const list = [...years.values()].sort((a, b) => a.year - b.year);
  for (const y of list) {
    const funds = [...y.funds.values()];
    for (const f of funds) {
      const calc = r2(f.begin + f.receipts - f.disbursements);
      if (Math.abs(calc - f.end) > 1) y.checks.push({ fund: f.code, name: f.name, kind: "cash-flow", note: `begin + receipts − disbursements = ${calc.toLocaleString()} but ending balance is ${f.end.toLocaleString()}` });
      const cls = r2(Object.values(f.byClass).reduce((a, v) => a + v, 0)); if (cls && Math.abs(cls - f.disbursements) > 1) y.checks.push({ fund: f.code, name: f.name, kind: "class-vs-fund", note: `disbursement classes add to ${cls.toLocaleString()}, fund says ${f.disbursements.toLocaleString()}` });
      const dep = r2(Object.values(f.byDepartment).reduce((a, v) => a + v, 0)); if (dep && Math.abs(dep - f.disbursements) > 1) y.checks.push({ fund: f.code, name: f.name, kind: "dept-vs-fund", note: `departments add to ${dep.toLocaleString()}, fund says ${f.disbursements.toLocaleString()}` });
      const rc = r2(Object.values(f.byReceiptClass).reduce((a, v) => a + v, 0)); if (rc && Math.abs(rc - f.receipts) > 1) y.checks.push({ fund: f.code, name: f.name, kind: "receipts-vs-fund", note: `receipt classes add to ${rc.toLocaleString()}, fund says ${f.receipts.toLocaleString()}` });
    }
    y.byClass = {}; y.byReceiptClass = {};
    for (const f of funds) { for (const [c, v] of Object.entries(f.byClass)) y.byClass[c] = r2((y.byClass[c] || 0) + v); for (const [c, v] of Object.entries(f.byReceiptClass)) y.byReceiptClass[c] = r2((y.byReceiptClass[c] || 0) + v); }
    for (const f of funds) f.passThrough = passThrough(f);
    y.passThroughTotal = r2(funds.filter((f) => f.passThrough).reduce((a, f) => a + f.disbursements, 0));
    y.operationsTotal = r2(funds.filter((f) => !f.passThrough).reduce((a, f) => a + f.disbursements, 0));
    y.receipts = r2(funds.reduce((a, f) => a + f.receipts, 0)); y.disbursements = r2(funds.reduce((a, f) => a + f.disbursements, 0)); y.endCash = r2(funds.reduce((a, f) => a + f.end, 0));
    y.debtOutstanding = r2(y.debt.reduce((a, d) => a + d.outstanding, 0));
    y.funds = funds.sort((a, b) => b.disbursements - a.disbursements);
  }
  return list;
}

async function main() {
  if (!fs.existsSync(RAW)) { console.error(`No ${RAW}. Put the Gateway downloads there.`); process.exit(1); }
  const files = fs.readdirSync(RAW).filter((f) => /\.(txt|csv|psv)$/i.test(f));
  const data = { kokomo: {}, howard: {} }; const log = [];
  for (const f of files) {
    const t0 = Date.now(); const s = await scan(path.join(RAW, f));
    if (!s.kind) { log.push(`skip   ${f}: columns not recognized`); continue; }
    for (const u of Object.keys(UNITS)) { (data[u][s.kind] ||= []).push(...s.rows[u]); }
    log.push(`read   ${f}: ${s.kind}, ${s.n.toLocaleString()} rows statewide, Kokomo ${s.rows.kokomo.length}, Howard ${s.rows.howard.length}, ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const index = { builtAt: new Date().toISOString(), files: log, units: {} };
  for (const [u, def] of Object.entries(UNITS)) {
    const budget = buildBudget(u, def, data[u]);
    const actuals = buildActuals(data[u]);
    // Budget vs actual on the same fund in the same year, when both exist
    // The budget forms use the state's fund codes (0101 General) and the financial report uses the unit's own numbers
    // (1101 General), so the two are matched by name. Only a clean name match counts; everything else is listed as unmatched.
    const normName = (n) => String(n || "").toLowerCase().replace(/&/g, " and ").replace(/\(.*?\)/g, " ").replace(/\b(fund|funds)\b/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\b(park|parks)\b/g, "park").replace(/\s+/g, " ").trim();
    for (const y of budget.years) {
      const a = actuals.find((x) => x.year === y.year); if (!a) continue;
      const byName = new Map(a.funds.map((x) => [normName(x.name), x]));
      const tifNo = (n) => (String(n).match(/\bTIF\s*#?\s*(\d+)\b/i) || [])[1] || null;
      const used = new Set(); let matched = 0;
      const take = (f, af, how) => { f.actual = { fund: af.code, local: af.local, name: af.name, how, receipts: af.receipts, disbursements: af.disbursements, endCash: af.end, byClass: af.byClass, byDepartment: af.byDepartment }; used.add(af.code); matched += af.disbursements; };
      const pins = PINNED[u] || {}; const byCode = new Map(a.funds.map((x) => [x.code, x]));
      for (const f of y.funds) { const af = byCode.get(pins[f.code]); if (af && !used.has(af.code)) take(f, af, "pinned"); }
      for (const f of y.funds) { if (f.actual) continue; const af = byName.get(normName(f.name)); if (af && !used.has(af.code)) take(f, af, "name"); }
      // TIF districts carry their number in both files ("TIF 6, Downtown" ↔ "TIF 6 (Comb of TIF1 DT & TIF4 SE)")
      for (const f of y.funds) { if (f.actual) continue; const n = tifNo(f.name); if (!n) continue; const cands = a.funds.filter((x) => !used.has(x.code) && tifNo(x.name) === n); if (cands.length === 1) take(f, cands[0], "tif-number"); }
      // Anything else is only proposed: shown in the admin for a person to confirm, never used
      y.actualProposed = [];
      for (const f of y.funds) { if (f.actual) continue; const ft = new Set(normName(f.name).split(" ").filter((w) => w.length > 2)); const best = a.funds.filter((x) => !used.has(x.code)).map((x) => { const xt = new Set(normName(x.name).split(" ").filter((w) => w.length > 2)); const o = [...ft].filter((w) => xt.has(w)).length; return { x, score: o / Math.max(1, Math.min(ft.size, xt.size)) }; }).filter((c) => c.score >= 0.5).sort((p, q) => q.score - p.score)[0]; if (best) y.actualProposed.push({ budget: f.name, budgetCode: f.code, actual: best.x.name, actualCode: best.x.code, disbursements: best.x.disbursements }); }
      y.actualTotal = r2(matched); y.actualAllFunds = a.disbursements; y.actualOperations = a.operationsTotal; y.actualPassThrough = a.passThroughTotal; y.actualMatchedFunds = y.funds.filter((f) => f.actual).length;
      y.actualUnmatched = a.funds.filter((x) => !y.funds.some((f) => f.actual?.fund === x.code)).map((x) => ({ code: x.code, name: x.name, enterprise: x.enterprise, disbursements: x.disbursements, passThrough: x.passThrough })).sort((p, q) => q.disbursements - p.disbursements);
    }
    const out = { ...budget, actuals, hasActuals: actuals.length > 0 };
    // The public site gets small files: one summary per unit, one file per fund with its history and lines
    const site = { unit: u, label: def.label, gov: def.gov, builtAt: out.builtAt, source: out.source, coreFunds: budget.coreFunds,
      years: budget.years.map((y) => { const a = actuals.find((x) => x.year === y.year); return { year: y.year, total: y.total, coreTotal: y.coreTotal, tifTotal: y.tifTotal, rate: y.rate, levy: y.levy, nav: y.nav, fundCount: y.fundCount, categories: y.categories, fundChanges: y.fundChanges || null, detailCoverage: y.detailCoverage,
        actual: a ? { operations: a.operationsTotal, passThrough: a.passThroughTotal, receipts: a.receipts, byReceiptClass: a.byReceiptClass, byClass: a.byClass, endCash: a.endCash, debtOutstanding: a.debtOutstanding } : null,
        funds: y.funds.map((f) => ({ code: f.code, name: f.name, adopted: f.adopted, rate: f.rate, levy: f.levy, core: f.core, tif: f.tif, detail: f.detail, top: f.departments?.[0] ? { name: f.departments[0].name, total: f.departments[0].total } : null, spent: f.actual ? f.actual.disbursements : null })) }; }),
      debt: actuals.map((a) => ({ year: a.year, outstanding: a.debtOutstanding, items: a.debt.map((d) => ({ cls: d.cls, description: d.description, enterprise: d.enterprise, outstanding: d.outstanding, dueNextYear: d.dueNextYear })) })),
      leases: actuals.at(-1)?.leases || [] };
    fs.writeFileSync(path.join(OUT, `site-${u}.json`), JSON.stringify(site));
    const allFunds = {};
    const codes = new Set(budget.years.flatMap((y) => y.funds.map((f) => f.code)));
    for (const code of codes) {
      const hist = budget.years.map((y) => { const f = y.funds.find((x) => x.code === code); return f ? { year: y.year, adopted: f.adopted, published: f.published, rate: f.rate, levy: f.levy, detail: f.detail, categories: f.categories, departments: f.departments?.map((d) => ({ name: d.name, total: d.total })) || null, actual: f.actual ? { fund: f.actual.fund, name: f.actual.name, how: f.actual.how, receipts: f.actual.receipts, disbursements: f.actual.disbursements, endCash: f.actual.endCash, byClass: f.actual.byClass, byDepartment: f.actual.byDepartment } : null } : null; }).filter(Boolean);
      const latest = budget.years.slice().reverse().find((y) => y.funds.some((x) => x.code === code)); const lf = latest.funds.find((x) => x.code === code);
      const lines = budget.years.filter((y) => y.year >= latest.year - 2).map((y) => { const f = y.funds.find((x) => x.code === code); return f?.lines ? { year: y.year, lines: f.lines } : null; }).filter(Boolean);
      allFunds[code] = { unit: u, code, name: lf.name, core: lf.core, tif: lf.tif, history: hist, lines };
    }
    fs.writeFileSync(path.join(OUT, `funds-${u}.json`), JSON.stringify(allFunds));
    for (const stale of [path.join(OUT, `${u}.json`), path.join(OUT, u)]) fs.rmSync(stale, { recursive: true, force: true }); // old layout
    const problems = budget.years.flatMap((y) => y.checks.map((c) => ({ year: y.year, ...c }))).concat(actuals.flatMap((y) => y.checks.map((c) => ({ year: y.year, ...c }))));
    index.units[u] = { label: def.label, gov: def.gov, unitCode: def.unit_code, years: budget.years.map((y) => ({ year: y.year, total: y.total, coreTotal: y.coreTotal, tifTotal: y.tifTotal, rate: y.rate, levy: y.levy, fundCount: y.fundCount, detailCoverage: y.detailCoverage, actualTotal: y.actualTotal ?? null, actualAllFunds: y.actualAllFunds ?? null, actualOperations: y.actualOperations ?? null, actualPassThrough: y.actualPassThrough ?? null, actualMatchedFunds: y.actualMatchedFunds ?? null, checks: y.checks.length, fundChanges: y.fundChanges || null, categories: y.categories,
        funds: y.funds.map((f) => ({ code: f.code, name: f.name, adopted: f.adopted, published: f.published, rate: f.rate, levy: f.levy, core: f.core, tif: f.tif, detail: f.detail, top: f.departments?.[0] ? { name: f.departments[0].name, total: f.departments[0].total } : null, actual: f.actual ? { fund: f.actual.fund, name: f.actual.name, how: f.actual.how, disbursements: f.actual.disbursements } : null })),
        actualProposed: y.actualProposed || [], actualUnmatched: y.actualUnmatched || [] })),
      actuals: actuals.map((a) => ({ year: a.year, debtOutstanding: a.debtOutstanding, debt: a.debt })), coreFunds: budget.coreFunds.length, actualYears: actuals.map((y) => y.year), debt: actuals.map((y) => ({ year: y.year, outstanding: y.debtOutstanding, count: y.debt.length })), problems };
    console.log(`${def.label}: ${budget.years.length} budget years (${budget.years[0]?.year}–${budget.years.at(-1)?.year}), ${actuals.length} actual years, ${problems.length} checks flagged`);
  }
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index));
  for (const l of log) console.log(l);
  console.log(`\nWrote ${OUT}. Commit public/gateway/ and push; the raw files stay out of git.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
