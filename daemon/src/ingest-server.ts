import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { validateTrace, asTrace } from "@trace2e/schema";
import { DASHBOARD_HTML } from "./embedded.js";
import { ALLOWED_ORIGIN, INGEST_HOST, INGEST_PORT, IS_REMOTE } from "./config.js";
import {
  deleteTrace,
  getLatestTrace,
  getOrCreateToken,
  getScreenshotData,
  getTrace,
  listTraces,
  saveTrace,
  updateTrace,
} from "./store.js";
import {
  authenticate,
  bootstrapAdmin,
  createUser,
  deleteUser,
  listUsersPublic,
  resetToken,
  setPassword,
  verifyLogin,
  type Role,
} from "./users.js";
import { createProject, deleteProject, listProjects, renameProject } from "./projects.js";

/**
 * HTTP API for trace2e.
 *
 * Auth:
 *   POST   /auth/login             { username, password } → { token, user }  (no auth)
 *   GET    /auth/me                → { id, username, role }
 * Traces:
 *   POST   /traces                 { trace, screenshots? }   (stamps createdBy)
 *   GET    /traces[?project=id|none] → summaries
 *   GET    /traces/:id|latest      → full trace
 *   PUT    /traces/:id             edited trace (id/createdAt/createdBy immutable)
 *   GET    /traces/:id/screenshots → { stepId: base64 }
 *   DELETE /traces/:id
 * Projects:
 *   GET/POST /projects             list / create { name }
 *   PUT/DELETE /projects/:id       rename { name } / delete
 * Users (admin only):
 *   GET/POST /users                list / create { username, password, role? } → incl. token (shown once)
 *   DELETE /users/:id              (last-admin guard)
 *   POST   /users/:id/reset-token  → { token }
 *   PUT    /users/:id/password     { password }
 *   GET    /health                 (no auth)
 *
 * All other routes require `Authorization: Bearer <token>` — a per-user token from
 * users.json, or the legacy single token (maps to a virtual admin). Locally the server
 * binds 127.0.0.1 and additionally rejects non-loopback callers; in a hosted deploy
 * (TRACE2E_HOST=0.0.0.0) that check is relaxed and the token + TLS (at the proxy) protect it.
 */

const MAX_BODY = 25 * 1024 * 1024;

function isLoopback(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

function applyCors(res: ServerResponse, origin: string | undefined): void {
  const allow = ALLOWED_ORIGIN ?? (origin && origin.startsWith("chrome-extension://") ? origin : "");
  if (allow && (!ALLOWED_ORIGIN || allow === ALLOWED_ORIGIN)) {
    res.setHeader("Access-Control-Allow-Origin", allow);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export async function startIngestServer(): Promise<void> {
  const token = await getOrCreateToken();
  await bootstrapAdmin();

  const server = createServer(async (req, res) => {
    applyCors(res, req.headers.origin);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;

    if (req.method === "GET" && path === "/health") {
      send(res, 200, { ok: true, service: "trace2e-daemon", remote: IS_REMOTE });
      return;
    }

    // Management dashboard (static HTML; the API calls it makes still require the token).
    if (req.method === "GET" && (path === "/" || path === "/ui" || path === "/dashboard")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(DASHBOARD_HTML);
      return;
    }

    // Local mode: reject anything not from loopback. Hosted mode relies on the token + TLS.
    if (!IS_REMOTE && !isLoopback(req)) {
      send(res, 403, { error: "loopback only" });
      return;
    }

    try {
      // POST /auth/login — password → the user's static API token (no auth required).
      if (req.method === "POST" && path === "/auth/login") {
        const { username, password } = JSON.parse(await readBody(req)) as {
          username?: string;
          password?: string;
        };
        const user = await verifyLogin(String(username ?? ""), String(password ?? ""));
        if (!user) {
          send(res, 401, { error: "invalid username or password" });
          return;
        }
        send(res, 200, {
          token: user.token,
          user: { id: user.id, username: user.username, role: user.role },
        });
        return;
      }

      const auth = await authenticate(req.headers.authorization);
      if (!auth) {
        send(res, 401, { error: "invalid or missing token" });
        return;
      }

      // GET /auth/me
      if (req.method === "GET" && path === "/auth/me") {
        send(res, 200, auth);
        return;
      }

      // POST /traces
      if (req.method === "POST" && path === "/traces") {
        const envelope = JSON.parse(await readBody(req)) as {
          trace?: unknown;
          screenshots?: Record<string, string>;
        };
        const { valid, errors } = validateTrace(envelope.trace);
        if (!valid) {
          send(res, 422, { error: "invalid trace", details: errors });
          return;
        }
        const saved = await saveTrace(asTrace(envelope.trace), envelope.screenshots, auth.username);
        send(res, 201, { id: saved.id, name: saved.name, stepCount: saved.steps.length });
        return;
      }

      // GET /traces[?project=<id>|none]
      if (req.method === "GET" && path === "/traces") {
        const project = url.searchParams.get("project") ?? undefined;
        send(res, 200, await listTraces(project));
        return;
      }

      const match = /^\/traces\/([^/]+)(\/screenshots)?$/.exec(path);
      if (match) {
        const [, id, screenshots] = match;
        if (req.method === "GET" && screenshots) {
          send(res, 200, await getScreenshotData(id));
          return;
        }
        if (req.method === "GET") {
          const trace = id === "latest" ? await getLatestTrace() : await getTrace(id);
          if (!trace) return send(res, 404, { error: "not found" });
          send(res, 200, trace);
          return;
        }
        if (req.method === "PUT" && !screenshots) {
          const incoming = JSON.parse(await readBody(req)) as unknown;
          const { valid, errors } = validateTrace(incoming);
          if (!valid) {
            send(res, 422, { error: "invalid trace", details: errors });
            return;
          }
          const updated = await updateTrace(id, asTrace(incoming));
          if (!updated) return send(res, 404, { error: "not found" });
          send(res, 200, updated);
          return;
        }
        if (req.method === "DELETE") {
          send(res, 200, { deleted: await deleteTrace(id) });
          return;
        }
      }

      // Projects
      if (path === "/projects") {
        if (req.method === "GET") {
          send(res, 200, await listProjects());
          return;
        }
        if (req.method === "POST") {
          const { name } = JSON.parse(await readBody(req)) as { name?: string };
          send(res, 201, await createProject(String(name ?? "")));
          return;
        }
      }
      const projectMatch = /^\/projects\/([^/]+)$/.exec(path);
      if (projectMatch) {
        const [, id] = projectMatch;
        if (req.method === "PUT") {
          const { name } = JSON.parse(await readBody(req)) as { name?: string };
          send(res, 200, await renameProject(id, String(name ?? "")));
          return;
        }
        if (req.method === "DELETE") {
          send(res, 200, { deleted: await deleteProject(id) });
          return;
        }
      }

      // Users (admin only)
      if (path === "/users" || path.startsWith("/users/")) {
        if (auth.role !== "admin") {
          send(res, 403, { error: "admin only" });
          return;
        }
        if (req.method === "GET" && path === "/users") {
          send(res, 200, await listUsersPublic());
          return;
        }
        if (req.method === "POST" && path === "/users") {
          const { username, password, role } = JSON.parse(await readBody(req)) as {
            username?: string;
            password?: string;
            role?: Role;
          };
          const user = await createUser(
            String(username ?? ""),
            String(password ?? ""),
            role === "admin" ? "admin" : "user",
          );
          // The token is returned once at creation; list responses never include it.
          send(res, 201, {
            id: user.id,
            username: user.username,
            role: user.role,
            createdAt: user.createdAt,
            token: user.token,
          });
          return;
        }
        const userMatch = /^\/users\/([^/]+)(\/reset-token|\/password)?$/.exec(path);
        if (userMatch) {
          const [, id, action] = userMatch;
          if (req.method === "DELETE" && !action) {
            await deleteUser(id);
            send(res, 200, { deleted: true });
            return;
          }
          if (req.method === "POST" && action === "/reset-token") {
            send(res, 200, { token: await resetToken(id) });
            return;
          }
          if (req.method === "PUT" && action === "/password") {
            const { password } = JSON.parse(await readBody(req)) as { password?: string };
            await setPassword(id, String(password ?? ""));
            send(res, 200, { updated: true });
            return;
          }
        }
      }

      send(res, 404, { error: "not found" });
    } catch (err) {
      send(res, 400, { error: `bad request: ${(err as Error).message}` });
    }
  });

  await new Promise<void>((resolve) => server.listen(INGEST_PORT, INGEST_HOST, resolve));
  console.error(`[trace2e] API + dashboard on http://${INGEST_HOST}:${INGEST_PORT}/ (remote=${IS_REMOTE})`);
  if (!process.env.TRACE2E_TOKEN) console.error(`[trace2e] token: ${token}`);
}
