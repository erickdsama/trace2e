// trace2e — lightweight client. Two jobs:
//   init  — scaffold .mcp.json + the /trace2e command into a project (points at a daemon)
//   mcp   — an MCP stdio server that proxies trace reads to the daemon's HTTP API
//
// Static Go binary: small (~6 MB) and cross-compiles to every platform. The daemon itself
// stays a separate service (Node/container); this is only the client.
package main

import (
	_ "embed"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

//go:embed trace2e.md
var commandMarkdown string

//go:embed trace2e-debug.md
var debugCommandMarkdown string

const (
	version           = "0.2.0"
	defaultDaemonURL  = "https://trace2e.novaminds.xyz"
	mcpProtocolFallbk = "2024-11-05"
)

func main() {
	args := os.Args[1:]
	cmd := "help"
	if len(args) > 0 {
		cmd = args[0]
		args = args[1:]
	}
	switch cmd {
	case "init":
		runInit(args)
	case "mcp":
		runMCP()
	case "list":
		runList()
	case "version", "--version", "-v":
		fmt.Println("trace2e " + version)
	default:
		printHelp()
	}
}

func printHelp() {
	fmt.Print(`trace2e — record browser flows, generate Playwright tests via Claude Code (client)

Usage:
  trace2e init [--token <t>] [--url <daemon>] [--force]
        Scaffold .mcp.json + the /trace2e command into the current project.
        Points the MCP server at the daemon (URL defaults to the shared one).
  trace2e mcp          Run the MCP server on stdio (what Claude Code launches).
  trace2e list         List traces on the daemon.
  trace2e version

Env (for mcp/list):
  TRACE2E_REMOTE_URL   daemon base URL   (default ` + defaultDaemonURL + `)
  TRACE2E_TOKEN        access token
`)
}

// ---------- shared HTTP helpers ----------

func daemonBase() string {
	if u := strings.TrimRight(os.Getenv("TRACE2E_REMOTE_URL"), "/"); u != "" {
		return u
	}
	return defaultDaemonURL
}

func daemonGET(path string) ([]byte, int, error) {
	req, _ := http.NewRequest("GET", daemonBase()+path, nil)
	req.Header.Set("Authorization", "Bearer "+os.Getenv("TRACE2E_TOKEN"))
	client := &http.Client{Timeout: 20 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	return body, res.StatusCode, nil
}

func daemonDELETE(path string) (int, error) {
	req, _ := http.NewRequest("DELETE", daemonBase()+path, nil)
	req.Header.Set("Authorization", "Bearer "+os.Getenv("TRACE2E_TOKEN"))
	client := &http.Client{Timeout: 20 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	res.Body.Close()
	return res.StatusCode, nil
}

// ---------- list ----------

func runList() {
	body, code, err := daemonGET("/traces")
	if err != nil {
		fmt.Fprintln(os.Stderr, "cannot reach daemon:", err)
		os.Exit(1)
	}
	if code != 200 {
		fmt.Fprintf(os.Stderr, "daemon returned %d%s\n", code, hint(code))
		os.Exit(1)
	}
	fmt.Println(string(body))
}

func hint(code int) string {
	if code == 401 {
		return " (bad or missing TRACE2E_TOKEN)"
	}
	return ""
}
