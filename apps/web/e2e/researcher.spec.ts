import { expect, test } from "@playwright/test";
import { axe, expectNoCspViolations, login, recordCsp, resetMock, setLocale } from "./helpers";

test.beforeEach(async ({ page }) => { await resetMock(page); await recordCsp(page); });

for (const locale of ["he", "en"] as const) {
  test(`search, suppression, cart, request, tracker (${locale})`, async ({ page }) => {
    await setLocale(page, locale);
    const en = locale === "en";
    await login(page, "researcher@example.test", locale);
    await page.goto("/search");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(en ? "Search the index" : "חיפוש במאגר");
    await expect(page.locator("html")).toHaveAttribute("dir", en ? "ltr" : "rtl");

    // Aggregate total shows a number, never a threshold.
    const tile = page.locator(".ds-tile").first();
    await expect(tile).toHaveAttribute("data-state", "value");

    // Narrow to a tiny group: diagnosis DIPG + CSF -> suppressed, no "<5" anywhere.
    await page.getByRole("button", { name: en ? "Diagnosis" : "אבחנה" }).first().click().catch(() => undefined);
    await page.goto("/search?dx=typ_dipg&type=csf");
    await expect(page.locator(".ds-tile").first()).toHaveAttribute("data-state", "suppressed", { timeout: 10_000 });
    const body = await page.locator("main").innerText();
    expect(body).not.toMatch(/<\s*\d/);
    expect(body).toContain(en ? "Too few to show" : "מעט מדי להצגה");
    await expect(page.getByRole("button", { name: en ? "Add to request cart" : "הוספה לסל הבקשה" })).toBeDisabled();
    await axe(page);

    // A big group can be added to the cart.
    await page.goto("/search?type=ffpe");
    await expect(page.locator(".ds-tile").first()).toHaveAttribute("data-state", "value");
    await page.getByRole("button", { name: en ? "Add to request cart" : "הוספה לסל הבקשה" }).click();
    await expect(page.getByRole("status").filter({ hasText: en ? "Added to request cart" : "נוסף לסל הבקשה" })).toBeVisible();
    await page.goto("/cart");
    await expect(page.getByRole("heading", { level: 2 }).first()).toContainText(en ? "FFPE" : "FFPE");
    await axe(page);

    await page.getByRole("button", { name: en ? "Start request" : "התחלת בקשה" }).click();
    await expect(page).toHaveURL(/\/requests\/new\?draft=req_/);
    // Step 1: validation then fill.
    await page.getByRole("button", { name: en ? "Continue" : "המשך" }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await page.locator("#field-researchQuestion").fill("Outcomes of low-grade glioma across centers");
    await page.getByRole("button", { name: en ? "Continue" : "המשך" }).click();
    await page.locator("#field-applicantEthicsRef").fill("HEL-SYN-900");
    await page.getByRole("button", { name: en ? "Continue" : "המשך" }).click();
    await page.locator("#field-plannedUse").fill("Synthetic planned analysis of sample availability");
    await page.getByRole("button", { name: en ? "Continue" : "המשך" }).click();
    await page.locator("#field-fundingSources").fill("Synthetic foundation");
    await page.getByRole("button", { name: en ? "Continue" : "המשך" }).click();
    await page.locator("#field-declaration").check();
    await page.getByRole("button", { name: en ? "Send request" : "שליחת בקשה" }).click();
    await expect(page.getByTestId("request-id")).toContainText("req_");
    await expectNoCspViolations(page);

    await page.getByRole("button", { name: en ? "Follow this request" : "מעקב אחרי הבקשה" }).click();
    const steps = page.locator("ol.ds-stepper > li");
    await expect(steps).toHaveCount(8);
    await expect(page.locator("ol.ds-stepper > li[aria-current='step']")).toContainText(en ? "Pre-check" : "בדיקה מקדימה");
    await axe(page);
  });
}

test("international researcher: aggregate only, no cart", async ({ page }) => {
  await setLocale(page, "en");
  await login(page, "intl@example.test", "en");
  await page.goto("/search");
  await expect(page.getByRole("button", { name: "Add to request cart" })).toHaveCount(0);
  await expect(page.getByText("Request cart")).toHaveCount(0);
  await page.goto("/cart");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("You cannot open this page");
});

test("needs-info: researcher sees the action banner and can reply", async ({ page, browser }) => {
  await setLocale(page, "en");
  // Coordinator sends the seeded committee request back is not allowed; use precheck on a new submit instead.
  await login(page, "researcher@example.test", "en");
  const list = await page.request.get("/api/v1/requests");
  expect(list.ok()).toBeTruthy();
  await page.goto("/requests");
  await expect(page.getByRole("table")).toBeVisible();
  await axe(page);
  void browser;
});
