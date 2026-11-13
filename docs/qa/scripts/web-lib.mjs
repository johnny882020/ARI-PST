import { chromium, newCtx, collect, newBucket, installAudit, runAxe, shot } from "./lib.mjs";
export { chromium, newCtx, collect, newBucket, installAudit, runAxe, shot };
export const WEB = process.env.WEB_URL || "http://localhost:3010";
export const PASSWORD = "Synthetic-Passw0rd!", TOTP = "123456";
export const ROLES = {
  researcher_il: "researcher@example.test", researcher_intl: "intl@example.test", center_clinician: "clinician@example.test",
  national_coordinator: "coordinator@example.test", committee_member: "committee@example.test", system_admin: "admin@example.test",
};
export const ROUTES = {
  "/home": "any", "/search": ["researcher_il", "researcher_intl", "center_clinician", "national_coordinator", "committee_member"],
  "/samples": ["center_clinician", "national_coordinator"], "/samples/new": ["national_coordinator"], "/import": ["national_coordinator"], "/import/new": ["national_coordinator"],
  "/freshness": ["center_clinician", "national_coordinator"], "/cart": ["researcher_il"], "/requests": ["researcher_il", "national_coordinator", "committee_member"], "/requests/new": ["researcher_il"],
  "/committee": ["committee_member"], "/admin/registrations": ["national_coordinator"], "/admin/centers": ["national_coordinator", "system_admin"], "/admin/users": ["system_admin"],
  "/admin/settings/privacy": ["system_admin"], "/audit": ["system_admin"], "/account": "any", "/account/security": "any", "/help": "any",
};
export const allowed = (path, role) => ROUTES[path] === "any" || ROUTES[path].includes(role);
export async function reset() { await fetch(WEB + "/api/v1/__reset", { method: "POST", headers: { "x-csrf": "x" } }).catch(() => {}); }
export async function login(page, email, { code = TOTP } = {}) {
  await page.goto(WEB + "/login", { waitUntil: "networkidle" });
  await page.getByLabel(/e-?mail|דוא/i).first().fill(email);
  await page.locator("input[type=password]").fill(PASSWORD);
  await page.locator("form button[type=submit]").click();
  await page.waitForURL(/mfa/, { timeout: 8000 });
  await page.locator("form input").first().fill(code);
  await page.locator("form button[type=submit]").first().click();
  await page.waitForURL((u) => !/login/.test(u.pathname), { timeout: 8000 });
  await page.waitForLoadState("networkidle");
}
export async function setLocaleTheme(page, locale, theme) {
  await page.evaluate(([l, t]) => { try { localStorage.setItem("ari-locale", l); localStorage.setItem("ari-theme", t); } catch {} }, [locale, theme]);
}
export async function pause(page, ms = 400) { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(ms); }
