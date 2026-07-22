import type { Step } from "@trace2e/schema";
import type { AnyMessage, Session, UploadResult } from "../lib/messages.js";
import { sessionToTrace } from "../lib/messages.js";
import { loadSession, mutateSession, saveSession } from "../lib/session.js";
import { EMPTY_SESSION } from "../lib/messages.js";
import { getSettings } from "../lib/settings.js";

/**
 * Background service worker: the single writer of the recording session. Handles control
 * messages from the side panel and capture messages from content scripts, tracks
 * navigations, captures screenshots, and uploads finished traces to the local daemon.
 */

let lastShot = 0; // captureVisibleTab is rate-limited; throttle to ~2/sec.

async function captureScreenshot(stepId: string): Promise<void> {
  const now = Date.now();
  if (now - lastShot < 500) return;
  lastShot = now;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
    await mutateSession((s) => {
      s.screenshots[stepId] = dataUrl;
    });
  } catch {
    // Tab not capturable (e.g. chrome:// page) — skip silently.
  }
}

async function broadcastState(session: Session): Promise<void> {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    chrome.tabs
      .sendMessage(tab.id, {
        kind: "directive:recording-changed",
        recording: session.recording,
        paused: session.paused,
      })
      .catch(() => {});
  }
}

async function startRecording(name: string): Promise<Session> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const startUrl = tab?.url ?? "";
  const session: Session = {
    ...EMPTY_SESSION,
    recording: true,
    paused: false,
    name,
    startUrl,
    viewport: { width: tab?.width ?? 1280, height: tab?.height ?? 720 },
    steps: startUrl ? [{ id: crypto.randomUUID(), type: "navigate", url: startUrl, ts: Date.now() }] : [],
  };
  await saveSession(session);
  await broadcastState(session);
  return session;
}

async function uploadTrace(): Promise<UploadResult> {
  const session = await loadSession();
  const settings = await getSettings();
  if (!settings.token) return { ok: false, error: "No daemon token set. Open the extension options (⚙) and paste it." };
  const { trace, screenshots } = sessionToTrace(session, settings.projectId || undefined);
  try {
    const res = await fetch(`${settings.daemonUrl}/traces`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.token}` },
      body: JSON.stringify({ trace, screenshots }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = Array.isArray(body.details) ? `: ${body.details.join("; ")}` : "";
      return { ok: false, error: `${body.error ?? `HTTP ${res.status}`}${detail}` };
    }
    return { ok: true, id: body.id };
  } catch (err) {
    return { ok: false, error: `Cannot reach daemon: ${(err as Error).message}` };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

// Track top-frame navigations as explicit navigate steps while recording.
chrome.webNavigation?.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  const session = await loadSession();
  if (!session.recording || session.paused) return;
  if (["reload", "auto_subframe", "form_submit"].includes(details.transitionType)) {
    const last = session.steps[session.steps.length - 1];
    if (last?.type === "navigate" && last.url === details.url) return;
  }
  await mutateSession((s) => {
    s.steps.push({ id: crypto.randomUUID(), type: "navigate", url: details.url, ts: Date.now() });
  });
});

chrome.runtime.onMessage.addListener((msg: AnyMessage & { kind: string }, _sender, sendResponse) => {
  (async () => {
    switch (msg.kind) {
      case "control:query-state": {
        const s = await loadSession();
        sendResponse({ recording: s.recording, paused: s.paused });
        return;
      }
      case "capture:step": {
        const step = (msg as { step: Step }).step;
        await mutateSession((s) => {
          if (!s.recording || s.paused) return;
          s.steps.push(step);
          // A fill can arrive already referencing a variable (auto-masked password/OTP
          // fields). Register it so the trace stays self-consistent for validation.
          if (step.type === "fill" && step.variableRef && !s.variables.some((v) => v.name === step.variableRef)) {
            const name = step.variableRef;
            s.variables.push({ name, kind: "secret", source: name.includes("OTP") ? "generated" : "env" });
          }
        });
        if (step.type === "click") await captureScreenshot(step.id);
        sendResponse({ ok: true });
        return;
      }
      case "control:start": {
        const s = await startRecording((msg as { name: string }).name);
        sendResponse(s);
        return;
      }
      case "control:set-name": {
        const name = (msg as { name: string }).name;
        const s = await mutateSession((x) => {
          x.name = name;
        });
        sendResponse(s);
        return;
      }
      case "control:pause":
      case "control:resume": {
        const s = await mutateSession((x) => {
          x.paused = msg.kind === "control:pause";
        });
        await broadcastState(s);
        sendResponse(s);
        return;
      }
      case "control:stop": {
        const s = await mutateSession((x) => {
          x.recording = false;
          x.paused = false;
        });
        await broadcastState(s);
        sendResponse(s);
        return;
      }
      case "control:reset": {
        await saveSession({ ...EMPTY_SESSION });
        await broadcastState({ ...EMPTY_SESSION });
        sendResponse({ ...EMPTY_SESSION });
        return;
      }
      case "control:add-step": {
        const s = await mutateSession((x) => x.steps.push((msg as { step: Step }).step));
        sendResponse(s);
        return;
      }
      case "control:update-step": {
        const step = (msg as { step: Step }).step;
        const s = await mutateSession((x) => {
          const i = x.steps.findIndex((st) => st.id === step.id);
          if (i >= 0) x.steps[i] = step;
        });
        sendResponse(s);
        return;
      }
      case "control:delete-step": {
        const stepId = (msg as { stepId: string }).stepId;
        const s = await mutateSession((x) => {
          x.steps = x.steps.filter((st) => st.id !== stepId);
          delete x.screenshots[stepId];
        });
        sendResponse(s);
        return;
      }
      case "control:tag-variable": {
        const { stepId, variable } = msg as { stepId: string; variable: import("@trace2e/schema").Variable };
        const s = await mutateSession((x) => {
          if (!x.variables.some((v) => v.name === variable.name)) x.variables.push(variable);
          const step = x.steps.find((st) => st.id === stepId);
          if (step?.type === "fill") {
            delete (step as { value?: string }).value; // drop any captured value
            step.variableRef = variable.name;
          }
        });
        sendResponse(s);
        return;
      }
      case "control:upload": {
        sendResponse(await uploadTrace());
        return;
      }
      case "capture:picked": {
        // Broadcast consumed by the side panel; the background ignores it.
        sendResponse({ ok: true });
        return;
      }
      default:
        sendResponse({ ok: false, error: `unknown message ${msg.kind}` });
    }
  })();
  return true; // keep the message channel open for the async response
});

export default defineBackground(() => {
  // Registration happens via the module-level listeners above.
});
