import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";

const accounts = [
  { role: "admin", heading: /Administrator overview/, navigation: "Inventory" },
  { role: "manager", heading: /Good (morning|afternoon|evening), Marcus/, navigation: "Products" },
  { role: "staff", heading: /My tasks/, navigation: "Stock lookup" },
] as const;
type Role = typeof accounts[number]["role"];
const savedCookies: Partial<Record<Role, Awaited<ReturnType<BrowserContext["cookies"]>>>> = {};

test.beforeAll(async ({ playwright, baseURL }) => {
  const sessionFile = path.resolve(`work/browser-data/${process.env.STOCKSENSE_BROWSER_RUN}-sessions.json`);
  // Worker restarts after a failed assertion must not burn another three logins
  // against the application's real authentication rate limiter.
  if (fs.existsSync(sessionFile)) { Object.assign(savedCookies, JSON.parse(fs.readFileSync(sessionFile, "utf8"))); return; }
  const request = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL! } });
  try {
    for (const account of accounts) {
      const login = await request.post("/api/auth/login", { data: { email: `${account.role}@stocksense.demo`, password: "Demo2026!" } });
      expect(login.status()).toBe(200);
      savedCookies[account.role] = (await request.storageState()).cookies;
    }
    fs.writeFileSync(sessionFile, JSON.stringify(savedCookies), { mode: 0o600 });
  } finally { await request.dispose(); }
});

async function enterWorkspace(page: Page, role: Role) {
  await page.context().addCookies(savedCookies[role]!);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(accounts.find((a) => a.role === role)!.heading);
}

for (const account of accounts) {
  for (const device of ["desktop", "mobile"] as const) {
    test(`${account.role} ${device}: real sign-in, scoped workspace, responsive layout and accessibility`, async ({ page }, testInfo) => {
      if (device === "mobile") await page.setViewportSize({ width: 390, height: 844 });
      const runtimeErrors: string[] = [];
      page.on("pageerror", (error) => runtimeErrors.push(error.message));
      await page.goto("/");
      await expect(page.getByRole("button", { name: "Admin Full access" })).toBeVisible();
      await page.getByLabel("Email address").fill(`${account.role}@stocksense.demo`);
      await page.getByLabel("Password", { exact: true }).fill("Demo2026!");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(account.heading);
      if (account.role === "staff") await expect(page.locator(".staff-task-card").first()).toBeVisible();
      await expect(page.locator(".brand-mark").first()).toHaveJSProperty("naturalWidth", 64);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${account.role}-${device}.png`), fullPage: true });
      const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      await testInfo.attach("accessibility", { body: JSON.stringify(accessibility.violations, null, 2), contentType: "application/json" });
      expect(accessibility.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })) }))).toEqual([]);
      if (device === "mobile") await page.getByRole("button", { name: "Open navigation" }).click();
      await page.locator(".sidebar").getByRole("button", { name: new RegExp(`^${account.navigation}(?: \\d+)?$`) }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Inventory/);
      if (account.role === "staff") await expect(page.getByRole("button", { name: "Add product", exact: true })).toHaveCount(0);
      expect(runtimeErrors).toEqual([]);
    });
  }
}

test("alerts and role help open accessible dialogs with working keyboard focus", async ({ page }) => {
  await enterWorkspace(page, "manager");
  const alerts = page.getByRole("button", { name: "View stock alerts and pending work" });
  await alerts.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  for (let i = 0; i < 14; i++) { await page.keyboard.press("Tab"); expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true); }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(alerts).toBeFocused();
  await page.getByRole("button", { name: /Need a hand/ }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/manager/i);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("session expiry clears the workspace and allows a new sign-in", async ({ page }) => {
  await enterWorkspace(page, "staff");
  await page.context().clearCookies();
  await page.getByRole("button", { name: "Refresh workspace" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to your workspace" })).toBeVisible();
  await expect(page.locator(".sidebar")).toHaveCount(0);
});

test("failed workspace requests offer a retry that reconnects the screen", async ({ page }) => {
  await page.context().addCookies(savedCookies.manager!);
  await page.route("**/api/inventory", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary connection problem" }) }));
  await page.goto("/");
  await expect(page.getByText("Temporary connection problem", { exact: false })).toBeVisible();
  await page.unroute("**/api/inventory");
  await page.getByRole("button", { name: /Try again|Retry/i }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Good (morning|afternoon|evening), Marcus/);
});

test("product adjustment keeps its product, warehouse and count through saved draft details", async ({ page }) => {
  await enterWorkspace(page, "manager");
  const inventory = await (await page.request.get("/api/inventory")).json();
  const steel = inventory.items.find((item: any) => item.sku === "RM-2048");
  const location = steel.locations.find((item: any) => item.code === "MWH");
  await page.locator(".sidebar").getByRole("button", { name: /^Products(?: \d+)?$/ }).click();
  await page.getByRole("button", { name: `Open ${steel.name}`, exact: true }).click();
  await page.getByLabel("Location to count").selectOption(location.id);
  await page.getByRole("button", { name: "Adjust count", exact: true }).click();
  const draft = page.getByRole("dialog", { name: "Create an operation", exact: true });
  await expect(draft.getByRole("button", { name: "Adjustment", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(draft.getByRole("combobox", { name: "Product", exact: true })).toHaveValue(steel.id);
  await expect(draft.getByLabel("Location to count")).toHaveValue(location.id);
  await expect(draft.getByLabel(/Counted stock/)).toHaveValue(String(location.quantity));
  await draft.getByLabel("Reason for count correction").fill("Scheduled warehouse count");
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/operations") && r.request().method() === "POST"),
    draft.getByRole("button", { name: "Create draft", exact: true }).click(),
  ]);
  expect(response.status()).toBe(201);
  const result = await response.json();
  expect(result.operation.type).toBe("adjustment");
  expect(result.operation.source_location_id).toBe(location.id);
  expect(result.operation.lines[0].product_id).toBe(steel.id);
  expect(result.operation.lines[0].planned_qty).toBe(location.quantity);
  await expect(page.getByRole("dialog", { name: "Operation details", exact: true })).toContainText(result.operation.reference);
  const after = await (await page.request.get("/api/inventory")).json();
  expect(after.items.find((item: any) => item.id === steel.id).total).toBe(steel.total);
});

test("replenishment opens a receipt draft for the selected stock item", async ({ page }) => {
  await enterWorkspace(page, "manager");
  const inventory = await (await page.request.get("/api/inventory")).json();
  const steel = inventory.items.find((item: any) => item.sku === "RM-2048");
  await page.locator(".sidebar").getByRole("button", { name: "Replenishment", exact: true }).click();
  await page.getByRole("row").filter({ hasText: steel.sku }).getByRole("button", { name: "Draft receipt", exact: true }).click();
  const draft = page.getByRole("dialog", { name: "Create an operation", exact: true });
  await expect(draft.getByRole("button", { name: "Receipt", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(draft.getByRole("combobox", { name: "Product", exact: true })).toHaveValue(steel.id);
  expect(Number(await draft.getByLabel(/Quantity/).inputValue())).toBeGreaterThan(0);
});

test("sign-in screen is accessible at desktop and mobile widths", async ({ page }, testInfo) => {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Sign in to your workspace" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Admin Full access" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    await testInfo.attach(`login-accessibility-${viewport.width}`, { body: JSON.stringify(result.violations, null, 2), contentType: "application/json" });
    expect(result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })) }))).toEqual([]);
  }
});

test("default development proxy accepts localhost and rejects unrelated origins", async ({ page, baseURL }) => {
  // Other role tests use 127.0.0.1. Exercise the documented localhost URL too,
  // without APP_ORIGIN and at a non-default Vite port.
  const localURL = new URL(baseURL!);
  localURL.hostname = "localhost";
  await page.goto(localURL.href);
  await expect(page.getByRole("button", { name: "Admin Full access" })).toBeVisible();
  await page.getByLabel("Email address").fill("admin@stocksense.demo");
  await page.getByLabel("Password", { exact: true }).fill("Demo2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Administrator overview");

  const rejectedHeaders: Array<Record<string, string>> = [
    { Origin: "https://unrelated.example.test" },
    { Origin: localURL.origin, "Sec-Fetch-Site": "cross-site" },
  ];
  for (const headers of rejectedHeaders) {
    const denied = await page.request.post(new URL("/api/auth/logout", localURL).href, { headers });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).code).toBe("csrf_origin");
  }
  // Denied cross-origin logout must not destroy the valid local session.
  const me = await page.request.get(new URL("/api/auth/me", localURL).href);
  expect(me.status()).toBe(200);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in to your workspace" })).toBeVisible();
});
