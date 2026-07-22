import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Trace, TraceSummary } from "@trace2e/schema";
import { FIXED_TOKEN, TOKEN_FILE, TRACE2E_HOME, TRACES_DIR } from "./config.js";

/**
 * File-backed trace store rooted at ~/.trace2e. Each trace is a directory:
 *   traces/<id>/trace.json
 *   traces/<id>/<stepId>.png   (screenshots)
 */

export async function ensureStore(): Promise<void> {
  await mkdir(TRACES_DIR, { recursive: true });
}

/**
 * The access token. In production TRACE2E_TOKEN (a secret) takes precedence and is never
 * written to disk. Otherwise a random token is generated and cached in ~/.trace2e/token.
 */
export async function getOrCreateToken(): Promise<string> {
  if (FIXED_TOKEN) return FIXED_TOKEN;
  await mkdir(TRACE2E_HOME, { recursive: true });
  if (existsSync(TOKEN_FILE)) {
    return (await readFile(TOKEN_FILE, "utf8")).trim();
  }
  const token = randomUUID();
  await writeFile(TOKEN_FILE, token, { mode: 0o600 });
  return token;
}

function traceDir(id: string): string {
  return join(TRACES_DIR, id);
}

/**
 * Persist an incoming trace. Assigns a fresh id and createdAt, decodes any inline
 * base64 screenshots to PNG files, and stores the trace with filename references.
 * `incoming.screenshots` may map stepId -> data URL; those are written out here.
 */
export async function saveTrace(
  incoming: Trace,
  inlineScreenshots?: Record<string, string>,
  createdBy?: string,
): Promise<Trace> {
  await ensureStore();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const dir = traceDir(id);
  await mkdir(dir, { recursive: true });

  const screenshots: Record<string, string> = {};
  if (inlineScreenshots) {
    for (const [stepId, dataUrl] of Object.entries(inlineScreenshots)) {
      const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
      if (!match) continue;
      const filename = `${stepId}.png`;
      await writeFile(join(dir, filename), Buffer.from(match[1], "base64"));
      screenshots[stepId] = filename;
    }
  }

  const trace: Trace = { ...incoming, id, createdAt, screenshots };
  if (createdBy) trace.createdBy = createdBy;
  await writeFile(join(dir, "trace.json"), JSON.stringify(trace, null, 2), "utf8");
  return trace;
}

/**
 * Rewrite an existing trace with edited content. `id`, `createdAt`, `createdBy` and
 * `version` are immutable; the screenshots map is server-owned — entries whose step no
 * longer exists are pruned and their PNG files removed.
 */
export async function updateTrace(id: string, incoming: Trace): Promise<Trace | null> {
  const existing = await getTrace(id);
  if (!existing) return null;
  const dir = traceDir(id);

  const stepIds = new Set(incoming.steps.map((s) => s.id));
  const screenshots: Record<string, string> = {};
  for (const [stepId, filename] of Object.entries(existing.screenshots ?? {})) {
    if (stepIds.has(stepId)) {
      screenshots[stepId] = filename;
    } else {
      await rm(join(dir, filename), { force: true });
    }
  }

  const trace: Trace = {
    ...incoming,
    version: existing.version,
    id: existing.id,
    createdAt: existing.createdAt,
    screenshots,
  };
  if (existing.createdBy) trace.createdBy = existing.createdBy;
  else delete trace.createdBy;
  await writeFile(join(dir, "trace.json"), JSON.stringify(trace, null, 2), "utf8");
  return trace;
}

/**
 * List trace summaries, newest first. `projectFilter` narrows to a project id, or the
 * literal "none" for traces with no project. `owner` narrows to traces created by that
 * username (user-scoped views; admins pass undefined and see everything).
 */
export async function listTraces(projectFilter?: string, owner?: string): Promise<TraceSummary[]> {
  await ensureStore();
  const entries = await readdir(TRACES_DIR, { withFileTypes: true });
  const summaries: TraceSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const trace = await getTrace(entry.name);
      if (!trace) continue;
      if (owner && trace.createdBy !== owner) continue;
      if (projectFilter === "none" && trace.projectId) continue;
      if (projectFilter && projectFilter !== "none" && trace.projectId !== projectFilter) continue;
      summaries.push({
        id: trace.id,
        name: trace.name,
        createdAt: trace.createdAt,
        stepCount: trace.steps.length,
        ...(trace.projectId ? { projectId: trace.projectId } : {}),
        ...(trace.createdBy ? { createdBy: trace.createdBy } : {}),
      });
    } catch {
      // Skip unreadable/partial trace directories.
    }
  }
  return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getTrace(id: string): Promise<Trace | null> {
  const file = join(traceDir(id), "trace.json");
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, "utf8")) as Trace;
}

/** Newest trace by createdAt (optionally among one owner's traces), or null. */
export async function getLatestTrace(owner?: string): Promise<Trace | null> {
  const summaries = await listTraces(undefined, owner);
  if (summaries.length === 0) return null;
  return getTrace(summaries[0].id);
}

/** Absolute paths to a trace's screenshot files, keyed by step id. */
export async function getScreenshotPaths(id: string): Promise<Record<string, string>> {
  const trace = await getTrace(id);
  if (!trace) return {};
  const out: Record<string, string> = {};
  for (const [stepId, filename] of Object.entries(trace.screenshots ?? {})) {
    out[stepId] = join(traceDir(id), filename);
  }
  return out;
}

/** A trace's screenshots as base64 PNG data, keyed by step id (used by the API/MCP). */
export async function getScreenshotData(id: string): Promise<Record<string, string>> {
  const paths = await getScreenshotPaths(id);
  const out: Record<string, string> = {};
  for (const [stepId, path] of Object.entries(paths)) {
    out[stepId] = (await readFile(path)).toString("base64");
  }
  return out;
}

export async function deleteTrace(id: string): Promise<boolean> {
  const dir = traceDir(id);
  if (!existsSync(dir)) return false;
  await rm(dir, { recursive: true, force: true });
  return true;
}
