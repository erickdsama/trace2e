import { TRACE_VERSION, type Step, type Trace, type Variable } from "./trace-model.js";

/**
 * Zero-dependency structural validation for an incoming Trace. Returns a list of human
 * readable error strings; an empty list means the payload is valid. Kept deliberately
 * small — the daemon uses it to reject malformed uploads before persisting.
 */

const VAR_NAME = /^[A-Z][A-Z0-9_]*$/;

const STEP_TYPES = new Set([
  "navigate",
  "click",
  "fill",
  "press",
  "select",
  "upload",
  "waitFor",
  "assert",
  "delay",
  "customJs",
  "hook",
]);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateVariable(v: unknown, i: number, errors: string[]): void {
  if (!isObject(v)) {
    errors.push(`variables[${i}] must be an object`);
    return;
  }
  if (typeof v.name !== "string" || !VAR_NAME.test(v.name)) {
    errors.push(`variables[${i}].name must match ${VAR_NAME} (got ${JSON.stringify(v.name)})`);
  }
  if (v.kind !== "secret" && v.kind !== "data") {
    errors.push(`variables[${i}].kind must be "secret" | "data"`);
  }
  if (v.source !== "env" && v.source !== "fixture" && v.source !== "generated") {
    errors.push(`variables[${i}].source must be "env" | "fixture" | "generated"`);
  }
}

function validateStep(s: unknown, i: number, varNames: Set<string>, errors: string[]): void {
  if (!isObject(s)) {
    errors.push(`steps[${i}] must be an object`);
    return;
  }
  if (typeof s.id !== "string" || s.id.length === 0) {
    errors.push(`steps[${i}].id must be a non-empty string`);
  }
  if (typeof s.type !== "string" || !STEP_TYPES.has(s.type)) {
    errors.push(`steps[${i}].type is invalid: ${JSON.stringify(s.type)}`);
    return;
  }
  if (typeof s.ts !== "number") {
    errors.push(`steps[${i}].ts must be a number`);
  }

  // Secret-leak guard: a fill referencing a secret variable must not also carry a value.
  if (s.type === "fill") {
    const ref = s.variableRef;
    if (ref !== undefined) {
      if (typeof ref !== "string" || !varNames.has(ref)) {
        errors.push(`steps[${i}].variableRef "${String(ref)}" is not a declared variable`);
      }
      if (s.value !== undefined) {
        errors.push(`steps[${i}] has both value and variableRef — secret value must not be captured`);
      }
    } else if (typeof s.value !== "string") {
      errors.push(`steps[${i}] fill must have either value or variableRef`);
    }
  }

  if (s.type === "navigate" && typeof s.url !== "string") {
    errors.push(`steps[${i}] navigate must have a url`);
  }
  if ((s.type === "customJs" || s.type === "hook") && typeof s.code !== "string") {
    errors.push(`steps[${i}] ${s.type} must have code`);
  }
  if (s.type === "delay" && (typeof s.ms !== "number" || s.ms < 0)) {
    errors.push(`steps[${i}] delay must have a non-negative ms number`);
  }
}

export function validateTrace(input: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!isObject(input)) {
    return { valid: false, errors: ["trace must be an object"] };
  }
  if (input.version !== TRACE_VERSION) {
    errors.push(`version must be ${TRACE_VERSION}`);
  }
  if (typeof input.name !== "string" || input.name.length === 0) {
    errors.push("name must be a non-empty string");
  }
  if (typeof input.startUrl !== "string") {
    errors.push("startUrl must be a string");
  }
  if (!isObject(input.viewport) || typeof input.viewport.width !== "number" || typeof input.viewport.height !== "number") {
    errors.push("viewport must be { width:number, height:number }");
  }

  const variables = Array.isArray(input.variables) ? (input.variables as unknown[]) : [];
  if (!Array.isArray(input.variables)) {
    errors.push("variables must be an array");
  }
  variables.forEach((v, i) => validateVariable(v, i, errors));

  const varNames = new Set<string>(
    variables.filter((v): v is Variable => isObject(v) && typeof (v as any).name === "string").map((v) => v.name),
  );

  if (!Array.isArray(input.steps)) {
    errors.push("steps must be an array");
  } else {
    (input.steps as unknown[]).forEach((s, i) => validateStep(s, i, varNames, errors));
  }

  if (input.screenshots !== undefined && !isObject(input.screenshots)) {
    errors.push("screenshots must be an object map");
  }

  return { valid: errors.length === 0, errors };
}

/** Narrowing helper used by the daemon after validateTrace passes. */
export function asTrace(input: unknown): Trace {
  return input as Trace;
}

export type { Step };
