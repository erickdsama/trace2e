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

// Note: no host-permission handling is needed to reach the daemon. The recorder's
// <all_urls> content script match pattern already grants all-hosts access in Chrome,
// so extension contexts fetch any daemon origin CORS-exempt.
