# Vibe-ADE v0.1.0-beta

Release date: 2026-02-14

## Highlights

- Windows-focused ADE built with Electron + React + xterm.js.
- Dynamic terminal templates: 2, 4, and 6 pane layouts.
- Native shell execution through node-pty per pane.
- Per-pane prompt bars with separated output/input workflow.
- Slash command routing:
  - `/local` routes to local Ollama.
  - `/cloud` routes to cloud API with local fallback.
- Settings Vault with secure API key storage.
- Execution modes: Sandboxed, System-Wide, Dual-Stream.
- Warp-inspired dark terminal interface with template popup and settings controls.

## Distribution

- Windows installer: `release/Vibe-ADE-0.1.0-setup.exe`
- SHA256:
  - `8F1115B51CDD6A9CB364F80C55CA9489B91F40E9C1FF0F98E5E8B267C6DA339B`

## Notes

- This is a beta release intended for early testing and feedback.
- Some builds may show large bundle-size warnings during packaging; these are non-blocking for current beta behavior.
