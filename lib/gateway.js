// The state's budget data (Indiana Gateway), built into public/gateway/ by mac/gateway-build.mjs, read here for the
// drafter and the public site. Everything is static files: no Redis, no API calls.
//
// What the drafter gets is a "fund card" per fund: the unit's own name for it, the state code, this year's adopted
// amount, last year's actual spending. Matching is strict: a fund is only ever attached by the exact name or code on
// this list, so a draft can say "$144,000 out of a $33 million general fund" but never invent a fund or a size.
import fs from "node:fs"; import path from "node:path";

const UNIT_OF = { city: "kokomo", county: "howard" };
const cache = new Map();
async function loadSite(gov) {
  const unit = UNIT_OF[gov]; if (!unit) return null;
  if (cache.has(unit)) return cache.get(unit);
  let data = null;
  for (const p of [path.join(process.cwd(), "public", "gateway", `site-${unit}.json`), path.join(path.dirname(new URL(import.meta.url).pathname), "..", "public", "gateway", `site-${unit}.json`)]) {
    try { data = JSON.parse(fs.readFileSync(p, "utf8")); break; } catch (e) {}
  }
  if (!data) { // deployed without the file traced: read our own site
    try { const base = process.env.SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://www.secondreading.org"); const r = await fetch(`${base}/gateway/site-${unit}.json`); if (r.ok) data = await r.json(); } catch (e) {}
  }
  cache.set(unit, data);
  return data;
}

// The current fund list for a government: latest budget year, with last year's actual spending where paired
export async function fundList(gov) {
  const d = await loadSite(gov); if (!d) return [];
  const y = d.years.at(-1); const actY = d.years.slice().reverse().find((x) => x.actual);
  return y.funds.filter((f) => f.adopted > 0).map((f) => ({ code: f.code, name: f.name, year: y.year, adopted: f.adopted, rate: f.rate, tif: !!f.tif, spentYear: actY?.year || null, spent: actY?.funds.find((x) => x.code === f.code)?.spent ?? null, gov }));
}

const $ = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
// Compact text for the drafter's prompt: one line per fund
export async function fundContext(gov) {
  const funds = await fundList(gov); if (!funds.length) return "";
  const who = gov === "city" ? "City of Kokomo" : "Howard County";
  return `${who.toUpperCase()} FUNDS (state's budget forms; code: name — adopted ${funds[0].year}${funds[0].spentYear ? `; actually spent ${funds[0].spentYear}` : ""}):\n` +
    funds.map((f) => `${f.code}: ${f.name.replace(/\s*\(.*?\)/g, "")} — ${$(f.adopted)}${f.spent != null ? `; spent ${$(f.spent)}` : ""}`).join("\n");
}

// Strict lookup: exact state code, or the fund's exact name (case-insensitive, punctuation ignored). Nothing fuzzy.
const norm = (s) => String(s || "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\bfund\b/g, " ").replace(/\s+/g, " ").trim();
export async function findFund(gov, ref) {
  const funds = await fundList(gov); const r = String(ref || "").trim(); if (!r) return null;
  return funds.find((f) => f.code === r) || funds.find((f) => norm(f.name) === norm(r)) || null;
}

// A one-paragraph card for the posts drafter (or anything else that has an item with a fund)
export async function fundCard(gov, ref) {
  const f = await findFund(gov, ref); if (!f) return null;
  return { fund: f.name, code: f.code, government: gov === "city" ? "City of Kokomo" : "Howard County", adopted: { year: f.year, amount: f.adopted }, ...(f.spent != null ? { spent: { year: f.spentYear, amount: f.spent } } : {}), tif: f.tif, page: `secondreading.org/#/budget/${gov}/fund/${f.code}` };
}
