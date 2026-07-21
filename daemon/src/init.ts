import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `trace2e init` — scaffold trace2e into the current project so Claude Code can generate
 * Playwright tests from recordings:
 *   - .mcp.json          registers the local `trace2e mcp` server (merged if it exists)
 *   - .claude/commands/trace2e.md   the /trace2e slash command
 *
 * Existing files are never clobbered: .mcp.json is merged, and the command file is only
 * written if absent (unless --force).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
// dist/init.js → package root → templates/
const TEMPLATE_DIR = join(HERE, "..", "templates");

interface McpConfig {
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
}

export type InitMode = "global" | "npx" | "self";

/**
 * How Claude Code should launch the MCP server.
 *  - global: a `trace2e` binary on PATH (after npm i -g / npm link)
 *  - npx:    npx -y @trace2e/daemon mcp
 *  - self:   node <this exact bundle> mcp — for the zero-install portable distribution
 */
function mcpServerEntry(mode: InitMode, selfPath?: string): McpConfig["mcpServers"] {
  if (mode === "npx") return { trace2e: { command: "npx", args: ["-y", "@trace2e/daemon", "mcp"] } };
  if (mode === "self" && selfPath) return { trace2e: { command: "node", args: [selfPath, "mcp"] } };
  return { trace2e: { command: "trace2e", args: ["mcp"] } };
}

export async function runInit(
  cwd: string,
  opts: { force?: boolean; mode?: InitMode; selfPath?: string } = {},
): Promise<void> {
  const mode = opts.mode ?? "global";

  // 1) .mcp.json (merge, don't clobber other servers)
  const mcpPath = join(cwd, ".mcp.json");
  let config: McpConfig = {};
  if (existsSync(mcpPath)) {
    try {
      config = JSON.parse(await readFile(mcpPath, "utf8"));
    } catch {
      throw new Error(`.mcp.json exists but is not valid JSON — fix or remove it first.`);
    }
  }
  config.mcpServers = { ...config.mcpServers, ...mcpServerEntry(mode, opts.selfPath) };
  await writeFile(mcpPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  console.error(`[trace2e] wrote ${mcpPath} (mcpServers.trace2e)`);

  // 2) .claude/commands/trace2e.md
  const cmdDir = join(cwd, ".claude", "commands");
  const cmdPath = join(cmdDir, "trace2e.md");
  if (existsSync(cmdPath) && !opts.force) {
    console.error(`[trace2e] ${cmdPath} already exists — left unchanged (use --force to overwrite)`);
  } else {
    await mkdir(cmdDir, { recursive: true });
    await writeFile(cmdPath, await readFile(join(TEMPLATE_DIR, "trace2e.md"), "utf8"), "utf8");
    console.error(`[trace2e] wrote ${cmdPath}`);
  }

  console.error(
    [
      "",
      "trace2e is set up in this project. Next:",
      "  1. Start recording infra:   trace2e serve      (leave running while you record)",
      "  2. In the Chrome extension, paste the token from:   trace2e token",
      "  3. Record a flow and upload, then in Claude Code run:   /trace2e",
      "",
    ].join("\n"),
  );
}
