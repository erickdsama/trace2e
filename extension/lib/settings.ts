/**
 * Extension settings, shared by the background worker, the options page and the side
 * panel. One storage key, one source of truth — persisted in chrome.storage.local.
 */

export interface Settings {
  daemonUrl: string;
  token: string;
  /** Project preselected in the side panel; uploads carry it as trace.projectId. */
  projectId: string;
}

export const SETTINGS_KEY = "trace2e:settings";

export const DEFAULT_SETTINGS: Settings = {
  daemonUrl: "https://trace2e.novaminds.xyz",
  token: "",
  projectId: "",
};

export async function getSettings(): Promise<Settings> {
  const res = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(res[SETTINGS_KEY] as Partial<Settings> | undefined) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const merged = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
  return merged;
}

/**
 * A hosted (non-loopback) daemon needs an explicit host permission before we can fetch
 * it. Must be called from a user-gesture context (e.g. a Save button click).
 * Returns false when the user denies the permission prompt.
 */
export async function ensureHostPermission(daemonUrl: string): Promise<boolean> {
  try {
    const u = new URL(daemonUrl);
    const isLoopback = u.hostname === "127.0.0.1" || u.hostname === "localhost";
    if (isLoopback) return true;
    const origins = [`${u.origin}/*`];
    if (await chrome.permissions.contains({ origins })) return true;
    return await chrome.permissions.request({ origins });
  } catch {
    // Invalid URL — let the eventual fetch surface the error.
    return true;
  }
}
