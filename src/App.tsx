import { useEffect, useMemo, useState } from "react";
import TerminalPane from "./components/TerminalPane";
import SettingsVault from "./components/SettingsVault";
import CommandPalette from "./components/CommandPalette";
import QuickActionBar from "./components/QuickActionBar";
import { EnvironmentManager } from "./lib/environmentManager";
import type { ExecutionMode, LayoutTemplate, ModelProvider, PaletteAction, PaneInputMode } from "./types";

const environment = new EnvironmentManager();
const UI_STATE_KEY = "vibe:ui-state:v1";

interface StoredUiState {
  template: LayoutTemplate;
  activePaneId: string;
  modelByPane: Record<string, ModelProvider>;
  inputModeByPane: Record<string, PaneInputMode>;
}

function gridClass(template: LayoutTemplate): string {
  if (template === 2) return "grid-template-2";
  if (template === 4) return "grid-template-4";
  return "grid-template-6";
}

export default function App() {
  const [template, setTemplate] = useState<LayoutTemplate>(2);
  const [paneIds, setPaneIds] = useState<string[]>(environment.getPaneIds());
  const [vaultOpen, setVaultOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [launcherOpen, setLauncherOpen] = useState(true);
  const [mode, setMode] = useState<ExecutionMode>("sandboxed");
  const [modelVersion, setModelVersion] = useState(0);
  const [activePaneId, setActivePaneId] = useState("pane-1");
  const [inputModeByPane, setInputModeByPane] = useState<Record<string, PaneInputMode>>({});
  const [restartSignalByPane, setRestartSignalByPane] = useState<Record<string, number>>({});
  const [clearSignalByPane, setClearSignalByPane] = useState<Record<string, number>>({});
  const [workspacePath, setWorkspacePath] = useState("Workspace");
  const [runtime, setRuntime] = useState<{ node: string; electron: string; chrome: string }>({
    node: "-",
    electron: "-",
    chrome: "-"
  });

  const cls = useMemo(() => gridClass(template), [template]);
  const paletteActions = useMemo<PaletteAction[]>(
    () => [
      { id: "layout:2", title: "Switch to 2 Panes", hint: "workspace layout" },
      { id: "layout:4", title: "Switch to 4 Panes", hint: "workspace layout" },
      { id: "layout:6", title: "Switch to 6 Panes", hint: "workspace layout" },
      { id: "pane:mode:shell", title: "Set Active Pane to Shell", hint: activePaneId },
      { id: "pane:mode:interactive", title: "Set Active Pane to Interactive", hint: activePaneId },
      { id: "pane:restart", title: "Restart Active Pane", hint: activePaneId },
      { id: "pane:clear", title: "Clear Active Pane", hint: activePaneId },
      { id: "vault:open", title: "Open Settings Vault", hint: "configuration" }
    ],
    [activePaneId]
  );

  useEffect(() => {
    if (!window.vibe) return;
    void window.vibe.getVault().then((vault) => setMode(vault.executionMode));
    void window.vibe.getRuntime().then((value) => setRuntime(value));
    void window.vibe.getWorkspacePath().then((value) => setWorkspacePath(value));

    try {
      const raw = window.localStorage.getItem(UI_STATE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredUiState;
      if (![2, 4, 6].includes(parsed.template)) return;
      const nextPanes = environment.loadSnapshot({
        template: parsed.template,
        modelByPane: parsed.modelByPane ?? {}
      });
      setTemplate(parsed.template);
      setPaneIds(nextPanes);
      setActivePaneId(nextPanes.includes(parsed.activePaneId) ? parsed.activePaneId : nextPanes[0] ?? "pane-1");
      const nextModes: Record<string, PaneInputMode> = {};
      for (const paneId of nextPanes) {
        const modeValue = parsed.inputModeByPane?.[paneId];
        nextModes[paneId] = modeValue === "interactive-passthrough" ? "interactive-passthrough" : "shell-line";
      }
      setInputModeByPane(nextModes);
      setModelVersion((v) => v + 1);
    } catch {
      // Ignore invalid persisted UI state.
    }
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
      if (event.key === "Escape") {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const snapshot = environment.getSnapshot();
    const nextState: StoredUiState = {
      template,
      activePaneId,
      modelByPane: snapshot.modelByPane,
      inputModeByPane
    };
    window.localStorage.setItem(UI_STATE_KEY, JSON.stringify(nextState));
  }, [template, activePaneId, paneIds, modelVersion, inputModeByPane]);

  if (!window.vibe) {
    return (
      <main className="workspace-shell">
        <section className="main-area">
          <header className="topbar">
            <div className="brand-block">
              <h1>Vibe-ADE</h1>
            </div>
          </header>
          <section className="terminal-grid grid-template-2">
            <div className="terminal-pane">
              <div className="agent-overlay">
                <div className="agent-response action">
                  <div className="agent-response-label">Startup Error</div>
                  <div className="agent-response-body">Preload bridge was not initialized. Restart using `npm run dev`.</div>
                </div>
              </div>
            </div>
          </section>
        </section>
      </main>
    );
  }

  function applyTemplate(nextTemplate: LayoutTemplate): void {
    const previousPaneIds = environment.getPaneIds();
    setTemplate(nextTemplate);
    const next = environment.applyTemplate(nextTemplate);
    for (const paneId of previousPaneIds) {
      if (!next.includes(paneId)) {
        void window.vibe.destroyPane(paneId);
      }
    }
    setPaneIds(next);
    setInputModeByPane((prev) => {
      const filtered: Record<string, PaneInputMode> = {};
      for (const paneId of next) {
        filtered[paneId] = prev[paneId] ?? "shell-line";
      }
      return filtered;
    });
    if (!next.includes(activePaneId)) {
      setActivePaneId(next[0] ?? "");
    }
  }

  function bumpSignal(target: string, setter: (value: (prev: Record<string, number>) => Record<string, number>) => void): void {
    setter((prev) => ({ ...prev, [target]: (prev[target] ?? 0) + 1 }));
  }

  function runPaletteAction(actionId: PaletteAction["id"]): void {
    if (!activePaneId) return;
    switch (actionId) {
      case "layout:2":
        applyTemplate(2);
        break;
      case "layout:4":
        applyTemplate(4);
        break;
      case "layout:6":
        applyTemplate(6);
        break;
      case "vault:open":
        setVaultOpen(true);
        break;
      case "pane:restart":
        bumpSignal(activePaneId, setRestartSignalByPane);
        break;
      case "pane:clear":
        bumpSignal(activePaneId, setClearSignalByPane);
        break;
      case "pane:mode:shell":
        setInputModeByPane((prev) => ({ ...prev, [activePaneId]: "shell-line" }));
        break;
      case "pane:mode:interactive":
        setInputModeByPane((prev) => ({ ...prev, [activePaneId]: "interactive-passthrough" }));
        break;
      default:
        break;
    }
  }

  async function createProject(): Promise<void> {
    const nextPath = await window.vibe.createProjectWorkspace();
    if (!nextPath) return;
    setWorkspacePath(nextPath);
    setLauncherOpen(false);
  }

  async function openProject(): Promise<void> {
    const nextPath = await window.vibe.openProjectWorkspace();
    if (!nextPath) return;
    setWorkspacePath(nextPath);
    setLauncherOpen(false);
  }

  return (
    <main className="workspace-shell">
      {launcherOpen && (
        <section className="launch-shell">
          <div className="launch-card">
            <div className="launch-title">Vibe-ADE</div>
            <div className="launch-subtitle">Agent-at-work coding terminal for Windows.</div>
            <button className="launch-primary" onClick={() => void createProject()}>
              Create New Project
            </button>
            <div className="launch-secondary-row">
              <button onClick={() => void openProject()}>Open Project</button>
              <button onClick={() => setVaultOpen(true)}>Settings</button>
            </div>
          </div>
        </section>
      )}
      {!launcherOpen && (
        <section className="main-area">
          <QuickActionBar
            mode={mode}
            activePaneId={activePaneId}
            runtimeNode={runtime.node}
            onOpenPalette={() => setPaletteOpen(true)}
            onOpenVault={() => setVaultOpen(true)}
          />

          <section className={`terminal-grid ${cls}`}>
            {paneIds.map((paneId) => (
              <TerminalPane
                key={paneId}
                paneId={paneId}
                filePath={workspacePath}
                active={activePaneId === paneId}
                onActivate={setActivePaneId}
                model={environment.getModel(paneId)}
                inputMode={inputModeByPane[paneId] ?? "shell-line"}
                restartSignal={restartSignalByPane[paneId] ?? 0}
                clearSignal={clearSignalByPane[paneId] ?? 0}
                onInputModeChange={(id, nextInputMode) => {
                  setInputModeByPane((prev) => ({ ...prev, [id]: nextInputMode }));
                }}
                onModelChange={(id, next) => {
                  environment.setModel(id, next);
                  setModelVersion((v) => v + 1);
                }}
              />
            ))}
          </section>
        </section>
      )}
      <CommandPalette open={paletteOpen} actions={paletteActions} onClose={() => setPaletteOpen(false)} onSelect={runPaletteAction} />

      <SettingsVault
        open={vaultOpen}
        onClose={() => setVaultOpen(false)}
        onExecutionModeChanged={(next) => {
          setMode(next);
          setVaultOpen(false);
        }}
      />
    </main>
  );
}
