import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { PROJECTS_FILE, TRACE2E_HOME } from "./config.js";

/**
 * File-backed project registry at ~/.trace2e/projects.json. Projects only group traces:
 * each trace carries an optional projectId; deleting a project leaves its traces in
 * place (they render as "Unassigned").
 */

export interface Project {
  id: string;
  name: string;
  createdAt: string;
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

export async function listProjects(): Promise<Project[]> {
  const file = await load();
  return [...file.projects].sort((a, b) => a.name.localeCompare(b.name));
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

export async function createProject(name: string): Promise<Project> {
  assertName(name);
  const file = await load();
  if (file.projects.some((p) => p.name.toLowerCase() === name.trim().toLowerCase())) {
    throw new Error(`project "${name.trim()}" already exists`);
  }
  const project: Project = { id: randomUUID(), name: name.trim(), createdAt: new Date().toISOString() };
  await persist({ ...file, projects: [...file.projects, project] });
  return project;
}

export async function renameProject(id: string, name: string): Promise<Project> {
  assertName(name);
  const file = await load();
  const project = file.projects.find((p) => p.id === id);
  if (!project) throw new Error("project not found");
  if (file.projects.some((p) => p.id !== id && p.name.toLowerCase() === name.trim().toLowerCase())) {
    throw new Error(`project "${name.trim()}" already exists`);
  }
  project.name = name.trim();
  await persist(file);
  return project;
}

export async function deleteProject(id: string): Promise<boolean> {
  const file = await load();
  if (!file.projects.some((p) => p.id === id)) return false;
  await persist({ ...file, projects: file.projects.filter((p) => p.id !== id) });
  return true;
}
