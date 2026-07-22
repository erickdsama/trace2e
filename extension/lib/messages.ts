import type { LocatorCandidates, Step, Trace, Variable } from "@trace2e/schema";

/** Recording session held in chrome.storage.local while a flow is being captured. */
export interface Session {
  recording: boolean;
  paused: boolean;
  name: string;
  startUrl: string;
  viewport: { width: number; height: number };
  variables: Variable[];
  steps: Step[];
  /** stepId -> data URL (PNG). Kept separate from steps; uploaded as an envelope field. */
  screenshots: Record<string, string>;
}

export const EMPTY_SESSION: Session = {
  recording: false,
  paused: false,
  name: "",
  startUrl: "",
  viewport: { width: 0, height: 0 },
  variables: [],
  steps: [],
  screenshots: {},
};

/** what the operator wants to do with the next picked element */
export type PickPurpose =
  | { action: "assert-visible" }
  | { action: "assert-text" }
  | { action: "wait-visible" }
  | { action: "retarget"; stepId: string };

/** content script → background/side panel (broadcast) */
export type CaptureMessage =
  | { kind: "capture:step"; step: Step }
  | { kind: "capture:screenshot-request"; stepId: string }
  /** result of an element pick: ranked locator + the element's visible text and page URL */
  | { kind: "capture:picked"; locator: LocatorCandidates; text: string; url: string };

/** content script or side panel → background */
export type ControlMessage =
  | { kind: "control:query-state" }
  | { kind: "control:start"; name: string }
  | { kind: "control:set-name"; name: string }
  | { kind: "control:pause" }
  | { kind: "control:resume" }
  | { kind: "control:stop" }
  | { kind: "control:reset" }
  | { kind: "control:add-step"; step: Step }
  | { kind: "control:update-step"; step: Step }
  | { kind: "control:delete-step"; stepId: string }
  | { kind: "control:tag-variable"; stepId: string; variable: Variable }
  | { kind: "control:upload" };

/** background/side panel → content script */
export type DirectiveMessage =
  | { kind: "directive:recording-changed"; recording: boolean; paused: boolean }
  | { kind: "directive:start-pick" }
  | { kind: "directive:cancel-pick" };

export type AnyMessage = CaptureMessage | ControlMessage | DirectiveMessage;

export interface UploadResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/** Build the final Trace envelope from a finished session. */
export function sessionToTrace(
  session: Session,
  projectId?: string,
): { trace: Trace; screenshots: Record<string, string> } {
  // Reconcile: guarantee every variableRef used by a step has a declaration. This is a
  // safety net so a dropped/racy variable registration can never yield an "invalid trace".
  const variables: Variable[] = [...session.variables];
  const declared = new Set(variables.map((v) => v.name));
  for (const step of session.steps) {
    if (step.type === "fill" && step.variableRef && !declared.has(step.variableRef)) {
      declared.add(step.variableRef);
      variables.push({
        name: step.variableRef,
        kind: "secret",
        source: step.variableRef.includes("OTP") ? "generated" : "env",
      });
    }
  }
  const trace: Trace = {
    version: 1,
    id: "pending",
    name: session.name || "recorded-flow",
    createdAt: "",
    startUrl: session.startUrl,
    viewport: session.viewport,
    variables,
    steps: session.steps,
    screenshots: {},
  };
  if (projectId) trace.projectId = projectId;
  return { trace, screenshots: session.screenshots };
}
