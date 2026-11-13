// QA step 3a: apps/web sweep. Every route per role, he/light/desktop + en/dark/mobile, axe + contrast + targets + console + failed requests + guards.
import * as L from "./web-lib.mjs";
import { saveJson } from "./lib.mjs";
const browser = await L.chromium.launch();
const out = { roles: {}, anon: [], guards: [] };
const EXPECTED_NOISE = (m) => /401 \(Unauthorized\)/.test(m) && false;
async function applyLT(page, locale, theme) {
  await page.getByRole("button", { name: locale === "he" ? "עברית" : "English", exact: true }).first().click().catch(() => {});
  await page.getByRole("button", { name: theme === "dark" ? /^(כהה|Dark)$/ : /^(בהירה|Light)$/ }).first().click().catch(() => {});
  await page.waitForTimeout(250);
}
async function discover(page) {
  const found = {};
  for (const list of ["/requests", "/samples", "/import"]) {
    await page.goto(L.WEB + list, { waitUntil: "networkidle" }).catch(() => {});
    const hrefs = await page.$$eval("main a[href]", (as) => as.map((a) => a.getAttribute("href")));
    for (const h of hrefs) { if (/^\/requests\/[^/]+$/.test(h) && h !== "/requests/new") (found.request ??= h); if (/^\/samples\/[^/]+$/.test(h) && h !== "/samples/new") (found.sample ??= h); if (/^\/import\/[^/]+$/.test(h) && h !== "/import/new") (found.job ??= h); }
  }
  return found;
}
for (const [role, email] of Object.entries(L.ROLES)) {
  await L.reset();
  const R = (out.roles[role] = { variants: [] });
  for (const v of [{ loc: "he", theme: "light", vp: "desktop" }, { loc: "en", theme: "dark", vp: "mobile" }]) {
    const ctx = await L.newCtx(browser, { vp: v.vp, scheme: v.theme, locale: v.loc === "he" ? "he-IL" : "en-US" });
    const page = await ctx.newPage(); const b = L.newBucket(); L.collect(page, b);
    await L.login(page, email); await applyLT(page, v.loc, v.theme);
    const ex = await discover(page);
    let paths = Object.keys(L.ROUTES).filter((p) => L.allowed(p, role));
    if (role === "researcher_il") paths.push(...(ex.request ? [ex.request] : []));
    if (role === "national_coordinator") paths.push(...[ex.request && ex.request + "/precheck", ex.sample, ex.job].filter(Boolean));
    if (role === "committee_member") paths.push(...[ex.request, ex.request && ex.request + "/decision"].filter(Boolean));
    if (role === "center_clinician" && ex.sample) paths.push(ex.sample);
    for (const p of paths) {
      const mark = { c: b.console.length, f: b.failed.length };
      await page.goto(L.WEB + p, { waitUntil: "networkidle" }).catch(() => {});
      await page.waitForTimeout(500);
      const r = { role, path: p, ...v, finalPath: new URL(page.url()).pathname };
      await L.installAudit(page);
      r.contrast = await page.evaluate(() => window.__auditContrast());
      r.targets = await page.evaluate((m) => window.__auditTargets(m), v.vp === "mobile" ? 44 : 24);
      r.targets24 = v.vp === "mobile" ? await page.evaluate(() => window.__auditTargets(24)) : r.targets;
      r.hscroll = await page.evaluate(() => window.__hscroll());
      r.axe = (await L.runAxe(page, p)).violations;
      r.h1 = await page.locator("h1").count();
      r.dirLang = await page.evaluate(() => document.documentElement.dir + "/" + document.documentElement.lang + "/" + (document.documentElement.dataset.theme || "none"));
      r.bodyText = (await page.locator("main").innerText().catch(() => "")).slice(0, 4000);
      r.console = b.console.slice(mark.c); r.failed = b.failed.slice(mark.f);
      r.shot = await L.shot(page, "web", `${role}__${p.replace(/^\//, "").replace(/\//g, "_")}__${v.loc}-${v.theme}-${v.vp}`);
      R.variants.push(r);
    }
    // role guard: disallowed routes
    if (v.vp === "desktop") for (const p of Object.keys(L.ROUTES).filter((p) => !L.allowed(p, role))) {
      await page.goto(L.WEB + p, { waitUntil: "networkidle" }).catch(() => {}); await page.waitForTimeout(300);
      out.guards.push({ role, path: p, final: new URL(page.url()).pathname, h1: (await page.locator("h1").first().innerText().catch(() => "")).slice(0, 60), showsContent: (await page.locator("main").innerText().catch(() => "")).length });
    }
    // session cookie flags
    if (v.vp === "desktop") R.cookies = (await ctx.cookies()).map((c) => ({ n: c.name, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite }));
    // logout
    if (v.vp === "desktop") { await page.goto(L.WEB + "/home"); await page.getByRole("button", { name: /התנתקות|Sign out/ }).first().click().catch(() => {}); await page.waitForTimeout(600); R.afterLogout = new URL(page.url()).pathname; await page.goto(L.WEB + "/home", { waitUntil: "networkidle" }); R.homeAfterLogout = new URL(page.url()).pathname; }
    R.consoleAll = b.console.length; await ctx.close();
    console.log(role, v.loc, v.vp, "done", R.variants.length);
  }
}
// anonymous
{
  const ctx = await L.newCtx(browser, { locale: "he-IL" }); const page = await ctx.newPage();
  for (const p of [...Object.keys(L.ROUTES), "/requests/xyz", "/does-not-exist"]) { await page.goto(L.WEB + p, { waitUntil: "networkidle" }); await page.waitForTimeout(250); out.anon.push({ path: p, final: new URL(page.url()).pathname + new URL(page.url()).search }); }
  for (const p of ["/login", "/login/mfa", "/register", "/session-ended"]) {
    await page.goto(L.WEB + p, { waitUntil: "networkidle" }); await L.installAudit(page);
    out.anon.push({ path: p, axe: (await L.runAxe(page, p)).violations, contrast: await page.evaluate(() => window.__auditContrast()), shot: await L.shot(page, "web", `anon__${p.slice(1).replace(/\//g, "_")}__he-light-desktop`) });
  }
  await ctx.close();
}
await browser.close();
await saveJson("web-sweep.json", out);
