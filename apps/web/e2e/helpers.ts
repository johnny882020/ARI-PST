import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

export const PASSWORD = "Synthetic-Passw0rd!";
export const TOTP = "123456";

export async function resetMock(page: Page) {
  const r = await page.request.post("/api/v1/__reset");
  expect(r.ok()).toBeTruthy();
}

/** Install a CSP-violation recorder before any page script runs. */
export async function recordCsp(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(e.violatedDirective));
  });
}
export async function expectNoCspViolations(page: Page) {
  const v = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
  expect(v).toEqual([]);
}

export async function setLocale(page: Page, locale: "he" | "en") {
  await page.addInitScript((l) => { try { localStorage.setItem("ui.locale", l); } catch { /* ignore */ } }, locale);
}

const L = {
  he: { email: "דוא״ל", password: "סיסמה", continue: "המשך", code: "קוד בן 6 ספרות", signin: "כניסה" },
  en: { email: "E-mail", password: "Password", continue: "Continue", code: "6-digit code", signin: "Sign in" },
};

export async function login(page: Page, email: string, locale: "he" | "en" = "he") {
  const t = L[locale];
  await page.goto("/login");
  await page.getByLabel(t.email).fill(email);
  await page.getByLabel(t.password).fill(PASSWORD);
  await page.getByRole("button", { name: t.continue }).click();
  await page.getByLabel(t.code).fill(TOTP);
  await page.getByRole("button", { name: t.signin }).click();
  await expect(page.getByRole("navigation").first()).toBeVisible();
}

export async function axe(page: Page) {
  const r = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(summary).toEqual([]);
}
