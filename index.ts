import { tool, type Plugin } from "@opencode-ai/plugin"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { createServer, type Server, type ServerResponse } from "node:http"
import { execSync } from "node:child_process"

// ─── HTML Helpers ────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function makeHtml(title: string, body: string, count: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="diagram-count" content="${count}" />
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f8f9fa;
      margin: 0;
      padding: 2rem;
      color: #212529;
    }
    h1 {
      font-size: 1rem;
      font-weight: 600;
      margin: 0 0 1.5rem;
      color: #adb5bd;
      letter-spacing: 0.03em;
    }
    .diagram-block {
      background: #fff;
      border: 1px solid #dee2e6;
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 1.25rem;
    }
    .diagram-label {
      font-size: 0.7rem;
      font-weight: 700;
      color: #ced4da;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 1rem;
    }
    .mermaid {
      display: flex;
      justify-content: center;
      overflow-x: auto;
    }
    details { margin-top: 1rem; }
    summary {
      cursor: pointer;
      font-size: 0.78rem;
      color: #adb5bd;
      user-select: none;
    }
    summary:hover { color: #495057; }
    details pre {
      margin-top: 0.5rem;
      background: #f1f3f5;
      border-radius: 4px;
      padding: 0.75rem 1rem;
      font-size: 0.78rem;
      line-height: 1.6;
      overflow-x: auto;
      white-space: pre;
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <!-- DIAGRAMS -->
${body}  <!-- /DIAGRAMS -->
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
    mermaid.initialize({ startOnLoad: true, theme: 'default' });
  </script>
  <script>
    var es = new EventSource('/events');
    es.onmessage = function () { location.reload(); };
  </script>
</body>
</html>`
}

function makeDiagramBlock(code: string, index: number): string {
  const escaped = escapeHtml(code)
  const type = detectType(code)
  return `  <div class="diagram-block">
    <div class="diagram-label">#${index} · ${type}</div>
    <div class="mermaid">${escaped}</div>
    <details>
      <summary>Source</summary>
      <pre>${escaped}</pre>
    </details>
  </div>\n`
}

function detectType(code: string): string {
  const first = code.trim().toLowerCase()
  if (/^(graph|flowchart)\s/.test(first)) return "flowchart"
  if (/^sequencediagram/.test(first)) return "sequence"
  if (/^classdiagram/.test(first)) return "class"
  if (/^pie/.test(first)) return "pie"
  if (/^gantt/.test(first)) return "gantt"
  if (/^statediagram/.test(first)) return "state"
  if (/^erdiagram/.test(first)) return "er"
  if (/^mindmap/.test(first)) return "mindmap"
  if (/^timeline/.test(first)) return "timeline"
  if (/^gitgraph/.test(first)) return "git"
  return "diagram"
}

// ─── Session-scoped file path ─────────────────────────────────────────────────

/**
 * Resolve the output directory with the following priority:
 *  1. Project config: `.opencode/mermaid.json` with `{ "outputDir": "..." }`
 *     (relative paths are resolved against the project root)
 *  2. Global env var: `MERMAID_OUTPUT_DIR`
 *  3. Fallback: `/tmp`
 */
function resolveOutputDir(directory: string | undefined): string {
  if (directory) {
    try {
      const configPath = join(directory, ".opencode", "mermaid.json")
      if (existsSync(configPath)) {
        const config = JSON.parse(readFileSync(configPath, "utf8")) as {
          outputDir?: unknown
        }
        if (typeof config.outputDir === "string" && config.outputDir) {
          return resolve(directory, config.outputDir)
        }
      }
    } catch (e) {
      console.error("[opencode-mermaid] error reading .opencode/mermaid.json:", e)
    }
  }
  if (process.env.MERMAID_OUTPUT_DIR) {
    return process.env.MERMAID_OUTPUT_DIR.replace(/\/+$/, "")
  }
  return "/tmp"
}

function htmlPath(sessionID: string, outDir: string): string {
  const suffix = sessionID.replace(/[^a-zA-Z0-9]/g, "").slice(-12)
  return `${outDir}/mermaid-${suffix}.html`
}

function addDiagram(code: string, sessionID: string, outDir: string): string {
  const path = htmlPath(sessionID, outDir)
  const shortID = sessionID.slice(-12)
  mkdirSync(dirname(path), { recursive: true })

  if (existsSync(path)) {
    const existing = readFileSync(path, "utf8")
    const count = (existing.match(/<div class="diagram-block">/g) || []).length
    const block = makeDiagramBlock(code, count + 1)
    const updated = existing
      .replace("  <!-- /DIAGRAMS -->", `${block}  <!-- /DIAGRAMS -->`)
      .replace(/name="diagram-count" content="\d+"/, `name="diagram-count" content="${count + 1}"`)
    writeFileSync(path, updated, "utf8")
  } else {
    const block = makeDiagramBlock(code, 1)
    writeFileSync(path, makeHtml(`Mermaid · ${shortID}`, block, 1), "utf8")
  }

  return path
}

// ─── Cross-platform browser open ─────────────────────────────────────────────

function openBrowser(filePath: string): void {
  const { platform } = process
  if (platform === "darwin") execSync(`open "${filePath}"`)
  else if (platform === "linux") execSync(`xdg-open "${filePath}"`)
  else execSync(`start "" "${filePath}"`)
}

// ─── Local HTTP server ─────────────────────────────────────────────────────────
// file:// URLs block XHR polling (CORS), so diagrams are served over localhost
// to make the auto-reload in the generated HTML actually work.

const _servedDirs = new Set<string>()
const _sseClients = new Set<ServerResponse>()
let _server: Server | null = null
let _serverInit: Promise<number> | null = null

function notifySSE(): void {
  for (const client of _sseClients) {
    client.write("data: reload\n\n")
  }
}

function ensureServer(outDir: string): Promise<number> {
  _servedDirs.add(outDir)
  if (_serverInit) return _serverInit

  _serverInit = (async () => {
    _server = createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1")

      if (url.pathname === "/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
        })
        res.write(":ok\n\n")
        _sseClients.add(res)
        req.on("close", () => _sseClients.delete(res))
        return
      }

      const filePath = url.searchParams.get("file")
      if (!filePath) {
        res.writeHead(400)
        res.end("missing ?file= parameter")
        return
      }

      const resolved = resolve(filePath)
      const allowed = [..._servedDirs].some((dir) => {
        const base = resolve(dir)
        return resolved === base || resolved.startsWith(base + "/")
      })
      if (!allowed) {
        res.writeHead(403)
        res.end("forbidden")
        return
      }

      try {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        })
        res.end(readFileSync(resolved))
      } catch {
        res.writeHead(404)
        res.end("not found")
      }
    })

    await new Promise<void>((ok, fail) => {
      _server!.once("error", fail)
      _server!.listen(0, "127.0.0.1", () => {
        _server!.off("error", fail)
        ok()
      })
    })

    const addr = _server!.address()
    if (!addr || typeof addr === "string") throw new Error("failed to bind local server")
    return addr.port
  })()

  return _serverInit
}

function serveUrl(port: number, filePath: string): string {
  return `http://127.0.0.1:${port}/?file=${encodeURIComponent(filePath)}`
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

let _sessionID = "default"
const _openedSessions = new Set<string>()

export const MermaidPlugin: Plugin = async ({ directory }) => {
  const outDir = resolveOutputDir(directory)
  return {
    "tool.execute.before": async (input, _output) => {
      if (input.tool === "render_mermaid") {
        _sessionID = input.sessionID
      }
    },

    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(
        "You have a render_mermaid tool. Whenever you write a ```mermaid code block, " +
        "immediately call render_mermaid with that diagram's source code so the user " +
        "can view it in their browser."
      )
    },

    tool: {
      render_mermaid: tool({
        description:
          "Open a Mermaid diagram in the user's browser. " +
          "Call this immediately after writing any mermaid code block.",
        args: {
          code: tool.schema
            .string()
            .describe("Mermaid diagram source code (without the ```mermaid fences)"),
        },
        execute: async ({ code }) => {
          if (typeof code !== "string") return "Error: code must be a string"
          const path = addDiagram(code, _sessionID, outDir)
          notifySSE()
          const port = await ensureServer(outDir)
          const url = serveUrl(port, path)

          if (!_openedSessions.has(_sessionID)) {
            openBrowser(url)
            _openedSessions.add(_sessionID)
            return `Diagram opened in browser: ${url}`
          }

          return `Diagram updated in browser: ${url}`
        },
      }),
    },
  }
}
