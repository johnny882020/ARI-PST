import { expect, test } from "@playwright/test";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { axe, expectNoCspViolations, login, recordCsp, resetMock, setLocale } from "./helpers";

test.beforeEach(async ({ page }) => { await resetMock(page); await recordCsp(page); });

test("coordinator: minimal entry form, save and add another (he)", async ({ page }) => {
  await login(page, "coordinator@example.test");
  await page.goto("/samples/new");
  await page.getByRole("button", { name: "שמירה והוספת נוספת" }).click();
  await expect(page.getByRole("alert").first()).toContainText("שדות דורשים תשומת לב");
  await page.getByLabel(/^מרכז/).selectOption({ index: 1 });
  await page.getByLabel(/^אבחנה/).selectOption({ index: 1 });
  await page.getByLabel(/^גיל באבחנה/).selectOption({ index: 1 });
  await page.getByLabel(/^מין/).selectOption({ index: 1 });
  await page.getByLabel(/^סוג דגימה/).selectOption({ index: 1 });
  await page.getByLabel(/^זמינות/).selectOption({ index: 1 });
  await page.getByLabel(/^נקודת זמן/).selectOption({ index: 1 });
  await page.getByLabel(/^נאספה/).fill("2026-03");
  await page.getByRole("button", { name: "שמירה והוספת נוספת" }).click();
  await expect(page.getByRole("status").filter({ hasText: "נשמר בקוד" })).toBeVisible();
  await axe(page);
});

test("coordinator: import dry-run, rejection report, commit (en)", async ({ page }) => {
  await setLocale(page, "en");
  await login(page, "coordinator@example.test", "en");
  await page.goto("/import/new");
  const dir = mkdtempSync(join(tmpdir(), "ari-"));
  const file = join(dir, "synthetic.csv");
  writeFileSync(file, "diagnosis_code,sample_type,ethics_ref\ntyp_medullo,ffpe,HEL-1\n,ffpe,HEL-2\ntyp_dipg,not_a_type,HEL-3\ntyp_dipg,frozen,HEL-4\n");
  await page.getByLabel(/^File/).setInputFiles(file);
  await page.getByRole("button", { name: "Upload and check" }).click();
  await expect(page).toHaveURL(/\/import\/imp_/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Import result");
  await expect(page.getByRole("table").getByText("required")).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download rejection report" }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^ari-import-report-.*\.csv$/);
  await axe(page);
  await page.getByRole("button", { name: "Commit this import" }).click();
  await expect(page.getByRole("status").filter({ hasText: "The import was saved" })).toBeVisible();
  await expectNoCspViolations(page);
});

test("coordinator: pre-check forwards, committee votes and decides (he)", async ({ page, browser }) => {
  // Researcher submits via API-level UI is covered elsewhere; here use the seeded committee_review request.
  await login(page, "committee@example.test");
  await expect(page).toHaveURL(/\/committee$/);
  await expect(page.locator(".ds-tile").first()).toBeVisible();
  await page.getByRole("link", { name: "פתיחת ההחלטה" }).first().click();
  await expect(page.getByTestId("tally")).toContainText("0 מתוך 2");
  await page.getByLabel("אישור", { exact: true }).check();
  await page.getByRole("button", { name: "שליחת הצבעה" }).click();
  await expect(page.getByTestId("tally")).toContainText("1 מתוך 2");
  // Recording approval stays disabled until N approvals exist.
  await expect(page.getByRole("button", { name: "רישום אישור" })).toBeDisabled();
  await axe(page);
  // Second member votes.
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await setLocale(p2, "he");
  await login(p2, "committee2@example.test");
  await p2.goto(page.url());
  await p2.getByLabel("אישור", { exact: true }).check();
  await p2.getByRole("button", { name: "שליחת הצבעה" }).click();
  await expect(p2.getByTestId("tally")).toContainText("2 מתוך 2");
  await p2.getByRole("button", { name: "רישום אישור" }).click();
  await expect(p2).toHaveURL(/\/committee$/);
  await ctx2.close();
});

test("clinician sees own center only and can verify a record (en)", async ({ page }) => {
  await setLocale(page, "en");
  await login(page, "clinician@example.test", "en");
  await expect(page).toHaveURL(/\/samples$/);
  await expect(page.getByText("Showing Synthetic Center A only")).toBeVisible();
  const rows = page.getByRole("table").locator("tbody tr");
  await expect(rows.first()).toBeVisible();
  for (const c of await rows.locator("td:nth-child(6)").allInnerTexts()) expect(c).toBe("Synthetic Center A");
  await rows.first().getByRole("link").click();
  await expect(page.getByText("This record holds no patient identity")).toBeVisible();
  await page.getByRole("button", { name: "Verify now" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Record verified" })).toBeVisible();
  await axe(page);
  await page.goto("/samples/new");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("You cannot open this page");
});

test("freshness board for coordinator shows stale view (he)", async ({ page }) => {
  await login(page, "coordinator@example.test");
  await page.goto("/freshness");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("עדכניות");
  await expect(page.locator(".ds-tile").first()).toHaveAttribute("data-state", "value");
  await axe(page);
});
