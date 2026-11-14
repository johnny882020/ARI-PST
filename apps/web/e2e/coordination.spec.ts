import { expect, test, type Browser } from "@playwright/test";
import { axe, login, resetMock, setLocale } from "./helpers";

// Request life cycle after approval, all in the UI: links -> center answer -> MTA/DTA -> delivery -> closed (delivered). Synthetic data only.
test.beforeEach(async ({ page }) => { await resetMock(page); });

async function as(browser: Browser, email: string) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await setLocale(p, "en");
  await login(p, email, "en");
  return { p, ctx };
}

test("approved request to 'Closed – delivered' through the coordination screen (en)", async ({ page, browser }) => {
  await setLocale(page, "en");
  await login(page, "coordinator@example.test", "en");
  await page.goto("/requests");
  await page.getByRole("row").filter({ hasText: "Approved" }).getByRole("link").click();
  await expect(page).toHaveURL(/\/requests\/req_[0-9A-Z]+$/);
  const reqUrl = new URL(page.url()).pathname;
  await page.getByRole("link", { name: "Open center coordination" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Center coordination");
  await expect(page.getByRole("button", { name: "Start center coordination" })).toBeDisabled();
  // link one FFPE sample of Synthetic Center A
  await page.getByRole("checkbox", { name: /Synthetic Center A/ }).first().check();
  await page.getByRole("button", { name: "Save links" }).click();
  await expect(page.getByText("1 sample linked")).toBeVisible();
  await axe(page);
  await page.getByRole("button", { name: "Start center coordination" }).click();
  await expect(page.getByRole("heading", { name: "Center answers" })).toBeVisible();
  await expect(page.getByText("Waiting for the center")).toBeVisible();

  // the holding clinician opens the request from the list and accepts for the own center
  const clin = await as(browser, "clinician@example.test");
  await clin.p.getByRole("link", { name: "Requests" }).first().click();
  await clin.p.getByRole("row").filter({ hasText: "Center coordination" }).getByRole("link").click();
  await clin.p.getByRole("link", { name: "Open center coordination" }).click();
  await expect(clin.p.getByRole("heading", { name: "Samples of your center in this request" })).toBeVisible();
  await clin.p.getByLabel(/^Note for the applicant/).fill("SYNTHETIC: center accepts");
  await clin.p.getByRole("button", { name: "Accept" }).click();
  await expect(clin.p.getByRole("heading", { name: "Agreements (MTA/DTA)" })).toBeVisible();
  await expect(clin.p.getByRole("button", { name: "Save agreement" })).toHaveCount(0);   // clinicians do not record agreements

  // coordinator records the MTA: first "sent" (delivery stays locked), then "signed" with a month
  await page.reload();
  await expect(page.getByRole("button", { name: "Move to delivery" })).toBeDisabled();
  await page.getByLabel("Agreement status").selectOption("sent");
  await page.getByLabel(/^Agreement reference/).fill("MTA-SYN-001");
  await page.getByRole("button", { name: "Save agreement" }).click();
  await expect(page.getByRole("table", { name: "Agreements (MTA/DTA)" })).toContainText("Sent for signature");
  await expect(page.getByRole("button", { name: "Move to delivery" })).toBeDisabled();
  await page.getByLabel("Agreement status").selectOption("signed");
  await page.getByRole("button", { name: "Save agreement" }).click();
  await expect(page.getByText("Choose the month of signature")).toBeVisible();
  await page.getByLabel(/^Month signed/).fill("2026-01");
  await page.getByRole("button", { name: "Save agreement" }).click();
  await expect(page.getByRole("table", { name: "Agreements (MTA/DTA)" })).toContainText("Signed");
  await page.getByRole("button", { name: "Move to delivery" }).click();
  await expect(page.getByText("Only the holding center confirms delivery.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark delivered" })).toHaveCount(0);
  await axe(page);

  // clinician confirms delivery; the request closes as delivered
  await clin.p.reload();
  await clin.p.getByRole("button", { name: "Mark delivered" }).click();
  await expect(clin.p.getByText("Closed – delivered").first()).toBeVisible();
  await clin.ctx.close();

  // researcher tracker
  const res = await as(browser, "researcher@example.test");
  await res.p.goto(reqUrl);
  await expect(res.p.getByText("Closed – delivered.")).toBeVisible();
  await expect(res.p.locator("ol.ds-stepper > li").last()).toContainText("Closed");
  await res.ctx.close();
});

test("coordinator answer on behalf of a center sends the center (en)", async ({ page }) => {
  await setLocale(page, "en");
  await login(page, "coordinator@example.test", "en");
  await page.goto("/requests");
  await page.getByRole("row").filter({ hasText: "Approved" }).getByRole("link").click();
  await page.getByRole("link", { name: "Open center coordination" }).click();
  await page.getByRole("checkbox", { name: /Synthetic Center B/ }).first().check();
  await page.getByRole("button", { name: "Save links" }).click();
  await expect(page.getByText("1 sample linked")).toBeVisible();
  await page.getByRole("button", { name: "Start center coordination" }).click();
  await expect(page.getByText("You record the answer on behalf of the center.")).toBeVisible();
  await page.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByText("Declined")).toBeVisible();
});

test("clinician: another center's record shows 'Not available'; link-out is labelled (en)", async ({ page }) => {
  await setLocale(page, "en");
  await login(page, "clinician@example.test", "en");
  await page.goto(`/samples/smp_${"3".padStart(26, "0")}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Not available");
  await expect(page).toHaveTitle(/Not available/);
  await page.goto(`/samples/smp_${"1".padStart(26, "0")}`);
  await expect(page.getByRole("heading", { name: "Center's own system" })).toBeVisible();
  await expect(page.getByText(`smp_${"1".padStart(26, "0")}`).first()).toBeVisible();
});
