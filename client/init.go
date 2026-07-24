package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type mcpServer struct {
	Command string            `json:"command"`
	Args    []string          `json:"args,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
}
type mcpConfig struct {
	McpServers map[string]mcpServer `json:"mcpServers"`
}

func flagVal(args []string, name string) (string, bool) {
	for i, a := range args {
		if a == name && i+1 < len(args) {
			return args[i+1], true
		}
		if v, ok := strings.CutPrefix(a, name+"="); ok {
			return v, true
		}
	}
	return "", false
}

func hasFlag(args []string, name string) bool {
	for _, a := range args {
		if a == name {
			return true
		}
	}
	return false
}

func runInit(args []string) {
	force := hasFlag(args, "--force")
	token, hasToken := flagVal(args, "--token")
	url, hasURL := flagVal(args, "--url")
	if !hasURL {
		url = defaultDaemonURL
	}
	clientMode := hasToken || hasURL

	self, err := os.Executable()
	if err != nil || self == "" {
		self = "trace2e"
	}

	// 1) .mcp.json (merge — never clobber other servers)
	cfg := mcpConfig{McpServers: map[string]mcpServer{}}
	if b, err := os.ReadFile(".mcp.json"); err == nil {
		if json.Unmarshal(b, &cfg) != nil {
			fmt.Fprintln(os.Stderr, ".mcp.json exists but is not valid JSON — fix or remove it first.")
			os.Exit(1)
		}
		if cfg.McpServers == nil {
			cfg.McpServers = map[string]mcpServer{}
		}
	}
	entry := mcpServer{Command: self, Args: []string{"mcp"}}
	if clientMode {
		entry.Env = map[string]string{"TRACE2E_REMOTE_URL": url}
		if hasToken {
			entry.Env["TRACE2E_TOKEN"] = token
		}
	}
	cfg.McpServers["trace2e"] = entry
	out, _ := json.MarshalIndent(cfg, "", "  ")
	if err := os.WriteFile(".mcp.json", append(out, '\n'), 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "failed to write .mcp.json:", err)
		os.Exit(1)
	}
	suffix := ""
	if clientMode {
		suffix = " → " + url
	}
	fmt.Fprintf(os.Stderr, "[trace2e] wrote .mcp.json (mcpServers.trace2e%s)\n", suffix)

	// 2) .claude/commands/*.md slash commands
	cmdDir := filepath.Join(".claude", "commands")
	commands := map[string]string{
		"trace2e.md":       commandMarkdown,
		"trace2e-debug.md": debugCommandMarkdown,
	}
	for file, content := range commands {
		cmdPath := filepath.Join(cmdDir, file)
		if _, err := os.Stat(cmdPath); err == nil && !force {
			fmt.Fprintf(os.Stderr, "[trace2e] %s already exists — left unchanged (use --force)\n", cmdPath)
			continue
		}
		os.MkdirAll(cmdDir, 0o755)
		if err := os.WriteFile(cmdPath, []byte(content), 0o644); err != nil {
			fmt.Fprintln(os.Stderr, "failed to write command:", err)
			os.Exit(1)
		}
		fmt.Fprintf(os.Stderr, "[trace2e] wrote %s\n", cmdPath)
	}

	fmt.Fprintf(os.Stderr, `
trace2e client is set up in this project (daemon: %s). Next:
  1. Chrome extension: the Daemon URL defaults to %s — just paste your token in Settings.
  2. Record a flow and upload, then in Claude Code run:  /trace2e
`, url, defaultDaemonURL)
}
