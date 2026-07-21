import type { Step } from "@trace2e/schema";
import { buildLocator } from "../lib/selector-engine.js";
import type { CaptureMessage, DirectiveMessage } from "../lib/messages.js";

/**
 * Recorder content script. Attaches capturing-phase listeners and translates DOM events
 * into trace Steps, which it forwards to the background worker. Debounces consecutive
 * typing in one field into a single `fill` step. Never sends the value of a password /
 * autocomplete-sensitive field — those become a variable placeholder instead.
 */
export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  allFrames: true,
  main() {
    let recording = false;
    let paused = false;
    let picking = false;

    // Sync initial state + subscribe to changes from the side panel.
    chrome.runtime.sendMessage({ kind: "control:query-state" }).then(
      (s?: { recording: boolean; paused: boolean }) => {
        if (s) ({ recording, paused } = s);
      },
      () => {},
    );
    chrome.runtime.onMessage.addListener((msg: DirectiveMessage) => {
      if (msg.kind === "directive:recording-changed") {
        recording = msg.recording;
        paused = msg.paused;
      } else if (msg.kind === "directive:start-pick") {
        startPick();
      } else if (msg.kind === "directive:cancel-pick") {
        stopPick();
      }
    });

    // Recording is suppressed while picking so the pick click isn't captured as a step.
    const active = () => recording && !paused && !picking;
    const uid = () => crypto.randomUUID();
    const send = (step: Step) => {
      const m: CaptureMessage = { kind: "capture:step", step };
      chrome.runtime.sendMessage(m).catch(() => {});
    };

    // --- typing debounce state ---
    let pendingTarget: Element | null = null;
    let pendingTimer: number | undefined;

    function isSensitive(el: Element): boolean {
      if (el.tagName !== "INPUT") return false;
      const input = el as HTMLInputElement;
      if (input.type === "password") return true;
      const ac = (input.autocomplete || "").toLowerCase();
      return ["current-password", "new-password", "one-time-code"].includes(ac);
    }

    function suggestVarName(el: Element): string {
      const input = el as HTMLInputElement;
      const hint = (input.name || input.id || input.autocomplete || "SECRET")
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .toUpperCase()
        .replace(/^_+|_+$/g, "");
      if (input.type === "password") return hint.includes("PASS") ? hint : "PASSWORD";
      if ((input.autocomplete || "").toLowerCase() === "one-time-code") return "OTP";
      return hint || "SECRET";
    }

    function flushPending() {
      if (!pendingTarget) return;
      const el = pendingTarget;
      pendingTarget = null;
      const input = el as HTMLInputElement;
      const target = buildLocator(el);
      if (isSensitive(el)) {
        // Never capture the typed secret; emit a placeholder the side panel can name.
        send({ id: uid(), type: "fill", target, variableRef: suggestVarName(el), ts: Date.now() });
      } else {
        send({ id: uid(), type: "fill", target, value: input.value ?? "", ts: Date.now() });
      }
    }

    function scheduleFlush(el: Element) {
      if (pendingTarget && pendingTarget !== el) flushPending();
      pendingTarget = el;
      window.clearTimeout(pendingTimer);
      pendingTimer = window.setTimeout(flushPending, 600);
    }

    document.addEventListener(
      "input",
      (e) => {
        if (!active()) return;
        const el = e.target as Element;
        if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) scheduleFlush(el);
      },
      true,
    );

    document.addEventListener(
      "click",
      (e) => {
        if (!active()) return;
        flushPending();
        const el = e.target as Element;
        if (!el || el.nodeType !== 1) return;
        // Fill steps already cover typing into inputs; ignore clicks that only focus them.
        if (el.tagName === "INPUT" && ["text", "email", "password", "search"].includes((el as HTMLInputElement).type)) {
          return;
        }
        send({ id: uid(), type: "click", target: buildLocator(el), ts: Date.now() });
      },
      true,
    );

    document.addEventListener(
      "change",
      (e) => {
        if (!active()) return;
        const el = e.target as Element;
        if (el?.tagName === "SELECT") {
          const sel = el as HTMLSelectElement;
          send({
            id: uid(),
            type: "select",
            target: buildLocator(el),
            value: sel.value,
            label: sel.selectedOptions[0]?.text,
            ts: Date.now(),
          });
        }
      },
      true,
    );

    document.addEventListener(
      "keydown",
      (e) => {
        if (!active()) return;
        // Record only meaningful non-text keys (Enter/Tab/Escape/arrows).
        const special = ["Enter", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
        if (special.includes(e.key)) {
          flushPending();
          const el = e.target as Element;
          send({ id: uid(), type: "press", key: e.key, target: el?.nodeType === 1 ? buildLocator(el) : undefined, ts: Date.now() });
        }
      },
      true,
    );

    window.addEventListener("beforeunload", flushPending);

    // --- element picker (for assertions, waits, and re-targeting a step) ---
    let overlay: HTMLDivElement | null = null;

    function ensureOverlay(): HTMLDivElement {
      if (overlay) return overlay;
      overlay = document.createElement("div");
      Object.assign(overlay.style, {
        position: "fixed",
        zIndex: "2147483647",
        pointerEvents: "none",
        border: "2px solid #2563eb",
        background: "rgba(37,99,235,0.15)",
        borderRadius: "3px",
        boxShadow: "0 0 0 1px rgba(255,255,255,.6)",
        display: "none",
      });
      (document.body || document.documentElement).appendChild(overlay);
      return overlay;
    }

    function moveOverlay(el: Element): void {
      const o = ensureOverlay();
      const r = el.getBoundingClientRect();
      Object.assign(o.style, {
        display: "block",
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
    }

    function elementText(el: Element): string {
      const raw =
        (el as HTMLElement).innerText?.trim() ||
        el.getAttribute("aria-label") ||
        (el as HTMLInputElement).value ||
        "";
      return raw.replace(/\s+/g, " ").slice(0, 200);
    }

    const onPickMove = (e: MouseEvent) => {
      const el = e.target as Element;
      if (el && el.nodeType === 1 && el !== overlay) moveOverlay(el);
    };
    const onPickClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const el = e.target as Element;
      if (!el || el.nodeType !== 1) return;
      const msg: CaptureMessage = {
        kind: "capture:picked",
        locator: buildLocator(el),
        text: elementText(el),
        url: location.href,
      };
      chrome.runtime.sendMessage(msg).catch(() => {});
      stopPick();
    };
    const onPickKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        stopPick();
      }
    };

    function startPick(): void {
      if (picking) return;
      picking = true;
      document.addEventListener("mousemove", onPickMove, true);
      document.addEventListener("click", onPickClick, true);
      document.addEventListener("keydown", onPickKey, true);
      if (document.body) document.body.style.cursor = "crosshair";
    }
    function stopPick(): void {
      if (!picking) return;
      picking = false;
      document.removeEventListener("mousemove", onPickMove, true);
      document.removeEventListener("click", onPickClick, true);
      document.removeEventListener("keydown", onPickKey, true);
      if (overlay) overlay.style.display = "none";
      if (document.body) document.body.style.cursor = "";
    }
  },
});
