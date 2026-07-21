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
} from "./store.js";

/**
 * HTTP API for trace2e.
 *
 * Write (Chrome extension):
 *   POST   /traces                 { trace, screenshots? }
 * Read (Claude Code MCP, local or remote):
 *   GET    /traces                 → summaries
 *   GET    /traces/:id|latest      → full trace
 *   GET    /traces/:id/screenshots → { stepId: base64 }
 *   DELETE /traces/:id
 *   GET    /health                 (no auth)
 *
 * All non-health routes require `Authorization: Bearer <token>`. Locally the server binds
 * 127.0.0.1 and additionally rejects non-loopback callers; in a hosted deploy
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
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
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
  const authed = (req: IncomingMessage) => (req.headers.authorization ?? "") === `Bearer ${token}`;

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
    if (!authed(req)) {
      send(res, 401, { error: "invalid or missing token" });
      return;
    }

    try {
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
        const saved = await saveTrace(asTrace(envelope.trace), envelope.screenshots);
        send(res, 201, { id: saved.id, name: saved.name, stepCount: saved.steps.length });
        return;
      }

      // GET /traces
      if (req.method === "GET" && path === "/traces") {
        send(res, 200, await listTraces());
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
        if (req.method === "DELETE") {
          send(res, 200, { deleted: await deleteTrace(id) });
          return;
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
