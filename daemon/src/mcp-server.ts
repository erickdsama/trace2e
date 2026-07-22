import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { backend, backendMode } from "./backend.js";

/**
 * MCP server (stdio) exposing the trace store to Claude Code. Reads from the local
 * filesystem, or from a hosted daemon when TRACE2E_REMOTE_URL is set (see backend.ts).
 * All logging goes to stderr — stdout is reserved for the MCP protocol.
 */
export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "trace2e", version: "0.1.0" });

  server.tool(
    "list_traces",
    "List recorded traces (most recent first) with id, name, createdAt and step count.",
    {
      project: z
        .string()
        .optional()
        .describe('Filter by project id or name; "none" lists traces with no project'),
    },
    async ({ project }) => ({
      content: [{ type: "text", text: JSON.stringify(await backend.list(project), null, 2) }],
    }),
  );

  server.tool(
    "get_trace",
    "Get a full trace by id. Omit id to get the most recently recorded trace.",
    { id: z.string().optional().describe("Trace id; defaults to the latest trace") },
    async ({ id }) => {
      const trace = await backend.get(id);
      if (!trace) return { isError: true, content: [{ type: "text", text: "No trace found." }] };
      return { content: [{ type: "text", text: JSON.stringify(trace, null, 2) }] };
    },
  );

  server.tool(
    "get_screenshots",
    "Get the screenshots for a trace as images, keyed by the step id they belong to.",
    { id: z.string().describe("Trace id") },
    async ({ id }) => {
      const shots = await backend.screenshots(id);
      const content: Array<
        { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
      > = [];
      for (const [stepId, base64] of Object.entries(shots)) {
        content.push({ type: "text", text: `step ${stepId}` });
        content.push({ type: "image", data: base64, mimeType: "image/png" });
      }
      if (content.length === 0) content.push({ type: "text", text: "No screenshots for this trace." });
      return { content };
    },
  );

  server.tool(
    "delete_trace",
    "Delete a trace and its screenshots by id.",
    { id: z.string().describe("Trace id") },
    async ({ id }) => {
      const ok = await backend.delete(id);
      return { content: [{ type: "text", text: ok ? `Deleted ${id}` : `Not found: ${id}` }] };
    },
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[trace2e] MCP server ready on stdio — backend: ${backendMode}`);
}
