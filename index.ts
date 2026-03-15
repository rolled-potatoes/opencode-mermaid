import { tool, type Plugin } from "@opencode-ai/plugin"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
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
    (function () {
      var current = Number(document.querySelector('meta[name="diagram-count"]').content);
      setInterval(function () {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', location.href, true);
        xhr.onload = function () {
          var m = xhr.responseText.match(/name="diagram-count" content="(\d+)"/);
          if (m && Number(m[1]) !== current) location.reload();
        };
        xhr.send();
      }, 2000);
    })();
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

function htmlPath(sessionID: string): string {
  const suffix = sessionID.replace(/[^a-zA-Z0-9]/g, "").slice(-12)
  return `/tmp/mermaid-${suffix}.html`
}

function addDiagram(code: string, sessionID: string): string {
  const path = htmlPath(sessionID)
  const shortID = sessionID.slice(-12)

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

// ─── Plugin ──────────────────────────────────────────────────────────────────

let _sessionID = "default"
const _openedSessions = new Set<string>()

export const MermaidPlugin: Plugin = async () => {
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
          const path = addDiagram(code, _sessionID)

          if (!_openedSessions.has(_sessionID)) {
            openBrowser(path)
            _openedSessions.add(_sessionID)
            return `Diagram opened in browser: ${path}`
          }

          return `Diagram updated in browser: ${path}`
        },
      }),
    },
  }
}
