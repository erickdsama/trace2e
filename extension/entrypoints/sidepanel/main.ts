import type { LocatorCandidates, Step, Variable, VariableKind, VariableSource } from "@trace2e/schema";
import type { PickPurpose, Session, UploadResult } from "../../lib/messages.js";
import { EMPTY_SESSION } from "../../lib/messages.js";
import { loadSession, onSessionChanged } from "../../lib/session.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  status: $("status"),
  flowName: $<HTMLInputElement>("flowName"),
  btnStart: $<HTMLButtonElement>("btnStart"),
  btnPause: $<HTMLButtonElement>("btnPause"),
  btnStop: $<HTMLButtonElement>("btnStop"),
  btnReset: $<HTMLButtonElement>("btnReset"),
  stepList: $<HTMLOListElement>("stepList"),
  stepCount: $("stepCount"),
  btnAssertUrl: $<HTMLButtonElement>("btnAssertUrl"),
  btnAssertVisible: $<HTMLButtonElement>("btnAssertVisible"),
  btnAssertText: $<HTMLButtonElement>("btnAssertText"),
  btnWaitEl: $<HTMLButtonElement>("btnWaitEl"),
  btnWaitUrl: $<HTMLButtonElement>("btnWaitUrl"),
  delayMs: $<HTMLInputElement>("delayMs"),
  btnAddDelay: $<HTMLButtonElement>("btnAddDelay"),
  pickHint: $("pickHint"),
  customType: $<HTMLSelectElement>("customType"),
  customBody: $<HTMLTextAreaElement>("customBody"),
  customTarget: $<HTMLInputElement>("customTarget"),
  btnAddCustom: $<HTMLButtonElement>("btnAddCustom"),
  btnUpload: $<HTMLButtonElement>("btnUpload"),
  uploadResult: $("uploadResult"),
  daemonUrl: $<HTMLInputElement>("daemonUrl"),
  token: $<HTMLInputElement>("token"),
  btnSaveSettings: $<HTMLButtonElement>("btnSaveSettings"),
};

const send = (msg: object) => chrome.runtime.sendMessage(msg) as Promise<any>;
const uid = () => crypto.randomUUID();

let current: Session = { ...EMPTY_SESSION };

/** A locator is fragile when the engine fell back to a raw CSS `locator(...)` selector
 * rather than a semantic getByRole/Label/TestId/Text match. */
const isFragile = (primary: string) => /^locator\(/.test(primary);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id;
}
async function activeTabUrl(): Promise<string> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.url ?? "";
}

function describeStep(step: Step): string {
  switch (step.type) {
    case "navigate": return `→ ${step.url}`;
    case "click": return step.target.primary;
    case "fill": return step.variableRef
      ? `${step.target.primary} = <span class="var">{{${step.variableRef}}}</span>`
      : `${step.target.primary} = ${JSON.stringify(step.value ?? "")}`;
    case "press": return `key ${step.key}`;
    case "select": return `${step.target.primary} = ${step.label ?? step.value}`;
    case "upload": return `${step.target.primary} ← ${step.files.join(", ")}`;
    case "waitFor": return `wait ${step.url ?? step.target?.primary ?? step.state ?? ""}`;
    case "assert": return `expect ${step.target?.primary ?? "url"} ${step.kind} ${JSON.stringify(step.expected ?? "")}`;
    case "delay": return `delay ${step.ms} ms`;
    case "customJs": return `evaluate: ${step.code.slice(0, 60)}`;
    case "hook": return `${step.phase} hook: ${step.code.slice(0, 50)}`;
  }
}

function stepTarget(step: Step): LocatorCandidates | undefined {
  const t = (step as { target?: LocatorCandidates }).target;
  return t && typeof t.primary === "string" ? t : undefined;
}

function render(session: Session) {
  current = session;
  const rec = session.recording;
  els.status.textContent = rec ? (session.paused ? "paused" : "recording") : "idle";
  els.status.className = "status " + (rec ? (session.paused ? "paused" : "recording") : "idle");
  els.btnStart.disabled = rec;
  els.btnPause.disabled = !rec;
  els.btnPause.textContent = session.paused ? "Resume" : "Pause";
  els.btnStop.disabled = !rec;
  if (session.name && els.flowName.value === "") els.flowName.value = session.name;

  els.stepCount.textContent = `(${session.steps.length})`;
  els.stepList.innerHTML = "";
  for (const step of session.steps) {
    const li = document.createElement("li");
    li.className = "step";
    const canTag = step.type === "fill" && !step.variableRef;
    const target = stepTarget(step);
    const fragile = target && isFragile(target.primary);

    let locatorPicker = "";
    if (target && target.fallbacks.length) {
      const options = [target.primary, ...target.fallbacks]
        .map((c, i) => `<option value="${i}"${i === 0 ? " selected" : ""}>${esc(c)}</option>`)
        .join("");
      locatorPicker = `<select class="loc" data-act="loc" data-id="${step.id}" title="Choose the locator to use">${options}</select>`;
    }

    li.innerHTML =
      `<div><span class="type">${step.type}</span> <code>${describeStep(step)}</code>` +
      (fragile ? ` <span class="warn" title="Positional selector — likely to break. Retarget it.">⚠ fragile</span>` : "") +
      `</div>` +
      locatorPicker +
      `<div class="actions">` +
      (canTag ? `<button data-act="tag" data-id="${step.id}">Tag variable</button>` : "") +
      (target ? `<button data-act="retarget" data-id="${step.id}">Retarget</button>` : "") +
      `<button data-act="del" data-id="${step.id}">Delete</button></div>`;
    els.stepList.appendChild(li);
  }
}

// Choosing a different locator candidate promotes it to `primary`.
els.stepList.addEventListener("change", async (e) => {
  const sel = (e.target as HTMLElement).closest("select.loc") as HTMLSelectElement | null;
  if (!sel) return;
  const id = sel.dataset.id!;
  const step = current.steps.find((s) => s.id === id);
  const target = step && stepTarget(step);
  if (!step || !target) return;
  const all = [target.primary, ...target.fallbacks];
  const chosen = all[Number(sel.value)];
  const newTarget: LocatorCandidates = { ...target, primary: chosen, fallbacks: all.filter((c) => c !== chosen) };
  const updated = { ...step, target: newTarget } as Step;
  await send({ kind: "control:update-step", step: updated });
});

els.stepList.addEventListener("click", async (e) => {
  const btn = (e.target as HTMLElement).closest("button");
  if (!btn) return;
  const id = btn.dataset.id!;
  if (btn.dataset.act === "del") {
    await send({ kind: "control:delete-step", stepId: id });
  } else if (btn.dataset.act === "retarget") {
    await startPick({ action: "retarget", stepId: id });
  } else if (btn.dataset.act === "tag") {
    const raw = prompt("Variable name (UPPER_SNAKE), e.g. USERNAME / PASSWORD / OTP")?.trim();
    if (!raw) return;
    // Normalize to a valid identifier: uppercase, non-alphanumerics → _, must start A-Z.
    const name = raw.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
      alert(`"${raw}" is not a usable variable name (must start with a letter). Try e.g. PASSWORD.`);
      return;
    }
    const kindIn = (prompt("kind: secret | data", "secret") || "").trim().toLowerCase();
    const kind: VariableKind = kindIn === "data" ? "data" : "secret";
    const sourceIn = (prompt("source: env | fixture | generated", "env") || "").trim().toLowerCase();
    const source: VariableSource =
      sourceIn === "fixture" ? "fixture" : sourceIn === "generated" ? "generated" : "env";
    const variable: Variable = { name, kind, source };
    await send({ kind: "control:tag-variable", stepId: id, variable });
  }
});

// Persist the flow name whenever it's edited — so it can be set before OR after recording,
// and is used at upload time (fixes traces defaulting to "recorded-flow").
els.flowName.addEventListener("change", () => send({ kind: "control:set-name", name: els.flowName.value.trim() }));
els.btnStart.onclick = () => send({ kind: "control:start", name: els.flowName.value.trim() });
els.btnPause.onclick = async () => {
  const s = await loadSession();
  await send({ kind: s.paused ? "control:resume" : "control:pause" });
};
els.btnStop.onclick = () => send({ kind: "control:stop" });
els.btnReset.onclick = async () => {
  if (confirm("Discard the current recording?")) {
    els.flowName.value = "";
    await send({ kind: "control:reset" });
  }
};

els.btnAddCustom.onclick = async () => {
  const kind = els.customType.value;
  const body = els.customBody.value.trim();
  if (!body) return;
  let step: Step;
  if (kind === "assert") {
    step = { id: uid(), type: "assert", kind: "text", target: els.customTarget.value.trim()
      ? { primary: els.customTarget.value.trim(), fallbacks: [] } : undefined, expected: body, ts: Date.now() };
  } else if (kind === "customJs") {
    step = { id: uid(), type: "customJs", code: body, awaitResult: true, ts: Date.now() };
  } else {
    step = { id: uid(), type: "hook", phase: kind === "hook:before" ? "before" : "after", code: body, ts: Date.now() };
  }
  await send({ kind: "control:add-step", step });
  els.customBody.value = "";
  els.customTarget.value = "";
};

els.btnUpload.onclick = async () => {
  els.uploadResult.textContent = "Uploading…";
  els.uploadResult.className = "muted";
  // Ensure the latest name field value is applied even if 'change' didn't fire.
  await send({ kind: "control:set-name", name: els.flowName.value.trim() });
  const res: UploadResult = await send({ kind: "control:upload" });
  els.uploadResult.textContent = res.ok ? `Uploaded ✓ id=${res.id}` : `Failed: ${res.error}`;
  els.uploadResult.className = res.ok ? "ok" : "err";
};

// --- element picker + checkpoints ---
let pendingPick: PickPurpose | null = null;

async function startPick(purpose: PickPurpose) {
  const tabId = await activeTabId();
  if (tabId === undefined) {
    els.pickHint.textContent = "Open the page you want to record in the active tab first.";
    return;
  }
  pendingPick = purpose;
  try {
    await chrome.tabs.sendMessage(tabId, { kind: "directive:start-pick" });
    els.pickHint.textContent = "Click an element on the page… (Esc to cancel)";
  } catch {
    pendingPick = null;
    els.pickHint.textContent = "Couldn't reach the page. Reload the tab and try again.";
  }
}

async function cancelPickOnPage() {
  const tabId = await activeTabId();
  if (tabId !== undefined) chrome.tabs.sendMessage(tabId, { kind: "directive:cancel-pick" }).catch(() => {});
}

// Result of a pick arrives as a runtime broadcast from the content script.
chrome.runtime.onMessage.addListener((msg: { kind?: string; locator?: LocatorCandidates; text?: string; url?: string }) => {
  if (msg.kind !== "capture:picked" || !pendingPick || !msg.locator) return;
  const purpose = pendingPick;
  pendingPick = null;
  els.pickHint.textContent = "";
  cancelPickOnPage();

  const target = msg.locator;
  let step: Step | undefined;
  let update: Step | undefined;

  if (purpose.action === "assert-visible") {
    step = { id: uid(), type: "assert", kind: "visible", target, expected: true, ts: Date.now() };
  } else if (purpose.action === "assert-text") {
    const expected = prompt("Expected text:", (msg.text ?? "").trim());
    if (expected == null) return;
    step = { id: uid(), type: "assert", kind: "text", target, expected, ts: Date.now() };
  } else if (purpose.action === "wait-visible") {
    step = { id: uid(), type: "waitFor", target, state: "visible", ts: Date.now() };
  } else if (purpose.action === "retarget") {
    const s = current.steps.find((x) => x.id === purpose.stepId);
    if (s) update = { ...s, target } as Step;
  }

  if (step) send({ kind: "control:add-step", step });
  if (update) send({ kind: "control:update-step", step: update });
});

els.btnAssertVisible.onclick = () => startPick({ action: "assert-visible" });
els.btnAssertText.onclick = () => startPick({ action: "assert-text" });
els.btnWaitEl.onclick = () => startPick({ action: "wait-visible" });

els.btnAssertUrl.onclick = async () => {
  const url = await activeTabUrl();
  if (!url) return;
  await send({ kind: "control:add-step", step: { id: uid(), type: "assert", kind: "url", expected: url, ts: Date.now() } });
};
els.btnWaitUrl.onclick = async () => {
  const current = await activeTabUrl();
  const url = prompt("Wait until the page URL is (or matches):", current);
  if (!url) return;
  await send({ kind: "control:add-step", step: { id: uid(), type: "waitFor", url, ts: Date.now() } });
};
els.btnAddDelay.onclick = async () => {
  const ms = Math.round(Number(els.delayMs.value));
  if (!Number.isFinite(ms) || ms < 0) {
    els.pickHint.textContent = "Enter a delay in milliseconds (e.g. 1000).";
    return;
  }
  await send({ kind: "control:add-step", step: { id: uid(), type: "delay", ms, ts: Date.now() } });
  els.delayMs.value = "";
};

// --- settings ---
const SETTINGS_KEY = "trace2e:settings";
async function loadSettings() {
  const res = await chrome.storage.local.get(SETTINGS_KEY);
  const s = { daemonUrl: "https://trace2e.novaminds.xyz", token: "", ...(res[SETTINGS_KEY] ?? {}) };
  els.daemonUrl.value = s.daemonUrl;
  els.token.value = s.token;
}
els.btnSaveSettings.onclick = async () => {
  const daemonUrl = els.daemonUrl.value.trim();
  await chrome.storage.local.set({ [SETTINGS_KEY]: { daemonUrl, token: els.token.value.trim() } });

  // A hosted (non-loopback) daemon needs an explicit host permission to POST to it.
  try {
    const u = new URL(daemonUrl);
    const isLoopback = u.hostname === "127.0.0.1" || u.hostname === "localhost";
    if (!isLoopback) {
      const origins = [`${u.origin}/*`];
      if (!(await chrome.permissions.contains({ origins }))) {
        const granted = await chrome.permissions.request({ origins });
        if (!granted) {
          els.btnSaveSettings.textContent = "Permission denied";
          setTimeout(() => (els.btnSaveSettings.textContent = "Save"), 1600);
          return;
        }
      }
    }
  } catch {
    // invalid URL — leave as-is; upload will surface the error
  }

  els.btnSaveSettings.textContent = "Saved ✓";
  setTimeout(() => (els.btnSaveSettings.textContent = "Save"), 1200);
};

// --- init ---
onSessionChanged(render);
loadSession().then((s) => render(s ?? { ...EMPTY_SESSION }));
loadSettings();
