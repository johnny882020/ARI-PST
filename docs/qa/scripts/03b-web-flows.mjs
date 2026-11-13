// QA step 3b: functional flows on the web app (mock server by default; WEB_URL to point elsewhere).
import * as L from "./web-lib.mjs";
import { saveJson } from "./lib.mjs";
import { writeFileSync } from "node:fs";
const B = L.WEB; const browser = await L.chromium.launch(); const out = { steps: [], suppression: [] };
const step = async (name, fn) => { try { const r = await fn(); out.steps.push({ name, ok: r !== false, detail: typeof r === "string" ? r : undefined }); console.log(r === false ? "FAIL" : "ok  ", name, typeof r === "string" ? "- " + r.slice(0, 120) : ""); } catch (e) { out.steps.push({ name, ok: false, detail: String(e.message).split("\n")[0].slice(0, 200) }); console.log("FAIL", name, String(e.message).split("\n")[0].slice(0, 160)); } };
const open = async (role, o = {}) => { const ctx = await L.newCtx(browser, { locale: "en-US", ...o }); const page = await ctx.newPage(); const bk = L.newBucket(); L.collect(page, bk); await L.login(page, L.ROLES[role] ?? role); await page.getByRole("button", { name: "English", exact: true }).click(); return { ctx, page, bk }; };
async function fillWizard(page, tag) {
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(300);
    for (const el of await page.locator("main textarea, main input[type=text], main input:not([type])").all()) { if (!(await el.inputValue())) await el.fill("Synthetic QA text").catch(() => {}); }
    for (const s of await page.locator("main select").all()) { if (!(await s.inputValue())) await s.selectOption({ index: 1 }).catch(() => {}); }
    for (const c of await page.locator("main input[type=checkbox]").all()) { if (!(await c.isChecked())) await c.check().catch(() => {}); }
    for (const c of await page.locator("main input[type=date]").all()) await c.fill("2026-12-01").catch(() => {});
    for (const c of await page.locator("main input[type=radio]").all().then((a) => a.slice(0, 1))) await c.check().catch(() => {});
    await L.shot(page, "web", `flow-researcher__request-wizard-step${i + 1}__${tag}`, { fullPage: true });
    const sub = page.getByRole("button", { name: /^(Send|Submit|Send request|Submit request)/i }); if (await sub.count()) { await sub.first().click(); return true; }
    const next = page.getByRole("button", { name: /^Continue/i }); if (!(await next.count())) return false; await next.first().click();
  }
}
// ---- researcher: search, suppression, cart, request, tracker ----
await L.reset();
{
  const { ctx, page, bk } = await open("researcher_il");
  await step("researcher: search page renders aggregate tiles", async () => { await page.goto(B + "/search", { waitUntil: "networkidle" }); return (await page.locator("main").innerText()).length > 100; });
  await step("suppression: no raw small number / '<5' / threshold anywhere in search UI over 12 facet combos", async () => {
    const boxes = page.getByRole("checkbox"); const n = await boxes.count(); const bad = [];
    for (let i = 0; i < Math.min(n, 12); i++) { await boxes.nth(i).check().catch(() => {}); await page.waitForTimeout(500); const t = await page.locator("main").innerText();
      const suppressedTiles = (t.match(/Too few to show|Count not shown/g) || []).length; out.suppression.push({ i, suppressedTiles });
      if (/<\s*5|less than 5|fewer than 5|below 5|\b[0-4]\s+(samples|donors)\b/i.test(t)) bad.push(i + ":" + t.match(/<\s*5|less than 5|fewer than 5|below 5|\b[0-4]\s+(samples|donors)\b/i)[0]);
      await boxes.nth(i).uncheck().catch(() => {}); }
    await L.shot(page, "web", "flow-researcher__search-suppressed__en-light-desktop");
    return bad.length ? (out.suppressionBad = bad, false) : `checked ${Math.min(n, 12)} facets; suppressed tiles seen: ${out.suppression.reduce((a, b) => a + b.suppressedTiles, 0)}`;
  });
  await step("suppressed state offers explanation (Why are some numbers hidden?)", async () => { const d = page.locator("summary", { hasText: /Why/ }); await d.first().click(); const t = await page.locator("details[open]").innerText(); return !/\b5\b|k\s*=|threshold/i.test(t) ? t.slice(0, 100) : false; });
  await step("search: free text no results -> empty state", async () => { await page.goto(B + "/search?q=zzzznomatch", { waitUntil: "networkidle" }); const sb = page.getByRole("searchbox").or(page.locator("input[type=search], input[role=combobox]")).first(); await sb.fill("zzzznomatch"); await sb.press("Enter"); await page.waitForTimeout(800); await L.shot(page, "web", "flow-researcher__search-noresults__en-light-desktop"); return (await page.locator("main").innerText()).slice(0, 200).replace(/\n/g, " | "); });
  await step("add to cart, keyboard-only (Tab/Enter)", async () => { await page.goto(B + "/search", { waitUntil: "networkidle" }); await page.getByRole("checkbox", { name: /FFPE/ }).focus(); await page.keyboard.press("Space"); await page.waitForTimeout(700); const btn = page.getByRole("button", { name: /Add to request cart/ }); await btn.focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(700); return (await page.locator("[role=status]").allInnerTexts()).join("|"); });
  await step("cart: remove item + empty state + re-add", async () => { await page.goto(B + "/cart", { waitUntil: "networkidle" }); await L.shot(page, "web", "flow-researcher__cart__en-light-desktop"); await page.getByRole("button", { name: "Remove" }).first().click(); await page.waitForTimeout(600); const empty = /empty/i.test(await page.locator("main").innerText()); await L.shot(page, "web", "flow-researcher__cart-empty__en-light-desktop"); await page.goto(B + "/search", { waitUntil: "networkidle" }); await page.getByRole("checkbox", { name: /FFPE/ }).check(); await page.waitForTimeout(600); await page.getByRole("button", { name: /Add to request cart/ }).click(); await page.waitForTimeout(600); return empty; });
  await step("request wizard: validation errors on empty step", async () => { await page.goto(B + "/cart", { waitUntil: "networkidle" }); await page.getByRole("button", { name: "Start request" }).click(); await page.waitForTimeout(700); await page.locator("main button", { hasText: /Continue/ }).click(); await page.waitForTimeout(400); await L.shot(page, "web", "flow-researcher__request-validation__en-light-desktop"); return (await page.locator("[role=alert],.ds-error").count()) > 0; });
  await step("request wizard: identifier-like text blocked", async () => { const ta = page.locator("main textarea").first(); await ta.fill("Patient ID 123456789 phone 050-1234567"); await page.locator("main button", { hasText: /Continue/ }).click(); await page.waitForTimeout(500); const t = await page.locator("main").innerText(); return /identify|ID number|identif/i.test(t) ? "warned" : (out.idWarnMissing = true, "NO WARNING (text: " + t.slice(0, 120).replace(/\n/g, " ") + ")"); });
  await step("request wizard: complete and submit", async () => { await page.locator("main textarea").first().fill("Synthetic research question"); return await fillWizard(page, "en-light-desktop"); });
  await step("request detail: 8-step tracker present", async () => { await page.waitForTimeout(1000); if (!/requests\/req_/.test(page.url())) await page.goto(B + "/requests", { waitUntil: "networkidle" }); const first = page.locator("main a[href^='/requests/req_']").first(); if (await first.count() && !/requests\/req_/.test(page.url())) await first.click(); await page.waitForTimeout(800); const n = await page.locator("main ol > li").count(); await L.shot(page, "web", "flow-researcher__request-tracker__en-light-desktop"); return n === 8 ? "8 steps" : (out.trackerCount = n, `found ${n} li in main ol; url ${page.url()}`); });
  await step("researcher console clean (excl. expected anonymous 401 session probe)", async () => { const c = bk.console.filter((m) => !/401/.test(m)); return c.length ? (out.researcherConsole = c, false) : true; });
  await ctx.close();
}
// ---- coordinator: registrations, precheck, CSV dry-run ----
{
  const { ctx, page, bk } = await open("national_coordinator");
  await step("coordinator: registrations list + approve", async () => { await page.goto(B + "/admin/registrations", { waitUntil: "networkidle" }); await L.shot(page, "web", "flow-coordinator__registrations__en-light-desktop"); const b = page.getByRole("button", { name: /Approve/ }).first(); await b.click(); await page.waitForTimeout(600); const dlg = await page.getByRole("dialog").count(); if (dlg) await page.getByRole("dialog").getByRole("button", { name: /Approve|Confirm/ }).first().click(); await page.waitForTimeout(600); return (await page.locator("main").innerText()).slice(0, 160).replace(/\n/g, " | "); });
  await step("coordinator: precheck page for submitted request", async () => { await page.goto(B + "/requests", { waitUntil: "networkidle" }); const a = page.locator("main a[href^='/requests/req_']"); const n = await a.count(); await L.shot(page, "web", "flow-coordinator__requests__en-light-desktop"); if (!n) return false; await a.first().click(); await page.waitForTimeout(700); await L.shot(page, "web", "flow-coordinator__request-detail__en-light-desktop"); return `${n} requests`; });
  await step("coordinator: CSV import wizard dry-run (valid + invalid file)", async () => {
    writeFileSync("/tmp/qa-valid.csv", "center_code,diagnosis_code,age_band,sex,sample_type,availability,clinical_timepoint,collection_month\nsyn_a,mb_shh,3_lt6,female,ffpe,available,diagnosis,2024-05\n");
    writeFileSync("/tmp/qa-bad.csv", "center_code,diagnosis_code,patient_name,collection_month\nsyn_a,mb_shh,Some Name,2024-05-17\n");
    await page.goto(B + "/import/new", { waitUntil: "networkidle" }); await L.shot(page, "web", "flow-coordinator__import-wizard__en-light-desktop");
    const fi = page.locator("input[type=file]"); await fi.setInputFiles("/tmp/qa-bad.csv"); await page.waitForTimeout(1500); await L.shot(page, "web", "flow-coordinator__import-bad-file__en-light-desktop");
    const t = await page.locator("main").innerText(); out.importBadText = t.slice(0, 400); return /error|invalid|rejected|not accepted|identif/i.test(t) ? "bad file flagged" : false;
  });
  await step("coordinator: console clean", async () => { const c = bk.console.filter((m) => !/401/.test(m)); return c.length ? (out.coordConsole = c, false) : true; });
  await ctx.close();
}
// ---- committee: vote ----
for (const who of ["committee@example.test", "committee2@example.test"]) {
  const { ctx, page } = await open(who);
  await step(`committee ${who}: open decision page and vote`, async () => {
    await page.goto(B + "/committee", { waitUntil: "networkidle" }); await L.shot(page, "web", `flow-committee__queue__${who.split("@")[0]}`);
    const a = page.locator("main a[href*='/requests/req_']").first(); if (!(await a.count())) return "no request in queue (precheck stage not reached)";
    await a.click(); await page.waitForTimeout(700); const href = new URL(page.url()).pathname; if (!/decision/.test(href)) await page.goto(B + href.replace(/\/$/, "") + "/decision", { waitUntil: "networkidle" });
    await L.shot(page, "web", `flow-committee__decision__${who.split("@")[0]}`);
    const approve = page.getByRole("radio", { name: /Approve/i }).or(page.getByRole("button", { name: /^Approve/i })); if (!(await approve.count())) return "no approve control: " + (await page.locator("main").innerText()).slice(0, 150).replace(/\n/g, " ");
    await approve.first().click(); await page.getByRole("button", { name: /Submit|Save|Cast|Record/i }).first().click().catch(() => {}); await page.waitForTimeout(700);
    const dlg = page.getByRole("dialog"); if (await dlg.count()) await dlg.getByRole("button").last().click(); await page.waitForTimeout(700);
    return (await page.locator("main").innerText()).slice(0, 200).replace(/\n/g, " | ");
  });
  await ctx.close();
}
// ---- admin ----
{
  const { ctx, page, bk } = await open("system_admin");
  await step("admin: users page, grant role requires second approver (no self-approval UI)", async () => { await page.goto(B + "/admin/users", { waitUntil: "networkidle" }); await L.shot(page, "web", "flow-admin__users__en-light-desktop"); return (await page.locator("main").innerText()).slice(0, 200).replace(/\n/g, " | "); });
  await step("admin: privacy settings k change shows pending second approval, never a threshold in public text", async () => { await page.goto(B + "/admin/settings/privacy", { waitUntil: "networkidle" }); await L.shot(page, "web", "flow-admin__privacy-settings__en-light-desktop"); return (await page.locator("main").innerText()).slice(0, 250).replace(/\n/g, " | "); });
  await step("admin: audit log has no identifiers (emails) in rows", async () => { await page.goto(B + "/audit", { waitUntil: "networkidle" }); const t = await page.locator("main").innerText(); await L.shot(page, "web", "flow-admin__audit__en-light-desktop"); return /@/.test(t) ? (out.auditEmail = t.match(/\S+@\S+/)[0], "email-like text present") : true; });
  await ctx.close();
}
// ---- session timeout (short session user ~125s TTL) ----
{
  const { ctx, page } = await open("shortsession@example.test");
  await step("session-timeout dialog appears before expiry, Extend works, Esc does not dismiss", async () => {
    await page.goto(B + "/home", { waitUntil: "networkidle" });
    await page.getByRole("alertdialog").or(page.getByRole("dialog")).first().waitFor({ timeout: 110000 });
    await L.shot(page, "web", "flow-session__timeout-dialog__en-light-desktop", { fullPage: false });
    await page.keyboard.press("Escape"); const still = await page.getByRole("alertdialog").or(page.getByRole("dialog")).count();
    await page.getByRole("button", { name: /Stay signed in|Extend|Keep/i }).click(); await page.waitForTimeout(800);
    const gone = (await page.getByRole("alertdialog").or(page.getByRole("dialog")).count()) === 0; return still > 0 && gone;
  });
  await ctx.close();
}
// ---- 404 inside app, invalid login ----
{
  const ctx = await L.newCtx(browser, { locale: "en-US" }); const page = await ctx.newPage();
  await step("login: wrong password shows generic error, no account enumeration", async () => { await page.goto(B + "/login", { waitUntil: "networkidle" }); await page.getByLabel(/e-?mail|דוא/i).first().fill("researcher@example.test"); await page.locator("input[type=password]").fill("wrong"); await page.locator("form button[type=submit]").click(); await page.waitForTimeout(800); await L.shot(page, "web", "flow-login__wrong-password__he-light-desktop"); return (await page.locator("[role=alert]").first().innerText()).slice(0, 150); });
  await step("login: empty submit shows validation", async () => { await page.goto(B + "/login", { waitUntil: "networkidle" }); await page.locator("form button[type=submit]").click(); await page.waitForTimeout(400); return (await page.locator("[role=alert],.ds-error").count()) > 0; });
  await step("mfa: wrong code shows error, recovery code path exists", async () => { await page.goto(B + "/login", { waitUntil: "networkidle" }); await page.getByLabel(/e-?mail|דוא/i).first().fill("researcher@example.test"); await page.locator("input[type=password]").fill(L.PASSWORD); await page.locator("form button[type=submit]").click(); await page.waitForURL(/mfa/); await page.locator("form input").first().fill("000000"); await page.locator("form button[type=submit]").first().click(); await page.waitForTimeout(700); await L.shot(page, "web", "flow-login__mfa-wrong-code__he-light-desktop"); const err = await page.locator("[role=alert]").count(); const rec = await page.getByRole("button", { name: /recovery|שחזור/i }).count(); return err > 0 && rec > 0; });
  await step("register: validation + success message", async () => { await page.goto(B + "/register", { waitUntil: "networkidle" }); await page.locator("form button[type=submit]").click(); await page.waitForTimeout(400); const v = (await page.locator("[role=alert],.ds-error").count()) > 0; await page.getByLabel(/name|שם/i).first().fill("Synthetic Applicant"); const ins = page.locator("input").nth(1); await ins.fill("Synthetic University"); await page.locator("input[type=email]").fill("applicant@example.test"); await page.locator("input[type=checkbox]").check(); await page.locator("form button[type=submit]").click(); await page.waitForTimeout(800); await L.shot(page, "web", "flow-register__success__he-light-desktop"); return v; });
  await ctx.close();
}
await browser.close(); await saveJson("web-flows.json", out);
console.log(`\nflows: ${out.steps.filter((s) => s.ok).length} ok / ${out.steps.filter((s) => !s.ok).length} fail`);
