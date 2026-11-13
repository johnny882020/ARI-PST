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
import { createHmac } from "node:crypto";
export function totp(secretB32, offsetSteps = 0) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = ""; for (const ch of secretB32.replace(/=+$/, "").toUpperCase()) bits += A.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const step = Math.floor(Date.now() / 30000) + offsetSteps; const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", key).update(buf).digest(); const o = h[19] & 15;
  return String(((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6).padStart(6, "0");
}
export async function loginReal(page, user, base) {
  await page.goto(base + "/login", { waitUntil: "networkidle" });
  await page.getByLabel(/e-?mail|דוא/i).first().fill(user.email);
  await page.locator("input[type=password]").fill(user.password);
  await page.locator("form button[type=submit]").click();
  await page.waitForURL(/mfa/, { timeout: 10000 });
  await page.locator("form input").first().fill(totp(user.totpSecret));
  await page.locator("form button[type=submit]").first().click();
  await page.waitForURL((u) => !/login/.test(u.pathname), { timeout: 10000 });
  await page.waitForLoadState("networkidle");
}
