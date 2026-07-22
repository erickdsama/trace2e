import { test, expect, type Page } from "@playwright/test";

/**
 * Dashboard (browser) tests: login view, project sidebar, trace editing, admin page.
 * Runs against the daemon booted by playwright.daemon.config.ts.
 */

const ADMIN_PASS = "admin-pass-123";

async function loginAsAdmin(page: Page) {
  await page.goto("/");
  await page.locator("#lu").fill("admin");
  await page.locator("#lp").fill(ADMIN_PASS);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator("#side")).toBeVisible();
}

async function apiToken(page: Page): Promise<string> {
  const res = await page.request.post("/auth/login", { data: { username: "admin", password: ADMIN_PASS } });
  return (await res.json()).token;
}

test("unauthenticated visit lands on the login view; bad password shows an error", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#loginForm")).toBeVisible();
  await page.locator("#lu").fill("admin");
  await page.locator("#lp").fill("wrong-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator("#lerr")).toContainText("invalid");
});

test("self-registration from the login page lands in the traces view", async ({ page }) => {
  await page.goto("/");
  await page.locator("#swap").click(); // "No account? Create one"
  await page.locator("#lu").fill("selfserve");
  await page.locator("#lp").fill("selfserve-pw");
  await page.locator("#lp2").fill("selfserve-pw");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator("#side")).toBeVisible();
  await expect(page.locator("#nav")).toContainText("selfserve · user");
});

test("registration with mismatched passwords shows an error", async ({ page }) => {
  await page.goto("/");
  await page.locator("#swap").click();
  await page.locator("#lu").fill("mismatch");
  await page.locator("#lp").fill("password-1");
  await page.locator("#lp2").fill("password-2");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator("#lerr")).toContainText("don't match");
});

test("login → traces view with projects sidebar; create project inline", async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page.locator("#side")).toContainText("All traces");
  await expect(page.locator("#side")).toContainText("Unassigned");

  await page.locator("#npName").fill("dash-proj");
  await page.locator("#npAdd").click();
  await expect(page.locator("#side")).toContainText("dash-proj");
});

test("edit a trace: rename in the structured editor and save", async ({ page }) => {
  // Seed a trace through the API.
  const token = await apiToken(page);
  await page.request.post("/traces", {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      trace: {
        version: 1, id: "tmp", name: "dash-editable", createdAt: "",
        startUrl: "https://example.com", viewport: { width: 1280, height: 720 },
        variables: [], screenshots: {},
        steps: [{ id: "n1", type: "navigate", url: "https://example.com", ts: 1 }],
      },
    },
  });

  await loginAsAdmin(page);
  await page.locator("#list .row", { hasText: "dash-editable" }).first().click();
  await page.locator("#edit").click();

  const nameInput = page.locator('input[data-meta="name"]');
  await expect(nameInput).toHaveValue("dash-editable");
  await nameInput.fill("dash-edited");
  await page.locator("#saveBtn").click();

  await expect(page.locator("#list")).toContainText("dash-edited");
});

test("admin page: create a user and see their one-time token", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("link", { name: "Admin" }).click();
  await expect(page.locator("#userCard")).toContainText("admin");

  await page.locator("#nuName").fill("dashuser");
  await page.locator("#nuPass").fill("dash-pass-1");
  await page.locator("#nuAdd").click();

  await expect(page.locator(".tokenbox")).toContainText("t2e_");
  await expect(page.locator("#userCard")).toContainText("dashuser");
});

test("logout returns to the login view", async ({ page }) => {
  await loginAsAdmin(page);
  await page.locator("#logout").click();
  await expect(page.locator("#loginForm")).toBeVisible();
});
