import type { LocatorCandidates } from "@trace2e/schema";

/**
 * Generate ranked Playwright locator candidates for a DOM element, following Playwright's
 * recommended priority: test-id → role+name → label → placeholder → text → scoped CSS.
 * Runs in the content script (isolated world) with full DOM access.
 */

const TESTID_ATTRS = ["data-testid", "data-test-id", "data-test", "data-qa"];

function quote(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function accessibleName(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.trim();
  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby) {
    const ref = document.getElementById(labelledby);
    if (ref?.textContent) return ref.textContent.trim();
  }
  const text = (el as HTMLElement).innerText?.trim();
  if (text && text.length <= 80) return text;
  // A control's *value* is transient user data, not its identity — only use it as the
  // accessible name for button-like inputs, where the value attribute IS the label.
  if (el.tagName === "INPUT") {
    const input = el as HTMLInputElement;
    if (["submit", "button", "reset"].includes(input.type) && input.value) return input.value.trim();
  }
  const title = el.getAttribute("title");
  if (title) return title.trim();
  return "";
}

function associatedLabel(el: Element): string {
  const id = el.getAttribute("id");
  if (id) {
    const label = document.querySelector(`label[for=${CSS.escape(id)}]`);
    if (label?.textContent) return label.textContent.trim();
  }
  const parentLabel = el.closest("label");
  if (parentLabel?.textContent) return parentLabel.textContent.trim();
  return "";
}

function implicitRole(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;
  switch (tag) {
    case "a":
      return el.hasAttribute("href") ? "link" : null;
    case "button":
      return "button";
    case "select":
      return "combobox";
    case "textarea":
      return "textbox";
    case "input": {
      const type = (el as HTMLInputElement).type;
      if (["submit", "button", "reset"].includes(type)) return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (["text", "email", "search", "tel", "url", "password"].includes(type)) return "textbox";
      return "textbox";
    }
    default:
      return null;
  }
}

function cssPath(el: Element): string {
  // Short, stable-ish CSS fallback: prefer id, else tag + nth-of-type chain (bounded depth).
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (node && node.nodeType === 1 && depth < 4) {
    const current: Element = node;
    let sel = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === current.tagName);
      if (sameTag.length > 1) {
        sel += `:nth-of-type(${sameTag.indexOf(current) + 1})`;
      }
    }
    parts.unshift(sel);
    if (current.id) {
      parts[0] = `#${CSS.escape(current.id)}`;
      break;
    }
    node = parent;
    depth++;
  }
  return parts.join(" > ");
}

/** Locator chain to reach the enclosing iframe, if any. Returns undefined for top frame. */
function framePath(): string | undefined {
  if (window.top === window.self) return undefined;
  try {
    const frameEl = window.frameElement;
    if (frameEl) {
      const src = frameEl.getAttribute("src");
      if (src) return `frameLocator(${quote(src)})`;
      const name = frameEl.getAttribute("name");
      if (name) return `frameLocator(${quote(`iframe[name=${name}]`)})`;
    }
  } catch {
    // Cross-origin frame: fall back to a generic selector.
  }
  return "frameLocator('iframe')";
}

export function buildLocator(el: Element): LocatorCandidates {
  const candidates: string[] = [];

  for (const attr of TESTID_ATTRS) {
    const v = el.getAttribute(attr);
    if (v) candidates.push(`getByTestId(${quote(v)})`);
  }

  const role = implicitRole(el);
  const name = accessibleName(el);
  if (role && name) candidates.push(`getByRole(${quote(role)}, { name: ${quote(name)} })`);

  const label = associatedLabel(el);
  if (label) candidates.push(`getByLabel(${quote(label)})`);

  const placeholder = el.getAttribute("placeholder");
  if (placeholder) candidates.push(`getByPlaceholder(${quote(placeholder)})`);

  if (role === "textbox" || role === "combobox" || el.tagName === "INPUT") {
    const nameAttr = el.getAttribute("name");
    if (nameAttr) candidates.push(`locator(${quote(`[name=${quote(nameAttr).slice(1, -1)}]`)})`);
  }

  if (!role && name && name.length <= 40) candidates.push(`getByText(${quote(name)})`);

  candidates.push(`locator(${quote(cssPath(el))})`);

  const unique = [...new Set(candidates)];
  const description = `<${el.tagName.toLowerCase()}${role ? ` role=${role}` : ""}${
    name ? ` "${name.slice(0, 40)}"` : ""
  }>`;

  return {
    primary: unique[0],
    fallbacks: unique.slice(1),
    frame: framePath(),
    description,
  };
}
