/**
 * The trace-2-e2e data model. This is the contract between the Chrome extension
 * (producer), the daemon (validator/store), and the Claude Code generator (consumer).
 *
 * Invariant: secret values NEVER appear in a Trace. Fields tagged as variables carry a
 * `variableRef` pointing at a Variable name; the real value is never captured.
 */

export const TRACE_VERSION = 1 as const;

export type VariableKind = "secret" | "data";
export type VariableSource = "env" | "fixture" | "generated";

export interface Variable {
  /** Uppercase identifier, e.g. USERNAME, PASSWORD, OTP. Used as {{NAME}} placeholder. */
  name: string;
  kind: VariableKind;
  source: VariableSource;
  note?: string;
}

/**
 * Ranked Playwright locator candidates for a target element. `primary` is the best
 * guess; the generator may add `fallbacks` as resilient alternatives.
 * Each entry is a Playwright locator expression string, e.g.
 *   getByRole('button', { name: 'Sign in' })
 */
export interface LocatorCandidates {
  primary: string;
  fallbacks: string[];
  /** Locator chain to reach the enclosing iframe, if the element lives in a frame. */
  frame?: string;
  /** Human-readable description for comments in generated code. */
  description?: string;
}

export type AssertKind = "text" | "visible" | "hidden" | "url" | "value" | "count";

export type Step =
  | { id: string; type: "navigate"; url: string; ts: number }
  | { id: string; type: "click"; target: LocatorCandidates; screenshotRef?: string; ts: number }
  | {
      id: string;
      type: "fill";
      target: LocatorCandidates;
      /** Literal value for non-sensitive input. Absent when variableRef is set. */
      value?: string;
      /** Name of a Variable; replaces value for tagged/sensitive fields. */
      variableRef?: string;
      ts: number;
    }
  | { id: string; type: "press"; key: string; target?: LocatorCandidates; ts: number }
  | { id: string; type: "select"; target: LocatorCandidates; value: string; label?: string; ts: number }
  | { id: string; type: "upload"; target: LocatorCandidates; files: string[]; ts: number }
  | {
      id: string;
      type: "waitFor";
      target?: LocatorCandidates;
      url?: string;
      state?: "visible" | "hidden" | "attached" | "detached";
      ts: number;
    }
  | {
      id: string;
      type: "assert";
      kind: AssertKind;
      target?: LocatorCandidates;
      expected?: string | number | boolean;
      ts: number;
    }
  /** Fixed pause in milliseconds (maps to page.waitForTimeout). Use sparingly. */
  | { id: string; type: "delay"; ms: number; ts: number }
  /** Arbitrary JS run in the page's main world (page.evaluate). Operator-authored. */
  | { id: string; type: "customJs"; code: string; awaitResult?: boolean; ts: number }
  /** Node/test-context setup or teardown, e.g. reset DB, fetch OTP. Operator-authored. */
  | { id: string; type: "hook"; phase: "before" | "after"; code: string; ts: number };

export type StepType = Step["type"];

export interface Trace {
  version: typeof TRACE_VERSION;
  /** Assigned by the daemon on ingest. The extension may send a temporary id. */
  id: string;
  /** Flow name, e.g. "login-with-otp". kebab-case recommended. */
  name: string;
  /** ISO-8601, stamped by the daemon on ingest. */
  createdAt: string;
  startUrl: string;
  viewport: { width: number; height: number };
  variables: Variable[];
  steps: Step[];
  /** Maps a step id to a screenshot filename stored alongside the trace. */
  screenshots: Record<string, string>;
}

/** Lightweight summary returned by list_traces. */
export interface TraceSummary {
  id: string;
  name: string;
  createdAt: string;
  stepCount: number;
}
