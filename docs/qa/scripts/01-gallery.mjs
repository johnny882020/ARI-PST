// QA step 1: design-system gallery. Builds gallery, serves it, runs the matrix.
import { execSync } from "node:child_process";
import { join } from "node:path";
import { chromium, ROOT, serveStatic, newCtx, collect, newBucket, installAudit, runAxe, shot, saveJson } from "./lib.mjs";

execSync("pnpm --filter @ari/design-system gallery:build", { cwd: ROOT, stdio: "ignore" });
const srv = await serveStatic(join(ROOT, "packages/design-system/gallery/dist"), 4801);
const URL = "http://127.0.0.1:4801/";
const browser = await chromium.launch();
const out = { matrix: [], keyboard: [], overflow: [], motion: {}, focus: [] };

async function setup(page, locale, theme) {
  await page.goto(URL); await page.waitForSelector("h1");
  if (locale === "en") await page.getByRole("button", { name: /^(English|EN)$/i }).first().click().catch(async () => { await page.locator("button:has-text('EN')").first().click(); });
  await page.evaluate((t) => { if (t) document.documentElement.setAttribute("data-theme", t); }, theme);
  await page.waitForTimeout(300);
}
for (const locale of ["he", "en"]) for (const theme of ["light", "dark"]) for (const vp of ["desktop", "mobile"]) {
  const ctx = await newCtx(browser, { vp, scheme: theme, locale: locale === "he" ? "he-IL" : "en-US" });
  const page = await ctx.newPage(); const b = newBucket(); collect(page, b);
  await setup(page, locale, theme);
  const dirOk = await page.evaluate(() => document.documentElement.dir + "/" + document.documentElement.lang);
  await installAudit(page);
  const contrast = await page.evaluate(() => window.__auditContrast());
  const targets = await page.evaluate((m) => window.__auditTargets(m), vp === "mobile" ? 44 : 24);
  const t24 = vp === "mobile" ? await page.evaluate(() => window.__auditTargets(24)) : targets;
  const hs = await page.evaluate(() => window.__hscroll());
  const axe = await runAxe(page, `${locale}-${theme}-${vp}`);
  const f = await shot(page, "gallery", `${locale}-${theme}-${vp}`);
  out.matrix.push({ locale, theme, vp, dirOk, contrast, targets, targets24: t24, hscroll: hs, axe: axe.violations, console: b.console, failed: b.failed, shot: f });
  await ctx.close();
}

// Keyboard + overlays (he/en desktop light)
for (const locale of ["en", "he"]) {
  const ctx = await newCtx(browser, { locale: locale === "he" ? "he-IL" : "en-US" });
  const page = await ctx.newPage(); const b = newBucket(); collect(page, b);
  await setup(page, locale, "light");
  const k = { locale, notes: [] };
  // Tab order: record first 40 stops
  await page.evaluate(() => document.body.focus());
  const stops = [];
  for (let i = 0; i < 45; i++) { await page.keyboard.press("Tab"); stops.push(await page.evaluate(() => { const e = document.activeElement; return e ? `${e.tagName.toLowerCase()}:${(e.getAttribute("aria-label") || e.textContent || e.name || e.id || "").trim().slice(0, 22)}` : "none"; })); }
  k.tabOrder = stops;
  // visible focus ring
  k.focusRing = await page.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return { outline: cs.outlineStyle + " " + cs.outlineWidth + " " + cs.outlineColor, shadow: cs.boxShadow.slice(0, 80) }; });
  await shot(page, "gallery", `consent-${locale}`, { fullPage: false });
  k.consoleBefore = b.console.length;
  await page.locator(".ds-consent button").first().focus(); k.consentButtons = await page.locator(".ds-consent button").allTextContents();
  await page.locator(".ds-consent button").last().click(); await page.waitForTimeout(150);
  // Dialog: open via Enter, trap, Esc, restore
  const opener = page.getByRole("button", { name: "Open dialog" });
  await opener.focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(250);
  k.dialogOpen = await page.getByRole("dialog").count();
  k.dialogFocusInside = await page.evaluate(() => !!document.activeElement.closest("[role=dialog]"));
  let escaped = false;
  for (let i = 0; i < 8; i++) { await page.keyboard.press("Tab"); if (!(await page.evaluate(() => !!document.activeElement.closest("[role=dialog]")))) escaped = true; }
  k.focusTrapped = !escaped;
  await page.keyboard.press("Shift+Tab"); k.shiftTabInside = await page.evaluate(() => !!document.activeElement.closest("[role=dialog]"));
  k.dialogAria = await page.evaluate(() => { const d = document.querySelector("[role=dialog]"); return d ? { modal: d.getAttribute("aria-modal"), labelledby: !!d.getAttribute("aria-labelledby") || !!d.getAttribute("aria-label") } : null; });
  await shot(page, "gallery", `dialog-open-${locale}`, { fullPage: false });
  await page.keyboard.press("Escape"); await page.waitForTimeout(250);
  k.dialogClosedByEsc = (await page.getByRole("dialog").count()) === 0;
  k.focusRestored = await page.evaluate(() => (document.activeElement.textContent || "").trim());
  // Session timeout dialog
  await page.getByRole("button", { name: "Session timeout" }).click(); await page.waitForTimeout(250);
  k.sessionDialog = await page.evaluate(() => { const d = document.querySelector("[role=alertdialog],[role=dialog]"); return d ? { role: d.getAttribute("role"), text: d.textContent.slice(0, 120) } : null; });
  await shot(page, "gallery", `session-timeout-${locale}`, { fullPage: false });
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  k.sessionEscCloses = (await page.locator("[role=alertdialog],[role=dialog]").count()) === 0;
  if (!k.sessionEscCloses) { await page.locator("[role=alertdialog] button, [role=dialog] button").first().click(); }
  // Checkbox / Switch space
  const cb = page.getByRole("checkbox", { name: "Checkbox", exact: true }); if (await cb.count()) { await cb.focus(); await page.keyboard.press("Space"); k.checkboxSpace = await cb.isChecked(); }
  const sw = page.getByRole("switch").first(); if (await sw.count()) { await sw.focus(); const before = await sw.isChecked(); await page.keyboard.press("Space"); k.switchSpace = before !== (await sw.isChecked()); }
  // Tabs arrow keys
  const tab = page.getByRole("tab").first(); await tab.focus(); await page.keyboard.press(locale === "he" ? "ArrowLeft" : "ArrowRight"); k.tabsArrow = await page.evaluate(() => document.activeElement.getAttribute("role") + ":" + document.activeElement.textContent);
  k.tabsSelected = await page.evaluate(() => [...document.querySelectorAll("[role=tab]")].map((t) => t.getAttribute("aria-selected")));
  // Radio arrows
  const radio = page.getByRole("radio").first(); await radio.focus(); await page.keyboard.press("ArrowDown"); k.radioArrow = await page.evaluate(() => document.activeElement.type + ":" + document.activeElement.checked);
  // Buttons Enter/Space increments: toast
  await page.getByRole("button", { name: "Show toast" }).focus(); await page.keyboard.press("Space"); await page.waitForTimeout(200);
  k.toast = await page.evaluate(() => { const r = document.querySelector("[role=status],[role=alert],[aria-live]"); return r ? r.getAttribute("aria-live") || r.getAttribute("role") : null; });
  // Tooltip on focus
  await page.getByRole("button", { name: "Hover or focus" }).focus(); await page.waitForTimeout(400);
  k.tooltipOnFocus = await page.getByRole("tooltip").count();
  await page.keyboard.press("Escape"); await page.waitForTimeout(100); k.tooltipEsc = await page.getByRole("tooltip").count();
  // Table sort via keyboard
  const sortBtn = page.locator("th button").first(); if (await sortBtn.count()) { await sortBtn.focus(); await page.keyboard.press("Enter"); k.tableSortAria = await page.evaluate(() => [...document.querySelectorAll("th")].map((t) => t.getAttribute("aria-sort"))); }
  // Consent banner
  // hover/focus screenshot of primary button
  const prim = page.getByRole("button", { name: "Primary", exact: true }); await prim.hover(); k.hoverBg = await prim.evaluate((e) => getComputedStyle(e).backgroundColor);
  await prim.evaluate((e) => e.blur()); k.restBg = await prim.evaluate((e) => getComputedStyle(e).backgroundColor);
  // disabled
  k.disabledBtn = await page.getByRole("button", { name: "Disabled" }).evaluate((e) => ({ disabled: e.disabled, aria: e.getAttribute("aria-disabled"), cursor: getComputedStyle(e).cursor }));
  k.loadingBtn = await page.getByRole("button", { name: /Loading/ }).first().evaluate((e) => ({ disabled: e.disabled, ariaBusy: e.getAttribute("aria-busy"), ariaDisabled: e.getAttribute("aria-disabled") }));
  // Aggregate tiles: suppressed must not show digits / '<5'
  k.tiles = await page.evaluate(() => [...document.querySelectorAll("[class*=tile]")].map((t) => t.textContent.trim().slice(0, 80)));
  // RTL mirroring: pagination icons & stepper
  k.pagIcons = await page.evaluate(() => [...document.querySelectorAll("nav button svg, nav a svg")].slice(0, 4).map((s) => getComputedStyle(s).transform));
  k.consoleErrors = b.console;
  out.keyboard.push(k);
  await ctx.close();
}

// Long Hebrew string overflow (desktop + mobile)
const LONG = "אבחנה מורכבת ארוכה במיוחד של גידול מוחי בילדים עם תת-סוג מולקולרי נדיר מאוד וללא רווחים סבירים בכלל_מילה_ארוכה_אחת_ללא_שבירה";
for (const vp of ["desktop", "mobile"]) {
  const ctx = await newCtx(browser, { vp, locale: "he-IL" }); const page = await ctx.newPage(); await setup(page, "he", "light");
  const res = await page.evaluate((L) => {
    const sel = ".ds-btn,.ds-chip,.ds-badge,.ds-status,.ds-card,.ds-alert,.ds-tile,td,th,label,legend,.ds-empty,.ds-field,.ds-tab,[role=tab]";
    const els = [...document.querySelectorAll(sel)]; const leaf = (e) => e.children.length === 0 || e.querySelectorAll("*").length < 4;
    els.filter(leaf).slice(0, 80).forEach((e) => { if (e.textContent.trim() && !e.querySelector("input,svg")) e.textContent = L; });
    return { hscroll: window.__hscroll ? null : null, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
      clipped: els.filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== "visible").map((e) => e.className.toString().slice(0, 40) + ":" + e.scrollWidth + ">" + e.clientWidth).slice(0, 10),
      spill: els.filter((e) => { const r = e.getBoundingClientRect(); return r.right > document.documentElement.clientWidth + 1 || r.left < -1; }).map((e) => e.className.toString().slice(0, 40)).slice(0, 10) };
  }, LONG);
  res.vp = vp; await shot(page, "gallery", `long-hebrew-${vp}`);
  out.overflow.push(res); await ctx.close();
}

// Reduced motion
{
  const ctx = await newCtx(browser, { reducedMotion: "reduce" }); const page = await ctx.newPage(); await setup(page, "en", "light");
  out.motion = await page.evaluate(() => { const bad = []; document.querySelectorAll("*").forEach((e) => { const cs = getComputedStyle(e); const dur = parseFloat(cs.animationDuration) || 0; const tdur = parseFloat(cs.transitionDuration) || 0; if ((cs.animationName !== "none" && dur > 0.01 && cs.animationIterationCount === "infinite") ) bad.push(e.className.toString().slice(0, 40) + " anim " + cs.animationName); }); return { infiniteAnimationsUnderReduce: bad.slice(0, 10), scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior }; });
  await ctx.close();
}
await browser.close(); srv.close();
await saveJson("gallery.json", out);
const sum = out.matrix.map((m) => `${m.locale}-${m.theme}-${m.vp}: contrast=${m.contrast.length} targets=${m.targets.length} axe=${m.axe.length} hscroll=${!!m.hscroll} console=${m.console.length}`);
console.log(sum.join("\n"));
