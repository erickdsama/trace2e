import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { PROJECTS_FILE, TRACE2E_HOME } from "./config.js";

/**
 * File-backed project registry at ~/.trace2e/projects.json. Projects only group traces:
 * each trace carries an optional projectId; deleting a project leaves its traces in
 * place (they render as "Unassigned").
 *
 * Projects are scoped to their creator: `owner` params filter/guard access for plain
 * users; admins (and the legacy token) pass no owner and see everything. Names are
 * unique per owner, so two users can each have a "checkout" project.
 */

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  /** Username that created the project. Absent on projects from before user scoping. */
  createdBy?: string;
}

interface ProjectsFile {
  version: 1;
  projects: Project[];
}

let cache: ProjectsFile | null = null;

async function load(): Promise<ProjectsFile> {
  if (cache) return cache;
  if (!existsSync(PROJECTS_FILE)) {
    cache = { version: 1, projects: [] };
    return cache;
  }
  cache = JSON.parse(await readFile(PROJECTS_FILE, "utf8")) as ProjectsFile;
  return cache;
}

async function persist(file: ProjectsFile): Promise<void> {
  await mkdir(TRACE2E_HOME, { recursive: true });
  const tmp = `${PROJECTS_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
  await rename(tmp, PROJECTS_FILE);
  cache = file;
}

export async function listProjects(owner?: string): Promise<Project[]> {
  const file = await load();
  const visible = owner ? file.projects.filter((p) => p.createdBy === owner) : file.projects;
  return [...visible].sort((a, b) => a.name.localeCompare(b.name));
}

export async function projectExists(id: string): Promise<boolean> {
  const file = await load();
  return file.projects.some((p) => p.id === id);
}

/** Find a project by exact id or case-insensitive name (used by the MCP filter). */
export async function resolveProject(idOrName: string): Promise<Project | null> {
  const file = await load();
  return (
    file.projects.find((p) => p.id === idOrName) ??
    file.projects.find((p) => p.name.toLowerCase() === idOrName.toLowerCase()) ??
    null
  );
}

function assertName(name: string): void {
  if (typeof name !== "string" || name.trim().length === 0 || name.length > 64) {
    throw new Error("project name must be a non-empty string (max 64 chars)");
  }
}

/** Name uniqueness is checked among the same owner's projects only. */
function nameTaken(file: ProjectsFile, name: string, createdBy: string | undefined, exceptId?: string): boolean {
  return file.projects.some(
    (p) => p.id !== exceptId && p.createdBy === createdBy && p.name.toLowerCase() === name.trim().toLowerCase(),
  );
}

export async function createProject(name: string, createdBy?: string): Promise<Project> {
  assertName(name);
  const file = await load();
  if (nameTaken(file, name, createdBy)) {
    throw new Error(`project "${name.trim()}" already exists`);
  }
  const project: Project = { id: randomUUID(), name: name.trim(), createdAt: new Date().toISOString() };
  if (createdBy) project.createdBy = createdBy;
  await persist({ ...file, projects: [...file.projects, project] });
  return project;
}

/** With `owner` set, another user's project behaves as if it doesn't exist. */
export async function renameProject(id: string, name: string, owner?: string): Promise<Project> {
  assertName(name);
  const file = await load();
  const project = file.projects.find((p) => p.id === id);
  if (!project || (owner && project.createdBy !== owner)) throw new Error("project not found");
  if (nameTaken(file, name, project.createdBy, id)) {
    throw new Error(`project "${name.trim()}" already exists`);
  }
  project.name = name.trim();
  await persist(file);
  return project;
}

export async function deleteProject(id: string, owner?: string): Promise<boolean> {
  const file = await load();
  const project = file.projects.find((p) => p.id === id);
  if (!project || (owner && project.createdBy !== owner)) return false;
  await persist({ ...file, projects: file.projects.filter((p) => p.id !== id) });
  return true;
}
