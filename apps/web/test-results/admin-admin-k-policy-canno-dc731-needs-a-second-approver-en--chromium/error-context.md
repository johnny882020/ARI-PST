# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: admin.spec.ts >> admin: k policy cannot go below the floor; change needs a second approver (en)
- Location: e2e/admin.spec.ts:6:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.fill: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('section').filter({ hasText: 'default' }).first().getByLabel('New value')

```

# Page snapshot

```yaml
- generic [ref=f1e3]:
  - generic [ref=f1e4]:
    - link "Skip to main content" [ref=f1e5] [cursor=pointer]:
      - /url: "#ds-main"
    - banner [ref=f1e6]:
      - link [ref=f1e8] [cursor=pointer]:
        - /url: /
        - strong [ref=f1e9]: ARI-PST
        - text: × Tech4Cancer
      - generic [ref=f1e10]:
        - navigation "Language" [ref=f1e11]:
          - button "עברית" [ref=f1e15] [cursor=pointer]
          - button "English" [pressed] [ref=f1e16] [cursor=pointer]
        - group "Theme" [ref=f1e17]:
          - button "Light" [ref=f1e18] [cursor=pointer]
          - button "Dark" [ref=f1e23] [cursor=pointer]
          - button "System" [pressed] [ref=f1e27] [cursor=pointer]
        - generic [ref=f1e32]:
          - generic [ref=f1e33]: Synthetic Admin
          - button "Sign out" [ref=f1e34] [cursor=pointer]
    - generic [ref=f1e36]:
      - navigation "Main navigation" [ref=f1e38]:
        - list [ref=f1e39]:
          - listitem [ref=f1e40]:
            - link "Home" [ref=f1e41] [cursor=pointer]:
              - /url: /home
          - listitem [ref=f1e43]:
            - link "Centers" [ref=f1e44] [cursor=pointer]:
              - /url: /admin/centers
          - listitem [ref=f1e46]:
            - link "Users" [ref=f1e47] [cursor=pointer]:
              - /url: /admin/users
          - listitem [ref=f1e49]:
            - link "Privacy settings" [ref=f1e50] [cursor=pointer]:
              - /url: /admin/settings/privacy
          - listitem [ref=f1e52]:
            - link "Audit log" [ref=f1e53] [cursor=pointer]:
              - /url: /audit
          - listitem [ref=f1e55]:
            - link "Account" [ref=f1e56] [cursor=pointer]:
              - /url: /account
      - main [ref=f1e58]:
        - generic [ref=f1e59]:
          - generic [ref=f1e61]:
            - heading "Privacy threshold" [active] [level=1] [ref=f1e62]
            - paragraph [ref=f1e63]: How large a group must be before its count is shown.
          - status [ref=f1e64]:
            - generic [ref=f1e67]: Changes need a reason and a second approver.
          - generic [ref=f1e69]:
            - heading "default" [level=2] [ref=f1e70]
            - generic [ref=f1e71]:
              - paragraph [ref=f1e72]:
                - text: "Current value:"
                - strong [ref=f1e73]: "5"
              - generic [ref=f1e74]:
                - generic [ref=f1e75]:
                  - generic [ref=f1e76]:
                    - text: New value
                    - generic [ref=f1e77]: (required)
                  - generic [ref=f1e78]: Whole number, at least 5.
                  - spinbutton "New value (required)" [ref=f1e79]: "5"
                - generic [ref=f1e80]:
                  - generic [ref=f1e81]:
                    - text: Reason
                    - generic [ref=f1e82]: (required)
                  - textbox "Reason (required)" [ref=f1e83]
                - button "Propose change" [disabled] [ref=f1e85]
          - generic [ref=f1e87]:
            - heading "center_breakdown" [level=2] [ref=f1e88]
            - generic [ref=f1e89]:
              - paragraph [ref=f1e90]:
                - text: "Current value:"
                - strong [ref=f1e91]: "7"
              - generic [ref=f1e92]:
                - generic [ref=f1e93]:
                  - generic [ref=f1e94]:
                    - text: New value
                    - generic [ref=f1e95]: (required)
                  - generic [ref=f1e96]: Whole number, at least 5.
                  - spinbutton "New value (required)" [ref=f1e97]: "7"
                - generic [ref=f1e98]:
                  - generic [ref=f1e99]:
                    - text: Reason
                    - generic [ref=f1e100]: (required)
                  - textbox "Reason (required)" [ref=f1e101]
                - button "Propose change" [disabled] [ref=f1e103]
    - contentinfo [ref=f1e105]:
      - paragraph [ref=f1e106]:
        - text: This portal holds no patient identity ·
        - link "Help" [ref=f1e107] [cursor=pointer]:
          - /url: /help
  - region "Notifications"
```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test";
  2  | import { axe, login, recordCsp, resetMock, setLocale } from "./helpers";
  3  | 
  4  | test.beforeEach(async ({ page }) => { await resetMock(page); await recordCsp(page); });
  5  | 
  6  | test("admin: k policy cannot go below the floor; change needs a second approver (en)", async ({ page, browser }) => {
  7  |   await setLocale(page, "en");
  8  |   await login(page, "admin@example.test", "en");
  9  |   await page.goto("/admin/settings/privacy");
  10 |   await expect(page.getByTestId("k-default")).toHaveText("5");
  11 |   const card = page.locator("section", { hasText: "default" }).first();
> 12 |   await card.getByLabel("New value").fill("3");
     |                                      ^ Error: locator.fill: Test timeout of 30000ms exceeded.
  13 |   await expect(card.getByText("The value cannot be lower than 5.")).toBeVisible();
  14 |   await expect(card.getByRole("button", { name: "Propose change" })).toBeDisabled();
  15 |   await card.getByLabel("New value").fill("8");
  16 |   await card.getByLabel("Reason").fill("Synthetic review");
  17 |   await card.getByRole("button", { name: "Propose change" }).click();
  18 |   await expect(page.getByText("Pending change to 8")).toBeVisible();
  19 |   // The proposer cannot approve.
  20 |   await expect(page.getByRole("button", { name: "Approve change" })).toHaveCount(0);
  21 |   const ctx = await browser.newContext();
  22 |   const p2 = await ctx.newPage();
  23 |   await setLocale(p2, "en");
  24 |   await login(p2, "admin2@example.test", "en");
  25 |   await p2.goto("/admin/settings/privacy");
  26 |   await p2.getByRole("button", { name: "Approve change" }).first().click();
  27 |   await expect(p2.getByTestId("k-default")).toHaveText("8");
  28 |   await axe(page);
  29 |   await ctx.close();
  30 | });
  31 | 
  32 | test("admin: role grant needs second approver; admin has no sample menu (he)", async ({ page, browser }) => {
  33 |   await login(page, "admin@example.test");
  34 |   await expect(page.getByRole("navigation").getByRole("link", { name: "דגימות" })).toHaveCount(0);
  35 |   await page.goto("/search");
  36 |   await expect(page.getByRole("heading", { level: 1 })).toHaveText("אין הרשאה לפתוח את הדף הזה");
  37 |   await page.goto("/admin/users");
  38 |   await page.getByRole("row", { name: /Synthetic Researcher/ }).getByRole("button", { name: "בקשת תפקיד" }).click();
  39 |   const dlg = page.getByRole("dialog");
  40 |   await dlg.getByLabel("תפקידים").selectOption("committee_member");
  41 |   await dlg.getByLabel("סיבה").fill("Synthetic need");
  42 |   await dlg.getByRole("button", { name: "בקשת מתן תפקיד" }).click();
  43 |   await expect(page.getByText("ממתין למנהל/ת אחר/ת")).toBeVisible();
  44 |   const ctx = await browser.newContext();
  45 |   const p2 = await ctx.newPage();
  46 |   await login(p2, "admin2@example.test");
  47 |   await p2.goto("/admin/users");
  48 |   await p2.getByRole("button", { name: "אישור" }).first().click();
  49 |   await expect(p2.getByText("אושר", { exact: true }).first()).toBeVisible();
  50 |   await ctx.close();
  51 | });
  52 | 
  53 | test("admin audit viewer lists events and verifies chain (en)", async ({ page }) => {
  54 |   await setLocale(page, "en");
  55 |   await login(page, "admin@example.test", "en");
  56 |   await page.goto("/audit");
  57 |   await expect(page.getByRole("table")).toBeVisible();
  58 |   await page.getByRole("button", { name: "Verify integrity" }).click();
  59 |   await expect(page.getByRole("status").filter({ hasText: "intact" })).toBeVisible();
  60 |   await axe(page);
  61 | });
  62 | 
  63 | test("coordinator approves a pending registration (en)", async ({ page }) => {
  64 |   await setLocale(page, "en");
  65 |   await login(page, "coordinator@example.test", "en");
  66 |   await page.goto("/admin/registrations");
  67 |   await page.getByRole("button", { name: "Approve" }).first().click();
  68 |   await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  69 | });
  70 | 
```