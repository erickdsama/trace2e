import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { ADMIN_PASSWORD, TRACE2E_HOME, USERS_FILE } from "./config.js";
import { getOrCreateToken } from "./store.js";

// promisify() drops the options overload of scrypt, so wrap it by hand.
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  opts: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/**
 * File-backed user store at ~/.trace2e/users.json. Each user has a scrypt password hash
 * and a static per-user API token (`Authorization: Bearer <token>`), so the extension,
 * Go client and MCP bridge keep working unchanged — they just carry different tokens.
 *
 * Backward compat: the legacy single token (TRACE2E_TOKEN env or ~/.trace2e/token) stays
 * valid and maps to a virtual admin, so local mode with no users behaves like before.
 */

export type Role = "admin" | "user";

export interface User {
  id: string;
  username: string;
  role: Role;
  passwordHash: string;
  token: string;
  createdAt: string;
  disabled: boolean;
}

/** The identity attached to an authenticated request. */
export interface AuthUser {
  id: string;
  username: string;
  role: Role;
}

interface UsersFile {
  version: 1;
  users: User[];
}

const USERNAME_RE = /^[a-z0-9_.-]{2,32}$/;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;

// ---------------------------------------------------------------------------
// Password hashing (node:crypto only; params stored in-string for future upgrades)

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString("base64")}:${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");
  const actual = (await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  })) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---------------------------------------------------------------------------
// Persistence (atomic tmp+rename writes; in-memory token index for auth lookups)

let cache: UsersFile | null = null;
let tokenIndex: Map<string, User> = new Map();

function reindex(file: UsersFile): void {
  cache = file;
  tokenIndex = new Map(file.users.map((u) => [u.token, u]));
}

export async function loadUsers(): Promise<UsersFile> {
  if (cache) return cache;
  if (!existsSync(USERS_FILE)) {
    reindex({ version: 1, users: [] });
    return cache!;
  }
  reindex(JSON.parse(await readFile(USERS_FILE, "utf8")) as UsersFile);
  return cache!;
}

async function persist(file: UsersFile): Promise<void> {
  await mkdir(TRACE2E_HOME, { recursive: true });
  const tmp = `${USERS_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
  await rename(tmp, USERS_FILE);
  reindex(file);
}

// ---------------------------------------------------------------------------
// Tokens

/** New collision-safe API token. Never equal to an existing user token or the legacy token. */
export async function generateToken(): Promise<string> {
  const file = await loadUsers();
  const legacy = await getOrCreateToken();
  for (;;) {
    const token = `t2e_${randomBytes(24).toString("hex")}`;
    if (token !== legacy && !file.users.some((u) => u.token === token)) return token;
  }
}

// ---------------------------------------------------------------------------
// CRUD

function assertUsername(username: string): void {
  if (!USERNAME_RE.test(username)) {
    throw new Error(`username must match ${USERNAME_RE} (lowercase, 2-32 chars)`);
  }
}

function assertPassword(password: string): void {
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("password must be at least 8 characters");
  }
}

export async function createUser(username: string, password: string, role: Role = "user"): Promise<User> {
  assertUsername(username);
  assertPassword(password);
  const file = await loadUsers();
  if (file.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    throw new Error(`user "${username}" already exists`);
  }
  const user: User = {
    id: randomUUID(),
    username,
    role,
    passwordHash: await hashPassword(password),
    token: await generateToken(),
    createdAt: new Date().toISOString(),
    disabled: false,
  };
  await persist({ ...file, users: [...file.users, user] });
  return user;
}

function findUser(file: UsersFile, id: string): User {
  const user = file.users.find((u) => u.id === id);
  if (!user) throw new Error("user not found");
  return user;
}

export async function deleteUser(id: string): Promise<void> {
  const file = await loadUsers();
  const user = findUser(file, id);
  const remainingAdmins = file.users.filter((u) => u.role === "admin" && !u.disabled && u.id !== id);
  if (user.role === "admin" && remainingAdmins.length === 0) {
    throw new Error("cannot delete the last admin");
  }
  await persist({ ...file, users: file.users.filter((u) => u.id !== id) });
}

export async function setPassword(id: string, password: string): Promise<void> {
  assertPassword(password);
  const file = await loadUsers();
  const user = findUser(file, id);
  user.passwordHash = await hashPassword(password);
  await persist(file);
}

export async function resetToken(id: string): Promise<string> {
  const file = await loadUsers();
  const user = findUser(file, id);
  user.token = await generateToken();
  await persist(file);
  return user.token;
}

// ---------------------------------------------------------------------------
// Authentication

/** Password login. Small fixed delay on failure to blunt brute-force attempts. */
export async function verifyLogin(username: string, password: string): Promise<User | null> {
  const file = await loadUsers();
  const user = file.users.find((u) => u.username.toLowerCase() === String(username).toLowerCase());
  if (user && !user.disabled && (await verifyPassword(password, user.passwordHash))) return user;
  await new Promise((r) => setTimeout(r, 300));
  return null;
}

/**
 * Bearer-token authentication for every API request. User tokens first; the legacy
 * single token maps to a virtual admin so pre-user setups keep working.
 */
export async function authenticate(authHeader: string | undefined): Promise<AuthUser | null> {
  const token = (authHeader ?? "").startsWith("Bearer ") ? (authHeader as string).slice(7) : "";
  if (!token) return null;
  await loadUsers();
  const user = tokenIndex.get(token);
  if (user && !user.disabled) return { id: user.id, username: user.username, role: user.role };
  if (token === (await getOrCreateToken())) return { id: "legacy", username: "legacy", role: "admin" };
  return null;
}

/** Idempotent: create the `admin` user on startup when TRACE2E_ADMIN_PASSWORD is set. */
export async function bootstrapAdmin(): Promise<void> {
  if (!ADMIN_PASSWORD) return;
  const file = await loadUsers();
  if (file.users.some((u) => u.username === "admin")) return;
  await createUser("admin", ADMIN_PASSWORD, "admin");
  console.error(`[trace2e] bootstrapped admin user from TRACE2E_ADMIN_PASSWORD`);
}

/** Users without secrets, for the admin API. */
export async function listUsersPublic(): Promise<Array<Omit<User, "passwordHash" | "token">>> {
  const file = await loadUsers();
  return file.users.map(({ passwordHash: _p, token: _t, ...rest }) => rest);
}
