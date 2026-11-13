import { expect, test } from "@playwright/test";
import { axe, login, recordCsp, resetMock, setLocale } from "./helpers";

test.beforeEach(async ({ page }) => { await resetMock(page); await recordCsp(page); });

test("admin: k policy cannot go below the floor; change needs a second approver (en)", async ({ page, browser }) => {
  await setLocale(page, "en");
  await login(page, "admin@example.test", "en");
  await page.goto("/admin/settings/privacy");
  await expect(page.getByTestId("k-default")).toHaveText("5");
  const card = page.locator(".ds-card", { has: page.getByTestId("k-default") });
  await card.getByLabel(/^New value/).fill("3");
  await expect(card.getByText("The value cannot be lower than 5.")).toBeVisible();
  await expect(card.getByRole("button", { name: "Propose change" })).toBeDisabled();
  await card.getByLabel(/^New value/).fill("8");
  await card.getByLabel(/^Reason/).fill("Synthetic review");
  await card.getByRole("button", { name: "Propose change" }).click();
  await expect(page.getByText("Pending change to 8")).toBeVisible();
  // The proposer cannot approve.
  await expect(page.getByRole("button", { name: "Approve change" })).toHaveCount(0);
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await setLocale(p2, "en");
  await login(p2, "admin2@example.test", "en");
  await p2.goto("/admin/settings/privacy");
  await p2.getByRole("button", { name: "Approve change" }).first().click();
  await expect(p2.getByTestId("k-default")).toHaveText("8");
  await axe(page);
  await ctx.close();
});

test("admin: role grant needs second approver; admin has no sample menu (he)", async ({ page, browser }) => {
  await login(page, "admin@example.test");
  await expect(page.getByRole("navigation").getByRole("link", { name: "דגימות" })).toHaveCount(0);
  await page.goto("/search");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("אין הרשאה לפתוח את הדף הזה");
  await page.goto("/admin/users");
  await page.getByRole("row", { name: /Synthetic Researcher/ }).getByRole("button", { name: "בקשת תפקיד" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel(/^תפקידים/).selectOption("committee_member");
  await dlg.getByLabel(/^סיבה/).fill("Synthetic need");
  await dlg.getByRole("button", { name: "בקשת מתן תפקיד" }).click();
  await expect(page.getByText("ממתין למנהל/ת אחר/ת")).toBeVisible();
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await login(p2, "admin2@example.test");
  await p2.goto("/admin/users");
  await p2.getByRole("button", { name: "אישור" }).first().click();
  await expect(p2.getByText("אושר", { exact: true }).first()).toBeVisible();
  await ctx.close();
});

test("admin audit viewer lists events and verifies chain (en)", async ({ page }) => {
  await setLocale(page, "en");
  await login(page, "admin@example.test", "en");
  await page.goto("/audit");
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByRole("button", { name: "Verify integrity" }).click();
  await expect(page.getByRole("status").filter({ hasText: "intact" })).toBeVisible();
  await axe(page);
});

test("coordinator approves a pending registration (en)", async ({ page }) => {
  await setLocale(page, "en");
  await login(page, "coordinator@example.test", "en");
  await page.goto("/admin/registrations");
  await page.getByRole("button", { name: "Approve" }).first().click();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
});
