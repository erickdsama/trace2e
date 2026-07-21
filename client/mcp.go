package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
)

// Minimal MCP server over stdio: newline-delimited JSON-RPC. Exposes the trace tools by
// proxying to the daemon's HTTP API.

type rpcReq struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

func runMCP() {
	in := bufio.NewReaderSize(os.Stdin, 1<<20)
	out := bufio.NewWriter(os.Stdout)
	dec := json.NewDecoder(in)
	for {
		var req rpcReq
		if err := dec.Decode(&req); err != nil {
			return // EOF or parse end — the client closed stdin
		}
		// Notifications (no id) get no response.
		isNotification := len(req.ID) == 0 || string(req.ID) == "null"
		switch req.Method {
		case "initialize":
			var p struct {
				ProtocolVersion string `json:"protocolVersion"`
			}
			json.Unmarshal(req.Params, &p)
			pv := p.ProtocolVersion
			if pv == "" {
				pv = mcpProtocolFallbk
			}
			reply(out, req.ID, map[string]any{
				"protocolVersion": pv,
				"capabilities":    map[string]any{"tools": map[string]any{}},
				"serverInfo":      map[string]any{"name": "trace2e", "version": version},
			})
		case "tools/list":
			reply(out, req.ID, map[string]any{"tools": toolList()})
		case "tools/call":
			handleToolCall(out, req)
		default:
			if !isNotification {
				replyErr(out, req.ID, -32601, "method not found: "+req.Method)
			}
		}
	}
}

func write(out *bufio.Writer, v any) {
	b, _ := json.Marshal(v)
	out.Write(b)
	out.WriteByte('\n')
	out.Flush()
}
func reply(out *bufio.Writer, id json.RawMessage, result any) {
	write(out, map[string]any{"jsonrpc": "2.0", "id": rawOrNull(id), "result": result})
}
func replyErr(out *bufio.Writer, id json.RawMessage, code int, msg string) {
	write(out, map[string]any{"jsonrpc": "2.0", "id": rawOrNull(id), "error": map[string]any{"code": code, "message": msg}})
}
func rawOrNull(id json.RawMessage) any {
	if len(id) == 0 {
		return nil
	}
	return id
}

func strObj(desc string) map[string]any {
	return map[string]any{"type": "string", "description": desc}
}

func toolList() []map[string]any {
	idProp := map[string]any{"id": strObj("Trace id")}
	return []map[string]any{
		{"name": "list_traces", "description": "List recorded traces (most recent first).",
			"inputSchema": map[string]any{"type": "object", "properties": map[string]any{}}},
		{"name": "get_trace", "description": "Get a full trace by id; omit id for the latest.",
			"inputSchema": map[string]any{"type": "object", "properties": map[string]any{"id": strObj("Trace id; defaults to latest")}}},
		{"name": "get_screenshots", "description": "Get a trace's screenshots as images, keyed by step id.",
			"inputSchema": map[string]any{"type": "object", "properties": idProp, "required": []string{"id"}}},
		{"name": "delete_trace", "description": "Delete a trace by id.",
			"inputSchema": map[string]any{"type": "object", "properties": idProp, "required": []string{"id"}}},
	}
}

func textContent(s string) map[string]any { return map[string]any{"type": "text", "text": s} }

func handleToolCall(out *bufio.Writer, req rpcReq) {
	var p struct {
		Name string          `json:"name"`
		Args map[string]any  `json:"arguments"`
	}
	json.Unmarshal(req.Params, &p)
	id, _ := p.Args["id"].(string)

	toolErr := func(msg string) {
		reply(out, req.ID, map[string]any{"isError": true, "content": []map[string]any{textContent(msg)}})
	}

	switch p.Name {
	case "list_traces":
		body, code, err := daemonGET("/traces")
		if err != nil {
			toolErr("cannot reach daemon: " + err.Error())
			return
		}
		if code != 200 {
			toolErr(fmt.Sprintf("daemon returned %d%s", code, hint(code)))
			return
		}
		reply(out, req.ID, map[string]any{"content": []map[string]any{textContent(string(body))}})
	case "get_trace":
		key := id
		if key == "" {
			key = "latest"
		}
		body, code, err := daemonGET("/traces/" + key)
		if err != nil {
			toolErr("cannot reach daemon: " + err.Error())
			return
		}
		if code == 404 {
			toolErr("No trace found.")
			return
		}
		if code != 200 {
			toolErr(fmt.Sprintf("daemon returned %d%s", code, hint(code)))
			return
		}
		reply(out, req.ID, map[string]any{"content": []map[string]any{textContent(string(body))}})
	case "get_screenshots":
		body, code, err := daemonGET("/traces/" + id + "/screenshots")
		if err != nil || code != 200 {
			toolErr("could not fetch screenshots")
			return
		}
		var shots map[string]string
		json.Unmarshal(body, &shots)
		content := []map[string]any{}
		for step, b64 := range shots {
			content = append(content, textContent("step "+step))
			content = append(content, map[string]any{"type": "image", "data": b64, "mimeType": "image/png"})
		}
		if len(content) == 0 {
			content = append(content, textContent("No screenshots for this trace."))
		}
		reply(out, req.ID, map[string]any{"content": content})
	case "delete_trace":
		code, err := daemonDELETE("/traces/" + id)
		if err != nil {
			toolErr("cannot reach daemon: " + err.Error())
			return
		}
		msg := "Deleted " + id
		if code != 200 {
			msg = fmt.Sprintf("delete returned %d", code)
		}
		reply(out, req.ID, map[string]any{"content": []map[string]any{textContent(msg)}})
	default:
		replyErr(out, req.ID, -32602, "unknown tool: "+p.Name)
	}
}
