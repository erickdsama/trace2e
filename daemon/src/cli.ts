#!/usr/bin/env node
import { validateTrace, asTrace } from "@trace2e/schema";
import { ensureStore, getOrCreateToken, listTraces, saveTrace } from "./store.js";
import { startIngestServer } from "./ingest-server.js";
import { startMcpServer } from "./mcp-server.js";
import { runInit } from "./init.js";
import { SAMPLE_SIGNUP_JSON } from "./embedded.js";
import { INGEST_HOST, INGEST_PORT, IS_REMOTE, REMOTE_URL, TRACE2E_HOME } from "./config.js";

/**
 * `trace2e` CLI. Portable across projects: install once, then `trace2e init` in any repo.
 *
 *   trace2e init [--force] [--npx]   scaffold .mcp.json + /trace2e command into this project
 *   trace2e mcp                      MCP server on stdio (+ ingest if the port is free) — what
 *                                    Claude Code launches via .mcp.json
 *   trace2e serve                    ingest HTTP only (run while recording; alias: daemon)
 *   trace2e list                     list recorded traces
 *   trace2e token                    print the ingest token (paste into the extension)
 *   trace2e help
 *
 * Store lives at ~/.trace2e (override with TRACE2E_HOME). Ingest binds 127.0.0.1:8787
 * (override with TRACE2E_PORT).
 */

const HELP = `trace2e — record browser flows, generate Playwright tests via Claude Code

Usage:
  trace2e init [--force] [--npx]   Set up .mcp.json + /trace2e command in the current project
  trace2e init --token <t> [--url <daemon>]   Client mode: point at a hosted daemon
                                   (URL defaults to the shared daemon)
  trace2e mcp                      Run the MCP server on stdio (used by .mcp.json) + ingest
  trace2e serve                    Run only the ingest server (while recording)
  trace2e list                     List recorded traces
  trace2e token                    Print the ingest token for the Chrome extension
  trace2e sample                   Load a sample signup flow (username/password) into the store
  trace2e help                     Show this help

Env:
  TRACE2E_HOME            store location (default ~/.trace2e)
  TRACE2E_PORT / PORT     API port (default 8787)
  TRACE2E_HOST            bind address (default 127.0.0.1; set 0.0.0.0 to deploy)
  TRACE2E_TOKEN           fixed access token (set as a secret in production)
  TRACE2E_ADMIN_PASSWORD  bootstrap an "admin" user on startup; manage users, per-user
                          tokens and projects from the dashboard afterwards
  TRACE2E_REMOTE_URL      read traces from a hosted daemon instead of local disk
  TRACE2E_ALLOWED_ORIGIN  lock CORS to a specific chrome-extension:// origin
`;

async function startWithIngest(alsoMcp: boolean): Promise<void> {
  try {
    await startIngestServer();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
      console.error("[trace2e] ingest port in use — assuming another daemon; continuing");
    } else if (alsoMcp) {
      // Non-fatal for MCP mode: Claude Code still needs stdio even if ingest failed.
      console.error("[trace2e] ingest failed to start:", (err as Error).message);
    } else {
      throw err;
    }
  }
  if (alsoMcp) await startMcpServer();
}

async function main(): Promise<void> {
  const [cmd = "mcp", ...rest] = process.argv.slice(2);
  await ensureStore();

  switch (cmd) {
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(HELP);
      return;

    case "init": {
      // --url <daemon-url> and --token <token> put init into client mode (point at a hosted daemon)
      const flag = (name: string) => {
        const i = rest.indexOf(name);
        return i >= 0 && rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[i + 1] : undefined;
      };
      const token = flag("--token") ?? process.env.TRACE2E_TOKEN;
      const url = flag("--url") ?? (rest.includes("--client") ? "" : undefined);
      await runInit(process.cwd(), {
        force: rest.includes("--force"),
        mode: rest.includes("--self") ? "self" : rest.includes("--npx") ? "npx" : "global",
        selfPath: process.argv[1],
        remoteUrl: url,
        token,
      });
      return;
    }

    case "serve":
    case "daemon":
    case "--ingest-only": // back-compat
      await startWithIngest(false);
      return;

    case "mcp":
      await startWithIngest(true);
      return;

    case "list": {
      const traces = await listTraces();
      if (traces.length === 0) {
        console.log("No traces yet. Record one with the Chrome extension and upload it.");
      } else {
        for (const t of traces) console.log(`${t.createdAt}  ${t.id}  ${t.name}  (${t.stepCount} steps)`);
      }
      return;
    }

    case "token":
      console.log(await getOrCreateToken());
      console.error(`[trace2e] store: ${TRACE2E_HOME} | api: http://${INGEST_HOST}:${INGEST_PORT} | remote=${IS_REMOTE}`);
      return;

    case "sample": {
      const raw = JSON.parse(SAMPLE_SIGNUP_JSON);
      const { valid, errors } = validateTrace(raw);
      if (!valid) {
        console.error("[trace2e] bundled sample is invalid:", errors.join("; "));
        process.exitCode = 1;
        return;
      }
      if (REMOTE_URL) {
        console.error("[trace2e] `sample` loads into the local store; to seed a hosted daemon, POST it to /traces.");
      }
      const saved = await saveTrace(asTrace(raw));
      console.log(`Loaded sample flow "${saved.name}" (${saved.steps.length} steps) → id ${saved.id}`);
      console.error("[trace2e] now run  /trace2e signup  in Claude Code.");
      return;
    }

    default:
      console.error(`Unknown command: ${cmd}\n`);
      process.stdout.write(HELP);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[trace2e] fatal:", err);
  process.exit(1);
});
