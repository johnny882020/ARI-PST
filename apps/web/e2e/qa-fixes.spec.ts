import { expect, test, type Page } from "@playwright/test";
import { axe, expectNoCspViolations, login, recordCsp, resetMock, setLocale, TOTP } from "./helpers";

// Regression tests for the QA-1 bug list (docs/qa/BUGS.md). Synthetic data only.
const VERIFY_TOKEN = "synthetic-verify-token-0001"; // mock-server/data.mjs
const NEW_PASSWORD = "a-long-synthetic-phrase";

test.beforeEach(async ({ page }) => { await resetMock(page); await recordCsp(page); });

const noSidewaysScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

/** Every visible control is at least `min` px in both directions (label box for checkboxes and radios). */
async function smallTargets(page: Page, min: number): Promise<string[]> {
  return page.evaluate((m) => {
    const out: string[] = [];
    document.querySelectorAll<HTMLElement>("a[href],button,input:not([type=hidden]),select,textarea,summary").forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return;
      let r = el.getBoundingClientRect();
      if (el instanceof HTMLInputElement && ["checkbox", "radio"].includes(el.type)) r = el.closest("label")?.getBoundingClientRect() ?? r;
      if (!r.width || !r.height) return;
      if (el.tagName === "A" && cs.display === "inline") return; // links inside a sentence (WCAG 2.5.8 inline exception)
      if (r.width < m || r.height < m) out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    });
    return out;
  }, min);
}

test("QA-003: e-mail link sets the first password, first sign-in forces two-step set-up, then the portal opens (en)", async ({ page }) => {
  await setLocale(page, "en");

  // Before activation the account cannot sign in.
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("newuser@example.test");
  await page.getByLabel("Password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert").first()).toContainText("The e-mail or password is not right");

  // The link from the e-mail. The token leaves the address bar at once.
  await page.goto(`/verify-email?token=${VERIFY_TOKEN}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Verify your e-mail and set a password");
  await expect(page).toHaveURL(/\/verify-email$/);
  await axe(page);
  await page.getByLabel("New password").fill("short");
  await page.getByLabel("Repeat the password").fill("short");
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page.locator("#field-password")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("New password").fill(NEW_PASSWORD);
  await page.getByLabel("Repeat the password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your e-mail is verified and your password is set");
  await axe(page);
  expect(await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage))).not.toContain(VERIFY_TOKEN);

  // First sign-in: no code is asked (there is no factor yet); the only open screen is the set-up screen.
  await page.getByRole("link", { name: "Go to sign in" }).click();
  await page.getByLabel("E-mail").fill("newuser@example.test");
  await page.getByLabel("Password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/setup-mfa$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Set up two-step verification");
  await axe(page);
  await page.goto("/search");
  await expect(page).toHaveURL(/\/setup-mfa$/);

  // Authenticator app: secret shown, code confirmed, recovery codes shown once.
  await page.getByRole("button", { name: "Set up an authenticator app" }).click();
  await expect(page.getByTestId("totp-secret")).toBeVisible();
  await page.getByLabel("6-digit code").fill(TOTP);
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByTestId("recovery-codes").locator("li")).toHaveCount(10);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/search");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Search the index");
  await expectNoCspViolations(page);
});

test("QA-003: a used or broken link explains what to do (he); /auth/verify-email is the same screen", async ({ page }) => {
  await page.goto("/verify-email");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("לא ניתן להשתמש בקישור הזה");
  await axe(page);
  await page.goto("/auth/verify-email?token=this-token-does-not-exist-0000");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("אימות הדוא״ל וקביעת סיסמה");
  await page.locator("#field-password").fill(NEW_PASSWORD);
  await page.locator("#field-confirm").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "קביעת סיסמה" }).click();
  await expect(page.getByRole("alert").first()).toContainText("הקישור אינו תקף עוד");
});

for (const locale of ["he", "en"] as const) {
  test(`QA-009: request wizard refuses identifier-like text and sends nothing (${locale})`, async ({ page }) => {
    await setLocale(page, locale);
    const en = locale === "en";
    await login(page, "researcher@example.test", locale);
    await page.goto("/search?type=ffpe");
    await page.getByRole("button", { name: en ? "Add to request cart" : "הוספה לסל הבקשה" }).click();
    await page.goto("/cart");
    await page.getByRole("button", { name: en ? "Start request" : "התחלת בקשה" }).click();
    await expect(page).toHaveURL(/\/requests\/new\?draft=req_/);
    const patches: string[] = [];
    page.on("request", (r) => { if (r.method() === "PATCH") patches.push(r.postData() ?? ""); });
    const field = page.locator("#field-researchQuestion");
    const next = page.getByRole("button", { name: en ? "Continue" : "המשך" });
    const cases: [string, string][] = [
      ["Patient ID 123456789 phone 050-1234567", en ? "looks like an ID number" : "נראה כמו מספר זהות"],
      ["Please call the family at 050-1234567", en ? "looks like a phone number" : "נראה כמו מספר טלפון"],
      ["Contact the parent at parent@example.test", en ? "looks like an e-mail address" : "נראה כמו כתובת דוא״ל"],
      ["Child was diagnosed on 03/04/2015 at the center", en ? "has an exact date" : "יש תאריך מדויק"],
      ["Hospital record number 12345678 for this case", en ? "has a long number" : "יש מספר ארוך"],
    ];
    for (const [text, message] of cases) {
      await field.fill(text);
      await next.click();
      await expect(page.locator("#field-researchQuestion")).toHaveAttribute("aria-invalid", "true");
      await expect(page.locator(".ds-error").first()).toContainText(message);
      await expect(page.locator("#field-applicantEthicsRef")).toHaveCount(0); // still on step 1
    }
    await page.getByRole("button", { name: en ? "Save draft" : "שמירת טיוטה" }).click();
    await page.waitForTimeout(300);
    expect(patches).toEqual([]); // nothing identifying left the browser, not even as a draft
    await axe(page);
    await field.fill("Outcomes of low-grade glioma across centers, 2015 to 2020, about 120 samples");
    await next.click();
    await expect(page.locator("#field-applicantEthicsRef")).toBeVisible();
  });
}

test.describe("390 px viewport", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("QA-004/005/007: header fits, controls sit behind the menu, /search does not scroll sideways, targets are 44 px (coordinator, en)", async ({ page }) => {
    await setLocale(page, "en");
    await page.goto("/login");
    await page.getByLabel("E-mail").fill("coordinator@example.test");
    await page.getByLabel("Password").fill("Synthetic-Passw0rd!");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("6-digit code").fill(TOTP);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page.goto("/search");
    await expect(page.getByRole("region", { name: "Records (de-identified)" })).toBeVisible();
    await expect(page.locator(".ds-table a").first()).toBeVisible();
    await noSidewaysScroll(page);
    expect(await smallTargets(page, 44)).toEqual([]);
    await axe(page);

    // Header: one bar. Language, theme and sign-out open with the menu and do not overlap.
    const header = page.locator(".ds-shell-header");
    expect((await header.boundingBox())!.height).toBeLessThanOrEqual(72);
    await expect(page.getByRole("button", { name: "Sign out" })).toBeHidden();
    await page.locator(".ds-shell-menu").click();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByRole("button", { name: "English" })).toBeVisible();
    await noSidewaysScroll(page);
    expect(await smallTargets(page, 44)).toEqual([]);
    const boxes = await page.locator(".ds-shell-actions > *").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ l: r.left, r: r.right, t: r.top, b: r.bottom })));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!, b = boxes[j]!;
      expect(a.r <= b.l + 1 || b.r <= a.l + 1 || a.b <= b.t + 1 || b.b <= a.t + 1, `header items ${i} and ${j} overlap`).toBe(true);
    }
    await axe(page);
  });

  test("QA-004/007: researcher keeps the cart in the bar; pages fit and targets are 44 px (he)", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("דוא״ל").fill("researcher@example.test");
    await page.getByLabel("סיסמה").fill("Synthetic-Passw0rd!");
    await page.getByRole("button", { name: "המשך" }).click();
    await page.getByLabel("קוד בן 6 ספרות").fill(TOTP);
    await page.getByRole("button", { name: "כניסה" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    for (const path of ["/home", "/search", "/requests", "/account", "/help"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator(".ds-shell-pinned a")).toBeVisible();
      await noSidewaysScroll(page);
      expect(await smallTargets(page, 44), path).toEqual([]);
    }
  });
});

test("QA-008/011: heading levels do not skip and landmarks are unique on search, account, help, sample entry", async ({ page }) => {
  await setLocale(page, "en");
  await login(page, "coordinator@example.test", "en");
  for (const path of ["/search", "/account", "/help", "/samples/new"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    const levels = await page.locator("h1,h2,h3,h4,h5,h6").evaluateAll((hs) => hs.filter((h) => (h as HTMLElement).offsetParent !== null).map((h) => Number(h.tagName[1])));
    expect(levels.filter((l) => l === 1), path).toHaveLength(1);
    levels.forEach((l, i) => expect(i === 0 || l - levels[i - 1]! <= 1, `${path}: h${levels[i - 1]} then h${l}`).toBe(true));
    const navNames = await page.getByRole("navigation").evaluateAll((ns) => ns.map((n) => n.getAttribute("aria-label") ?? ""));
    expect(new Set(navNames).size, path).toBe(navNames.length);
    expect(await smallTargets(page, 24), path).toEqual([]);
  }
});
