import { ensureHostPermission, getSettings, saveSettings } from "../../lib/settings.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const daemonUrl = $<HTMLInputElement>("daemonUrl");
const token = $<HTMLInputElement>("token");
const btnSave = $<HTMLButtonElement>("btnSave");
const btnTest = $<HTMLButtonElement>("btnTest");
const result = $("result");

function show(msg: string, cls: "muted" | "ok" | "err") {
  result.textContent = msg;
  result.className = cls;
}

getSettings().then((s) => {
  daemonUrl.value = s.daemonUrl;
  token.value = s.token;
});

// The click is the user gesture chrome.permissions.request() requires.
btnSave.onclick = async () => {
  const url = daemonUrl.value.trim().replace(/\/+$/, "");
  await saveSettings({ daemonUrl: url, token: token.value.trim() });
  if (!(await ensureHostPermission(url))) {
    show("Saved, but the host permission was denied — uploads to this daemon will fail.", "err");
    return;
  }
  show("Saved ✓", "ok");
};

btnTest.onclick = async () => {
  const url = daemonUrl.value.trim().replace(/\/+$/, "");
  if (!(await ensureHostPermission(url))) {
    show("Host permission denied.", "err");
    return;
  }
  show("Testing…", "muted");
  try {
    const res = await fetch(`${url}/auth/me`, {
      headers: { Authorization: `Bearer ${token.value.trim()}` },
    });
    if (res.ok) {
      const me = (await res.json()) as { username: string; role: string };
      show(`Connected ✓ as ${me.username} (${me.role})`, "ok");
    } else if (res.status === 401) {
      show("Daemon reachable, but the token was rejected.", "err");
    } else {
      show(`Daemon answered HTTP ${res.status}.`, "err");
    }
  } catch (err) {
    show(`Cannot reach daemon: ${(err as Error).message}`, "err");
  }
};
