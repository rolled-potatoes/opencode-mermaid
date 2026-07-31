# @rolled-potatoes/opencode-mermaid

An [OpenCode](https://opencode.ai) plugin that renders Mermaid diagrams in your browser.

Whenever the AI writes a `mermaid` code block, it automatically calls `render_mermaid` to open the diagram in your default browser. Multiple diagrams within the same session are accumulated in a single HTML file.

## Install

Add the package name to the `plugin` array in your `opencode.json`:

```json
{
  "plugin": ["@rolled-potatoes/opencode-mermaid"]
}
```

OpenCode will install it automatically on next start.

## Features

- Opens diagrams in the browser via a local HTML file (`<output-dir>/mermaid-<sessionID>.html`)
- Accumulates all diagrams from a session in one file — just refresh the tab
- Collapsible source view for each diagram
- Cross-platform: macOS (`open`), Linux (`xdg-open`), Windows (`start`)
- Uses [Mermaid.js v11](https://mermaid.js.org) via CDN — no build step needed

## Configuration

The output directory is resolved with the following priority:

1. **Per project**: a `.opencode/mermaid.json` file in the project root with an `outputDir` field (relative paths are resolved against the project root). This wins over everything else:

   ```json
   { "outputDir": ".diagrams" }
   ```

2. **Global**: the `MERMAID_OUTPUT_DIR` environment variable:

   ```bash
   export MERMAID_OUTPUT_DIR="$HOME/.local/share/opencode/mermaid"
   ```

3. **Fallback**: `/tmp`

The directory is created automatically if it does not exist. To persist the global env var, add the export line to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.).

## Supported diagram types

flowchart, sequence, class, pie, gantt, state, ER, mindmap, timeline, git graph, and anything else Mermaid supports.

## License

MIT
