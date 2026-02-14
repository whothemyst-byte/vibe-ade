# Vibe-ADE

Windows-exclusive Agent Development Environment built with Electron, React, `xterm.js`, and `node-pty`.

## Features

- Dynamic CSS Grid templates with `2`, `4`, or `6` independent terminal panes.
- Central `EnvironmentManager` for pane/model state.
- Native Windows shell terminal sessions via `node-pty`.
- Floating per-pane status label (active model: `Local` or `GPT-4o`).
- Slash command interceptor:
  - `/local <prompt>` runs against local Ollama.
  - `/cloud <prompt>` runs against cloud API.
  - Any other text runs as a shell command.
- Agent response overlay with typewriter reveal + ANSI-styled Markdown.
- Settings Vault (`electron-store`) for:
  - encrypted cloud API key
  - local/cloud model names
  - cloud base URL
  - execution mode:
    - `Sandboxed (project-only)`
    - `System-Wide (full OS access)`
    - `Dual-Stream (thought/action split)`

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```
