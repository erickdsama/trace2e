import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Daemon HTTP API tests: auth (login, per-user tokens, legacy token), user management,
 * projects, trace CRUD incl. PUT editing invariants. Run via playwright.daemon.config.ts,
 * which boots the daemon with TRACE2E_TOKEN=test-legacy-token and
 * TRACE2E_ADMIN_PASSWORD=admin-pass-123 in a throwaway TRACE2E_HOME.
 */

const LEGACY = "test-legacy-token";
const ADMIN_PASS = "admin-pass-123";
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(request: APIRequestContext, username: string, password: string) {
  const res = await request.post("/auth/login", { data: { username, password } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { token: string; user: { id: string; username: string; role: string } };
}

function makeTrace(name: string, extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    id: "tmp",
    name,
    createdAt: "",
    startUrl: "https://example.com",
    viewport: { width: 1280, height: 720 },
    variables: [{ name: "PASSWORD", kind: "secret", source: "env" }],
    steps: [
      { id: "s1", type: "navigate", url: "https://example.com", ts: 1 },
      { id: "s2", type: "fill", target: { primary: "getByLabel('Password')", fallbacks: [] }, variableRef: "PASSWORD", ts: 2 },
    ],
    screenshots: {},
    ...extra,
  };
}

test.describe("auth", () => {
  test("rejects missing/bad tokens", async ({ request }) => {
    expect((await request.get("/traces")).status()).toBe(401);
    expect((await request.get("/traces", { headers: auth("nope") })).status()).toBe(401);
  });

  test("legacy token still works and maps to a virtual admin", async ({ request }) => {
    const res = await request.get("/auth/me", { headers: auth(LEGACY) });
    expect(res.ok()).toBeTruthy();
    expect(await res.json()).toEqual({ id: "legacy", username: "legacy", role: "admin" });
  });

  test("bootstrapped admin can log in; password login returns the API token", async ({ request }) => {
    const { token, user } = await login(request, "admin", ADMIN_PASS);
    expect(token).toMatch(/^t2e_[0-9a-f]{48}$/);
    expect(user).toMatchObject({ username: "admin", role: "admin" });
    const me = await request.get("/auth/me", { headers: auth(token) });
    expect((await me.json()).username).toBe("admin");
  });

  test("wrong password → 401", async ({ request }) => {
    const res = await request.post("/auth/login", { data: { username: "admin", password: "wrong-pass" } });
    expect(res.status()).toBe(401);
  });

  test("open registration: anyone can create a user/password and is logged in", async ({ request }) => {
    const res = await request.post("/auth/register", { data: { username: "newcomer", password: "newcomer-pw" } });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.token).toMatch(/^t2e_/);
    expect(body.user).toMatchObject({ username: "newcomer", role: "user" }); // never admin

    // the returned token authenticates immediately, and password login works too
    expect((await request.get("/auth/me", { headers: auth(body.token) })).ok()).toBeTruthy();
    await login(request, "newcomer", "newcomer-pw");
  });

  test("registration rejects duplicates, bad usernames and short passwords", async ({ request }) => {
    expect((await request.post("/auth/register", { data: { username: "admin", password: "whatever-8" } })).status()).toBe(400);
    expect((await request.post("/auth/register", { data: { username: "Bad Name!", password: "whatever-8" } })).status()).toBe(400);
    expect((await request.post("/auth/register", { data: { username: "shortpw", password: "short" } })).status()).toBe(400);
  });
});

test.describe("users (admin)", () => {
  test("create, list (no secrets), non-admin gating, reset token, set password, delete", async ({ request }) => {
    const { token: adminTok } = await login(request, "admin", ADMIN_PASS);

    // create — token returned exactly once
    const created = await request.post("/users", {
      headers: auth(adminTok),
      data: { username: "dev1", password: "dev1-secret", role: "user" },
    });
    expect(created.status()).toBe(201);
    const dev1 = await created.json();
    expect(dev1.token).toMatch(/^t2e_/);

    // list never exposes token/passwordHash
    const list = await (await request.get("/users", { headers: auth(adminTok) })).json();
    const listed = list.find((u: { username: string }) => u.username === "dev1");
    expect(listed).toBeTruthy();
    expect(listed.token).toBeUndefined();
    expect(listed.passwordHash).toBeUndefined();

    // dev1's token authenticates, but /users is admin-gated
    expect((await request.get("/auth/me", { headers: auth(dev1.token) })).ok()).toBeTruthy();
    expect((await request.get("/users", { headers: auth(dev1.token) })).status()).toBe(403);

    // duplicate username rejected
    expect(
      (await request.post("/users", { headers: auth(adminTok), data: { username: "dev1", password: "whatever-8" } })).status(),
    ).toBe(400);

    // reset token: old stops working, new works
    const reset = await (await request.post(`/users/${dev1.id}/reset-token`, { headers: auth(adminTok) })).json();
    expect(reset.token).toMatch(/^t2e_/);
    expect((await request.get("/auth/me", { headers: auth(dev1.token) })).status()).toBe(401);
    expect((await request.get("/auth/me", { headers: auth(reset.token) })).ok()).toBeTruthy();

    // set password: login works with the new one
    await request.put(`/users/${dev1.id}/password`, { headers: auth(adminTok), data: { password: "new-pass-99" } });
    await login(request, "dev1", "new-pass-99");

    // delete
    expect((await request.delete(`/users/${dev1.id}`, { headers: auth(adminTok) })).ok()).toBeTruthy();
    expect((await request.get("/auth/me", { headers: auth(reset.token) })).status()).toBe(401);
  });

  test("last admin cannot be deleted", async ({ request }) => {
    const { token: adminTok, user } = await login(request, "admin", ADMIN_PASS);
    const res = await request.delete(`/users/${user.id}`, { headers: auth(adminTok) });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain("last admin");
  });
});

test.describe("projects", () => {
  test("CRUD with unique names", async ({ request }) => {
    const { token } = await login(request, "admin", ADMIN_PASS);
    const h = auth(token);

    const created = await request.post("/projects", { headers: h, data: { name: "Checkout" } });
    expect(created.status()).toBe(201);
    const project = await created.json();

    // duplicate (case-insensitive) rejected
    expect((await request.post("/projects", { headers: h, data: { name: "checkout" } })).status()).toBe(400);

    const renamed = await (await request.put(`/projects/${project.id}`, { headers: h, data: { name: "Checkout v2" } })).json();
    expect(renamed.name).toBe("Checkout v2");

    const list = await (await request.get("/projects", { headers: h })).json();
    expect(list.some((p: { id: string }) => p.id === project.id)).toBeTruthy();

    expect((await (await request.delete(`/projects/${project.id}`, { headers: h })).json()).deleted).toBe(true);
  });
});

test.describe("per-user scoping", () => {
  async function register(request: APIRequestContext, username: string) {
    const res = await request.post("/auth/register", { data: { username, password: `${username}-pass` } });
    expect(res.status()).toBe(201);
    return (await res.json()) as { token: string; user: { id: string; username: string } };
  }

  test("users only see their own traces and projects; admins see everything", async ({ request }) => {
    const alice = await register(request, "alice");
    const bob = await register(request, "bob");
    const hA = auth(alice.token);
    const hB = auth(bob.token);

    // Both can have a project with the same name — uniqueness is per owner.
    const projA = await (await request.post("/projects", { headers: hA, data: { name: "shared-name" } })).json();
    const projB = await (await request.post("/projects", { headers: hB, data: { name: "shared-name" } })).json();
    expect(projA.id).not.toBe(projB.id);
    // …but a duplicate for the SAME owner is still rejected.
    expect((await request.post("/projects", { headers: hA, data: { name: "Shared-Name" } })).status()).toBe(400);

    // Project lists are scoped.
    const aliceProjects = await (await request.get("/projects", { headers: hA })).json();
    expect(aliceProjects.map((p: { id: string }) => p.id)).toContain(projA.id);
    expect(aliceProjects.map((p: { id: string }) => p.id)).not.toContain(projB.id);

    // Alice can't rename or delete Bob's project.
    expect((await request.put(`/projects/${projB.id}`, { headers: hA, data: { name: "stolen" } })).status()).toBe(400);
    expect((await (await request.delete(`/projects/${projB.id}`, { headers: hA })).json()).deleted).toBe(false);

    // Traces are scoped: Alice's trace is invisible to Bob (list, get, latest, screenshots, edit, delete).
    const traceA = await (
      await request.post("/traces", { headers: hA, data: { trace: makeTrace("alice-flow", { projectId: projA.id }) } })
    ).json();
    const bobList = await (await request.get("/traces", { headers: hB })).json();
    expect(bobList.map((t: { id: string }) => t.id)).not.toContain(traceA.id);
    expect((await request.get(`/traces/${traceA.id}`, { headers: hB })).status()).toBe(404);
    expect((await request.get(`/traces/${traceA.id}/screenshots`, { headers: hB })).status()).toBe(404);
    expect((await request.put(`/traces/${traceA.id}`, { headers: hB, data: makeTrace("hijack") })).status()).toBe(404);
    expect((await request.delete(`/traces/${traceA.id}`, { headers: hB })).status()).toBe(404);

    // "latest" resolves within the caller's own traces.
    const traceB = await (await request.post("/traces", { headers: hB, data: { trace: makeTrace("bob-flow") } })).json();
    expect((await (await request.get("/traces/latest", { headers: hA })).json()).id).toBe(traceA.id);
    expect((await (await request.get("/traces/latest", { headers: hB })).json()).id).toBe(traceB.id);

    // Admin sees both users' traces and projects.
    const { token: adminTok } = await login(request, "admin", ADMIN_PASS);
    const adminList = await (await request.get("/traces", { headers: auth(adminTok) })).json();
    const ids = adminList.map((t: { id: string }) => t.id);
    expect(ids).toContain(traceA.id);
    expect(ids).toContain(traceB.id);
    const adminProjects = await (await request.get("/projects", { headers: auth(adminTok) })).json();
    const pids = adminProjects.map((p: { id: string }) => p.id);
    expect(pids).toContain(projA.id);
    expect(pids).toContain(projB.id);
  });
});

test.describe("traces", () => {
  test("ingest stamps createdBy and keeps projectId; list filters by project", async ({ request }) => {
    const { token } = await login(request, "admin", ADMIN_PASS);
    const h = auth(token);
    const project = await (await request.post("/projects", { headers: h, data: { name: "filter-proj" } })).json();

    const inProj = await (
      await request.post("/traces", { headers: h, data: { trace: makeTrace("in-project", { projectId: project.id }) } })
    ).json();
    const noProj = await (await request.post("/traces", { headers: h, data: { trace: makeTrace("no-project") } })).json();

    const filtered = await (await request.get(`/traces?project=${project.id}`, { headers: h })).json();
    expect(filtered.map((t: { id: string }) => t.id)).toContain(inProj.id);
    expect(filtered.map((t: { id: string }) => t.id)).not.toContain(noProj.id);
    expect(filtered[0].createdBy).toBe("admin");

    const unassigned = await (await request.get("/traces?project=none", { headers: h })).json();
    expect(unassigned.map((t: { id: string }) => t.id)).toContain(noProj.id);
    expect(unassigned.map((t: { id: string }) => t.id)).not.toContain(inProj.id);
  });

  test("PUT edits content but keeps id/createdAt/createdBy; prunes orphaned screenshots", async ({ request }) => {
    const { token } = await login(request, "admin", ADMIN_PASS);
    const h = auth(token);

    const created = await (
      await request.post("/traces", {
        headers: h,
        data: { trace: makeTrace("editable"), screenshots: { s1: `data:image/png;base64,${PNG_1PX}` } },
      })
    ).json();
    const stored = await (await request.get(`/traces/${created.id}`, { headers: h })).json();
    expect(stored.screenshots).toEqual({ s1: "s1.png" });

    // edit: rename, drop step s1, try to tamper with immutable fields
    const edited = {
      ...stored,
      name: "editable-renamed",
      id: "tampered",
      createdAt: "2000-01-01T00:00:00.000Z",
      createdBy: "tampered",
      steps: stored.steps.filter((s: { id: string }) => s.id !== "s1"),
      screenshots: { fake: "fake.png" },
    };
    const res = await request.put(`/traces/${created.id}`, { headers: h, data: edited });
    expect(res.ok()).toBeTruthy();
    const updated = await res.json();
    expect(updated.name).toBe("editable-renamed");
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(stored.createdAt);
    expect(updated.createdBy).toBe("admin");
    expect(updated.screenshots).toEqual({}); // s1 gone → its screenshot pruned
    expect((await (await request.get(`/traces/${created.id}/screenshots`, { headers: h })).json())).toEqual({});
  });

  test("PUT enforces the secret-leak guard (value + variableRef → 422)", async ({ request }) => {
    const { token } = await login(request, "admin", ADMIN_PASS);
    const h = auth(token);
    const created = await (await request.post("/traces", { headers: h, data: { trace: makeTrace("guarded") } })).json();
    const stored = await (await request.get(`/traces/${created.id}`, { headers: h })).json();

    stored.steps[1].value = "leaked-secret";
    const res = await request.put(`/traces/${created.id}`, { headers: h, data: stored });
    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body.details.join(" ")).toContain("both value and variableRef");
  });

  test("PUT to a missing trace → 404", async ({ request }) => {
    const { token } = await login(request, "admin", ADMIN_PASS);
    const res = await request.put("/traces/does-not-exist", { headers: auth(token), data: makeTrace("x") });
    expect(res.status()).toBe(404);
  });
});
