import type { Trace, TraceSummary } from "@trace2e/schema";
import { REMOTE_URL } from "./config.js";
import {
  deleteTrace,
  getLatestTrace,
  getOrCreateToken,
  getScreenshotData,
  getTrace,
  listTraces,
} from "./store.js";
import { resolveProject } from "./projects.js";

/**
 * Read backend for the MCP server. Either the local filesystem store, or a hosted daemon's
 * HTTP API when TRACE2E_REMOTE_URL is set — so a developer's local Claude Code can consume
 * traces uploaded to a shared, deployed daemon.
 */
export interface Backend {
  /** `project` narrows by project id or name (or "none" for unassigned traces). */
  list(project?: string): Promise<TraceSummary[]>;
  get(id?: string): Promise<Trace | null>;
  /** stepId -> base64 PNG */
  screenshots(id: string): Promise<Record<string, string>>;
  delete(id: string): Promise<boolean>;
}

const local: Backend = {
  list: async (project) => {
    if (!project || project === "none") return listTraces(project);
    const resolved = await resolveProject(project);
    return listTraces(resolved?.id ?? project);
  },
  get: (id) => (id ? getTrace(id) : getLatestTrace()),
  screenshots: (id) => getScreenshotData(id),
  delete: (id) => deleteTrace(id),
};

function remote(url: string): Backend {
  const base = url.replace(/\/$/, "");
  const headers = async () => ({ Authorization: `Bearer ${await getOrCreateToken()}` });
  const json = async (r: Response) => {
    if (!r.ok) throw new Error(`remote daemon returned ${r.status}`);
    return r.json();
  };
  return {
    list: async (project) => {
      let filter = project;
      if (project && project !== "none") {
        // Resolve a project *name* to its id via the daemon's registry; fall through
        // with the raw value (it may already be an id, or /projects may not exist).
        try {
          const projects = (await json(await fetch(`${base}/projects`, { headers: await headers() }))) as Array<{
            id: string;
            name: string;
          }>;
          filter = projects.find((p) => p.id === project || p.name.toLowerCase() === project.toLowerCase())?.id ?? project;
        } catch {
          // old daemon without /projects — use the value as-is
        }
      }
      const qs = filter ? `?project=${encodeURIComponent(filter)}` : "";
      return json(await fetch(`${base}/traces${qs}`, { headers: await headers() }));
    },
    get: async (id) => {
      const r = await fetch(`${base}/traces/${id ?? "latest"}`, { headers: await headers() });
      if (r.status === 404) return null;
      return json(r);
    },
    screenshots: async (id) => json(await fetch(`${base}/traces/${id}/screenshots`, { headers: await headers() })),
    delete: async (id) => {
      const r = await json(await fetch(`${base}/traces/${id}`, { method: "DELETE", headers: await headers() }));
      return !!r.deleted;
    },
  };
}

export const backend: Backend = REMOTE_URL ? remote(REMOTE_URL) : local;
export const backendMode = REMOTE_URL ? `remote (${REMOTE_URL})` : "local (~/.trace2e)";
