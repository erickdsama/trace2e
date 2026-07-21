import { homedir } from "node:os";
import { join } from "node:path";

/** Root of the canonical trace store. Override with TRACE2E_HOME (mount a volume in prod). */
export const TRACE2E_HOME = process.env.TRACE2E_HOME ?? join(homedir(), ".trace2e");

export const TRACES_DIR = join(TRACE2E_HOME, "traces");
export const TOKEN_FILE = join(TRACE2E_HOME, "token");

/** Ingest/API port. Override with TRACE2E_PORT (or PORT, which many PaaS platforms set). */
export const INGEST_PORT = Number(process.env.TRACE2E_PORT ?? process.env.PORT ?? 8787);

/**
 * Bind address. Defaults to loopback for local use. In a container/production deploy set
 * TRACE2E_HOST=0.0.0.0 so the platform can route to it.
 */
export const INGEST_HOST = process.env.TRACE2E_HOST ?? "127.0.0.1";

/** True when bound to a non-loopback address — i.e. a remote/hosted deployment. */
export const IS_REMOTE = INGEST_HOST !== "127.0.0.1" && INGEST_HOST !== "localhost" && INGEST_HOST !== "::1";

/**
 * Fixed access token. In production set TRACE2E_TOKEN (a secret) so it's stable across
 * restarts and not written to disk. Locally, a random token is generated in ~/.trace2e/token.
 */
export const FIXED_TOKEN = process.env.TRACE2E_TOKEN ?? null;

/**
 * When set, the MCP server reads traces from this hosted daemon's HTTP API instead of the
 * local filesystem store (e.g. https://trace2e.your-co.com). Pair with TRACE2E_TOKEN.
 */
export const REMOTE_URL = process.env.TRACE2E_REMOTE_URL ?? null;

/**
 * Origins allowed to POST traces (CORS). Chrome extension origins look like
 * chrome-extension://<id>. Set TRACE2E_ALLOWED_ORIGIN to lock it down in production.
 */
export const ALLOWED_ORIGIN = process.env.TRACE2E_ALLOWED_ORIGIN ?? null;
