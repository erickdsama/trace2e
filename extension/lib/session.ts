import { EMPTY_SESSION, type Session } from "./messages.js";

/**
 * Session persistence in chrome.storage.local. The background service worker is the single
 * writer; the side panel reads and subscribes to changes. Secret values are never stored —
 * the recorder emits variableRef placeholders instead (see content.ts password handling).
 */

const KEY = "trace2e:session";

export async function loadSession(): Promise<Session> {
  const res = await chrome.storage.local.get(KEY);
  return (res[KEY] as Session) ?? { ...EMPTY_SESSION };
}

export async function saveSession(session: Session): Promise<void> {
  await chrome.storage.local.set({ [KEY]: session });
}

// Serializes all mutations in this context. Recording fires capture:step messages faster
// than a load→mutate→save round-trip completes; without this queue, concurrent handlers
// read the same snapshot and the last writer clobbers the others (e.g. a just-added
// variable is lost while later steps survive → an invalid trace on upload).
let mutationChain: Promise<unknown> = Promise.resolve();

export function mutateSession(fn: (s: Session) => void): Promise<Session> {
  const run = mutationChain.then(async () => {
    const session = await loadSession();
    fn(session);
    await saveSession(session);
    return session;
  });
  // Keep the chain alive even if a mutation throws.
  mutationChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function onSessionChanged(cb: (s: Session) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && changes[KEY]) cb(changes[KEY].newValue as Session);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
