// QA step 2: public site. Builds (best effort), serves dist and dist-analytics, runs page matrix + behaviours.
import { execSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { chromium, ROOT, serveStatic, newCtx, collect, newBucket, installAudit, runAxe, shot, saveJson } from "./lib.mjs";
const SITE = join(ROOT, "apps/public-site");
try { execSync("pnpm --filter public-site build", { cwd: ROOT, stdio: "ignore", timeout: 300000 }); } catch (e) { console.log("build failed; using existing dist"); }
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const pages = walk(join(SITE, "dist")).filter((f) => f.endsWith("index.html") && !f.includes("/admin/")).map((f) => "/" + relative(join(SITE, "dist"), f).replace(/index\.html$/, "")).sort();
const srv = await serveStatic(join(SITE, "dist"), 4811);
const srvA = await serveStatic(join(SITE, "dist-analytics"), 4812);
const B = "http://127.0.0.1:4811", A = "http://127.0.0.1:4812";
const browser = await chromium.launch();
const out = { pages: [], consent: {}, forms: [], lang: [], links: {}, theme: {}, menu: {} };
const slug = (p) => p.replace(/^\/|\/$/g, "").replace(/\//g, "_") || "root";

for (const p of pages) for (const [vp, scheme] of [["desktop", "light"], ["mobile", "dark"]]) {
  const ctx = await newCtx(browser, { vp, scheme, locale: p.startsWith("/he") ? "he-IL" : "en-US" });
  const page = await ctx.newPage(); const b = newBucket(); collect(page, b);
  const resp = await page.goto(B + p, { waitUntil: "networkidle" });
  await installAudit(page);
  const r = { path: p, vp, scheme, status: resp.status() };
  r.contrast = await page.evaluate(() => window.__auditContrast());
  r.targets = await page.evaluate((m) => window.__auditTargets(m), vp === "mobile" ? 44 : 24);
  r.targets24 = vp === "mobile" ? await page.evaluate(() => window.__auditTargets(24)) : r.targets;
  r.hscroll = await page.evaluate(() => window.__hscroll());
  r.axe = (await runAxe(page, p)).violations;
  r.struct = await page.evaluate(() => {
    const hs = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => +h.tagName[1]);
    const jumps = []; hs.reduce((prev, h, i) => { if (h - prev > 1) jumps.push(`h${prev}->h${h}@${i}`); return h; }, 0);
    const skip = document.querySelector('a[href^="#"]');
    return { h1: hs.filter((x) => x === 1).length, jumps, imgNoAlt: [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).map((i) => i.src.slice(-40)), skipLinkFirst: !!skip && skip.compareDocumentPosition(document.querySelector("main") || document.body) !== 0 && [...document.querySelectorAll("a")][0] === skip, lang: document.documentElement.lang, dir: document.documentElement.dir, title: document.title, landmarks: { main: document.querySelectorAll("main").length, nav: document.querySelectorAll("nav").length, header: document.querySelectorAll("header").length, footer: document.querySelectorAll("footer").length }, hreflang: [...document.querySelectorAll('link[rel=alternate]')].length, canonical: !!document.querySelector("link[rel=canonical]") };
  });
  r.console = b.console; r.failed = b.failed; r.thirdParty = b.requests.filter((u) => !u.startsWith(B) && !u.startsWith("data:"));
  r.shot = await shot(page, "public-site", `${slug(p)}-${vp}-${scheme}`);
  out.pages.push(r); await ctx.close();
}

// Consent behaviour (analytics build)
{
  const ctx = await newCtx(browser, { locale: "en-US" }); const page = await ctx.newPage(); const reqs = [];
  page.on("request", (r) => reqs.push(r.url()));
  await ctx.route("https://analytics.ari-pst.example/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "window.__umami=1" }));
  await page.goto(A + "/en/", { waitUntil: "networkidle" });
  const c = out.consent;
  c.bannerVisibleFirstVisit = await page.locator("#consent").isVisible();
  c.requestsBeforeConsent = reqs.filter((u) => u.includes("analytics.")).length;
  c.cookiesBefore = (await ctx.cookies()).map((x) => x.name);
  c.buttons = await page.locator("#consent button").allTextContents();
  c.buttonsEqualProminence = await page.evaluate(() => { const [a, b] = [...document.querySelectorAll("#consent button")].map((x) => { const cs = getComputedStyle(x); return cs.backgroundColor + "|" + cs.fontSize + "|" + x.offsetWidth + "x" + x.offsetHeight; }); return { a, b, same: a === b }; });
  await shot(page, "public-site", "consent-banner-en", { fullPage: false });
  await page.keyboard.press("Tab"); c.focusAfterTab = await page.evaluate(() => document.activeElement.textContent.trim().slice(0, 20));
  await page.locator("[data-consent=decline]").click(); await page.waitForTimeout(300);
  c.requestsAfterDecline = reqs.filter((u) => u.includes("analytics.")).length; c.bannerHiddenAfterDecline = !(await page.locator("#consent").isVisible());
  await page.reload({ waitUntil: "networkidle" }); c.persistedDeny = !(await page.locator("#consent").isVisible()) && reqs.filter((u) => u.includes("analytics.")).length === 0;
  await ctx.clearCookies(); await page.reload({ waitUntil: "networkidle" });
  await page.locator("[data-consent=accept]").click(); await page.waitForTimeout(400);
  c.requestsAfterAccept = reqs.filter((u) => u.includes("analytics.")).length;
  c.cookie = (await ctx.cookies()).map((x) => ({ n: x.name, sameSite: x.sameSite, secure: x.secure, exp: Math.round((x.expires - Date.now() / 1000) / 86400) }));
  await ctx.close();
  // DNT / GPC
  const ctx2 = await newCtx(browser, { locale: "he-IL" }); const p2 = await ctx2.newPage(); const reqs2 = [];
  await ctx2.addInitScript(() => Object.defineProperty(navigator, "doNotTrack", { value: "1" }));
  p2.on("request", (r) => reqs2.push(r.url()));
  await p2.goto(A + "/he/", { waitUntil: "networkidle" }); c.dntNoBanner = !(await p2.locator("#consent").isVisible()); c.dntNoRequests = reqs2.filter((u) => u.includes("analytics.")).length === 0;
  await ctx2.close();
  // Hebrew + mobile banner screenshot
  const ctx3 = await newCtx(browser, { vp: "mobile", locale: "he-IL", scheme: "dark" }); const p3 = await ctx3.newPage();
  await p3.goto(A + "/he/", { waitUntil: "networkidle" }); await shot(p3, "public-site", "consent-banner-he-mobile-dark", { fullPage: false });
  c.mobileBannerCoversMoreThanHalf = await p3.evaluate(() => document.getElementById("consent").getBoundingClientRect().height / innerHeight);
  await ctx3.close();
  // default build: banner should be absent or hidden, no third party
  const ctx4 = await newCtx(browser); const p4 = await ctx4.newPage(); const r4 = []; p4.on("request", (r) => r4.push(r.url()));
  await p4.goto(B + "/en/", { waitUntil: "networkidle" }); c.defaultBuildBannerVisible = await p4.locator("#consent").isVisible().catch(() => false); c.defaultBuildThirdParty = r4.filter((u) => !u.startsWith(B));
  await ctx4.close();
}

// Forms
for (const loc of ["en", "he"]) for (const kind of ["contact", "join"]) {
  const ctx = await newCtx(browser, { locale: loc === "he" ? "he-IL" : "en-US" }); const page = await ctx.newPage(); const b = newBucket(); collect(page, b);
  const f = { loc, kind };
  let mode = "ok"; await page.route("**/api/v1/public/forms/**", (r) => { f.postBody = r.request().postData()?.slice(0, 300); return mode === "ok" ? r.fulfill({ status: 202, body: "{}" }) : mode === "rate" ? r.fulfill({ status: 429, body: "{}" }) : r.fulfill({ status: 500, body: "{}" }); });
  await page.goto(`${B}/${loc}/${kind}/`, { waitUntil: "networkidle" });
  const form = page.locator("form[data-form]");
  f.fields = await form.locator("input,select,textarea").evaluateAll((els) => els.map((e) => ({ n: e.name, t: e.type, req: e.required || e.getAttribute("aria-required") === "true", labelled: !!(e.labels && e.labels.length) || !!e.getAttribute("aria-label"), ac: e.autocomplete })));
  await form.locator("button[type=submit]").click(); await page.waitForTimeout(200);
  f.emptySubmitSummary = await form.locator("[data-summary]").innerText().catch(() => "");
  f.summaryFocused = await page.evaluate(() => !!document.activeElement.closest("[data-summary]") || document.activeElement.hasAttribute("data-summary"));
  f.invalidFields = await form.locator("[aria-invalid=true]").count();
  await shot(page, "public-site", `form-${kind}-empty-errors-${loc}`, { fullPage: false });
  // fill invalid email
  const email = form.locator("input[type=email]"); if (await email.count()) { await email.fill("not-an-email"); await form.locator("button[type=submit]").click(); f.badEmailMsg = await email.evaluate((e) => (e.closest(".field,div")?.innerText || "").slice(0, 120)); }
  // identifier-like text
  const fill = async (txt) => { for (const el of await form.locator("input:not([type=checkbox]):not([type=hidden]):not([type=email]),textarea").all()) await el.fill(txt).catch(() => {}); for (const s of await form.locator("select").all()) await s.selectOption({ index: 1 }).catch(() => {}); await email.fill("test@example.test").catch(() => {}); for (const c of await form.locator("input[type=checkbox]").all()) await c.check().catch(() => {}); };
  await fill("Synthetic Tester"); const ta = form.locator("textarea"); if (await ta.count()) await ta.fill("my id is 123456789 please call 050-1234567");
  await form.locator("button[type=submit]").click(); await page.waitForTimeout(200); f.identifierBlocked = (await form.locator("[data-summary]").innerText().catch(() => "")).slice(0, 160);
  if (await ta.count()) await ta.fill("Hello, a synthetic question about the portal.");
  await form.locator("button[type=submit]").click(); await page.waitForTimeout(500);
  f.successStatus = (await form.locator("[data-status]").innerText().catch(() => "")).slice(0, 120); f.postedTo = !!f.postBody; f.formResetAfter = await form.locator("input[type=text]").first().inputValue().catch(() => "n/a");
  await shot(page, "public-site", `form-${kind}-success-${loc}`, { fullPage: false });
  mode = "err"; await fill("Synthetic Tester"); if (await ta.count()) await ta.fill("Hello again"); await form.locator("button[type=submit]").click(); await page.waitForTimeout(500);
  f.errorStatus = (await form.locator("[data-summary]").innerText().catch(() => "")).slice(0, 120); f.valuesKeptOnError = await form.locator("input[type=text]").first().inputValue().catch(() => "n/a");
  await shot(page, "public-site", `form-${kind}-server-error-${loc}`, { fullPage: false });
  mode = "rate"; await form.locator("button[type=submit]").click(); await page.waitForTimeout(500); f.rateStatus = (await form.locator("[data-summary]").innerText().catch(() => "")).slice(0, 120);
  f.console = b.console.filter((x) => !/404|500|429|Failed to load resource/.test(x));
  out.forms.push(f); await ctx.close();
}

// Language switch / theme / menu / links
for (const vp of ["desktop", "mobile"]) {
  const ctx = await newCtx(browser, { vp, locale: "en-US" }); const page = await ctx.newPage();
  await page.goto(B + "/en/about/", { waitUntil: "networkidle" });
  const l = { vp };
  if (vp === "mobile") { const tgl = page.locator("[data-menu-toggle], button[aria-controls], button[aria-expanded]").first(); l.menuToggle = await tgl.count(); if (l.menuToggle) { l.menuTargets = await tgl.boundingBox(); await tgl.click(); l.menuExpanded = await tgl.getAttribute("aria-expanded"); await shot(page, "public-site", "mobile-menu-open-en", { fullPage: false }); await page.keyboard.press("Escape"); l.menuEscCloses = (await tgl.getAttribute("aria-expanded")) === "false"; } }
  const sw = page.locator('a[hreflang="he"], a[lang="he"]').first(); l.switchFound = await sw.count();
  if (l.switchFound) { l.switchHref = await sw.getAttribute("href"); await sw.click(); await page.waitForLoadState(); l.afterSwitch = new URL(page.url()).pathname; l.htmlDir = await page.evaluate(() => document.documentElement.dir); }
  out.lang.push(l);
  // theme toggle
  const th = page.locator("[data-theme-toggle], button:has-text('Dark'), button:has-text('כהה'), button[aria-label*='theme' i]").first();
  out.theme[vp] = { found: await th.count() }; if (out.theme[vp].found) { const before = await page.evaluate(() => document.documentElement.dataset.theme || "none"); await th.click(); out.theme[vp].before = before; out.theme[vp].after = await page.evaluate(() => document.documentElement.dataset.theme || "none"); }
  await ctx.close();
}
// Link check: every internal link/asset on every page resolves.
{
  const ctx = await newCtx(browser); const page = await ctx.newPage(); const seen = new Map(); const bad = []; const external = new Set();
  for (const p of pages) {
    await page.goto(B + p, { waitUntil: "domcontentloaded" });
    const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => ({ h: a.getAttribute("href"), t: (a.textContent || a.getAttribute("aria-label") || "").trim().slice(0, 30), blank: a.target === "_blank", rel: a.rel })));
    for (const { h, t, blank, rel } of hrefs) {
      if (!h || h.startsWith("#") || h.startsWith("mailto:") || h.startsWith("tel:")) { if (h === "#" ) bad.push({ from: p, href: h, why: "empty hash link" }); continue; }
      if (/^https?:\/\//.test(h) && !h.startsWith(B)) { external.add(h); if (blank && !/noopener/.test(rel)) bad.push({ from: p, href: h, why: "target=_blank without noopener" }); continue; }
      const u = new URL(h, B + p); u.hash = ""; const key = u.pathname;
      if (!seen.has(key)) { const r = await fetch(B + key); seen.set(key, r.status); }
      if (seen.get(key) >= 400) bad.push({ from: p, href: h, text: t, status: seen.get(key) });
    }
  }
  out.links = { checked: seen.size, broken: bad, external: [...external] }; await ctx.close();
}
await browser.close(); srv.close(); srvA.close();
await saveJson("public-site.json", out);
const agg = (k) => out.pages.reduce((n, p) => n + p[k].length, 0);
console.log(`pages=${pages.length} runs=${out.pages.length} contrast=${agg("contrast")} axe=${agg("axe")} targets=${agg("targets")} hscroll=${out.pages.filter((p) => p.hscroll).length} broken=${out.links.broken.length}`);
