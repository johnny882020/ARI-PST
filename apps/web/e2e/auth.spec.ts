import { expect, test } from "@playwright/test";
import { axe, expectNoCspViolations, login, recordCsp, resetMock, setLocale } from "./helpers";

test.beforeEach(async ({ page }) => { await resetMock(page); await recordCsp(page); });

test("he is the default: RTL login, axe clean, no CSP violations", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "he");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("התחברות");
  await axe(page);
  await expectNoCspViolations(page);
});

test("language switch to English flips to LTR and persists across reload", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("dark theme toggle sets data-theme and stays axe clean", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "כהה" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await axe(page);
});

test("wrong password shows a generic error, no enumeration", async ({ page }) => {
  await setLocale(page, "en");
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("researcher@example.test");
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert").first()).toContainText("The e-mail or password is not right");
});

test("TOTP login (en) lands on role home; wrong code is rejected", async ({ page }) => {
  await setLocale(page, "en");
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("researcher@example.test");
  await page.getByLabel("Password").fill("Synthetic-Passw0rd!");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").first()).toContainText("That code did not work");
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Home");
  await axe(page);
});

test("route guard: researcher gets 403 on /audit; anonymous goes to login", async ({ page }) => {
  await page.goto("/requests");
  await expect(page).toHaveURL(/\/login\?next=%2Frequests/);
  await login(page, "researcher@example.test");
  await page.goto("/audit");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("אין הרשאה לפתוח את הדף הזה");
});

test("only non-sensitive UI prefs in browser storage; cookie is not readable by JS", async ({ page }) => {
  await login(page, "researcher@example.test");
  await page.goto("/search");
  const dump = await page.evaluate(async () => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
    idb: (await indexedDB.databases?.())?.length ?? 0,
    cookie: document.cookie,
  }));
  for (const k of dump.local) expect(["ui.theme", "ui.locale", "ui.density", "ui.sidebarCollapsed", "ari-theme"]).toContain(k);
  expect(dump.session).toEqual([]);
  expect(dump.idb).toBe(0);
  expect(dump.cookie).not.toContain("__Host-sid");
});

test("sign out clears the session and the next page requires login", async ({ page }) => {
  await login(page, "researcher@example.test");
  await page.getByRole("button", { name: "התנתקות" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/search");
  await expect(page).toHaveURL(/\/login\?next=/);
});

test("session timeout warning opens an alert dialog and Stay signed in extends", async ({ page }) => {
  await setLocale(page, "en");
  await login(page, "shortsession@example.test", "en");
  const dlg = page.getByRole("alertdialog");
  await expect(dlg).toBeVisible({ timeout: 15_000 });
  await expect(dlg).toContainText("Your session is about to end");
  await dlg.getByRole("button", { name: "Stay signed in" }).click();
  await expect(dlg).toBeHidden();
});

test("researcher registration (he) shows approval notice", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel(/^שם מלא/).fill("Dr. Synthetic New");
  await page.getByLabel(/^מוסד/).fill("Synthetic University");
  await page.getByLabel(/^דוא״ל מוסדי/).fill("new@example.test");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "שליחת הרשמה" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ההרשמה התקבלה");
});
