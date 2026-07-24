import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { argv, execPath } from "node:process";
import { TRACE2E_COMMAND_MD, TRACE2E_DEBUG_COMMAND_MD } from "./embedded.js";

/**
 * `trace2e init` — scaffold trace2e into the current project so Claude Code can generate
 * Playwright tests from recordings:
 *   - .mcp.json          registers the local `trace2e mcp` server (merged if it exists)
 *   - .claude/commands/trace2e.md         the /trace2e slash command (generate tests)
 *   - .claude/commands/trace2e-debug.md   the /trace2e-debug slash command (replay a
 *                                         recorded flow with Playwright to diagnose a bug)
 *
 * Existing files are never clobbered: .mcp.json is merged, and the command file is only
 * written if absent (unless --force).
 */

interface McpConfig {
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
}

export type InitMode = "global" | "npx" | "self";

/**
 * How Claude Code should launch the MCP server.
 *  - global: a `trace2e` binary/link on PATH
 *  - npx:    npx -y @trace2e/daemon mcp
 *  - self:   this exact executable — a compiled binary (command = the binary), or the
 *            portable Node bundle (command = node, arg = the .mjs). Detected via execPath.
 */
function mcpServerEntry(mode: InitMode, selfPath?: string): McpConfig["mcpServers"] {
  if (mode === "npx") return { trace2e: { command: "npx", args: ["-y", "@trace2e/daemon", "mcp"] } };
  if (mode === "self") {
    const exec = basename(execPath).toLowerCase();
    const underNode = exec === "node" || exec === "node.exe";
    return underNode
      ? { trace2e: { command: "node", args: [selfPath ?? argv[1], "mcp"] } } // portable .mjs bundle
      : { trace2e: { command: execPath, args: ["mcp"] } }; // compiled SEA binary
  }
  return { trace2e: { command: "trace2e", args: ["mcp"] } };
}

/** Default hosted daemon — so a client only needs to supply a token. */
export const DEFAULT_DAEMON_URL = "https://trace2e.novaminds.xyz";

export async function runInit(
  cwd: string,
  opts: {
    force?: boolean;
    mode?: InitMode;
    selfPath?: string;
    /** Client mode: point the MCP server at a hosted daemon (default DEFAULT_DAEMON_URL). */
    remoteUrl?: string;
    token?: string;
  } = {},
): Promise<void> {
  const mode = opts.mode ?? "global";
  const clientMode = opts.remoteUrl !== undefined || opts.token !== undefined;
  const remoteUrl = opts.remoteUrl || DEFAULT_DAEMON_URL;

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
  const entry = mcpServerEntry(mode, opts.selfPath)!;
  if (clientMode) {
    // Point the MCP server at the hosted daemon so /trace2e reads traces from it.
    entry.trace2e.env = { TRACE2E_REMOTE_URL: remoteUrl, ...(opts.token ? { TRACE2E_TOKEN: opts.token } : {}) };
  }
  config.mcpServers = { ...config.mcpServers, ...entry };
  await writeFile(mcpPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  console.error(`[trace2e] wrote ${mcpPath} (mcpServers.trace2e${clientMode ? " → " + remoteUrl : ""})`);

  // 2) .claude/commands/*.md slash commands
  const cmdDir = join(cwd, ".claude", "commands");
  const commands: Array<[string, string]> = [
    ["trace2e.md", TRACE2E_COMMAND_MD],
    ["trace2e-debug.md", TRACE2E_DEBUG_COMMAND_MD],
  ];
  for (const [file, content] of commands) {
    const cmdPath = join(cmdDir, file);
    if (existsSync(cmdPath) && !opts.force) {
      console.error(`[trace2e] ${cmdPath} already exists — left unchanged (use --force to overwrite)`);
    } else {
      await mkdir(cmdDir, { recursive: true });
      await writeFile(cmdPath, content, "utf8");
      console.error(`[trace2e] wrote ${cmdPath}`);
    }
  }

  const next = clientMode
    ? [
        "",
        `trace2e client set up in this project (daemon: ${remoteUrl}). Next:`,
        `  1. In the Chrome extension, the Daemon URL defaults to ${DEFAULT_DAEMON_URL} —`,
        "     just paste your token in Settings.",
        "  2. Record a flow and upload, then in Claude Code run:   /trace2e",
        "",
      ]
    : [
        "",
        "trace2e is set up in this project. Next:",
        "  1. Start recording infra:   trace2e serve      (leave running while you record)",
        "  2. In the Chrome extension, paste the token from:   trace2e token",
        "  3. Record a flow and upload, then in Claude Code run:   /trace2e",
        "",
      ];
  console.error(next.join("\n"));
}
