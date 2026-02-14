import { useEffect, useMemo, useState } from "react";
import TerminalPane from "./components/TerminalPane";
import SettingsVault from "./components/SettingsVault";
import { EnvironmentManager } from "./lib/environmentManager";
import type { ExecutionMode, LayoutTemplate } from "./types";

const environment = new EnvironmentManager();

function gridClass(template: LayoutTemplate): string {
  if (template === 2) return "grid-template-2";
  if (template === 4) return "grid-template-4";
  return "grid-template-6";
}

export default function App() {
  const [template, setTemplate] = useState<LayoutTemplate>(2);
  const [paneIds, setPaneIds] = useState<string[]>(environment.getPaneIds());
  const [vaultOpen, setVaultOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [mode, setMode] = useState<ExecutionMode>("sandboxed");
  const [gridVersion, setGridVersion] = useState(0);
  const [, setModelVersion] = useState(0);
  const [activePaneId, setActivePaneId] = useState("pane-1");
  const [runtime, setRuntime] = useState<{ node: string; electron: string; chrome: string }>({
    node: "-",
    electron: "-",
    chrome: "-"
  });

  const cls = useMemo(() => gridClass(template), [template]);

  useEffect(() => {
    if (!window.vibe) return;
    void window.vibe.getVault().then((vault) => setMode(vault.executionMode));
    void window.vibe.getRuntime().then((value) => setRuntime(value));
  }, []);

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
    setTemplate(nextTemplate);
    const next = environment.applyTemplate(nextTemplate);
    setPaneIds(next);
    if (!next.includes(activePaneId)) {
      setActivePaneId(next[0] ?? "");
    }
    setGridVersion((v) => v + 1);
  }

  return (
    <main className="workspace-shell">
      <section className="main-area">
        <header className="topbar">
          <div className="brand-block">
            <h1>Vibe-ADE</h1>
            <span className={`execution-pill ${mode}`}>{mode}</span>
            <span className="top-runtime-tag">{`Node v${runtime.node}`}</span>
          </div>
          <div className="icon-toolbar">
            <button className="icon-btn" aria-label="Choose layout template" onClick={() => setTemplatePickerOpen(true)}>
              <span className="icon-grid" />
            </button>
            <button className="icon-btn" aria-label="Open settings" onClick={() => setVaultOpen(true)}>
              <span className="icon-gear" />
            </button>
          </div>
        </header>

        <section className={`terminal-grid ${cls}`} key={gridVersion}>
          {paneIds.map((paneId) => (
            <TerminalPane
              key={paneId}
              paneId={paneId}
              filePath={`C:\\Users\\admin\\Desktop\\Website\\Vibe-ADE\\${paneId}`}
              active={activePaneId === paneId}
              onActivate={setActivePaneId}
              model={environment.getModel(paneId)}
              onModelChange={(id, next) => {
                environment.setModel(id, next);
                setModelVersion((v) => v + 1);
              }}
            />
          ))}
        </section>
      </section>

      {templatePickerOpen && (
        <div className="popup-backdrop" onClick={() => setTemplatePickerOpen(false)}>
          <div className="template-popup" onClick={(e) => e.stopPropagation()}>
            <div className="template-popup-title">Choose Layout</div>
            <div className="template-options">
              <button
                className={`template-option ${template === 2 ? "active" : ""}`}
                onClick={() => {
                  applyTemplate(2);
                  setTemplatePickerOpen(false);
                }}
              >
                <span className="mini-grid mini-grid-2" />
                <span>2 Panes</span>
              </button>
              <button
                className={`template-option ${template === 4 ? "active" : ""}`}
                onClick={() => {
                  applyTemplate(4);
                  setTemplatePickerOpen(false);
                }}
              >
                <span className="mini-grid mini-grid-4" />
                <span>4 Panes</span>
              </button>
              <button
                className={`template-option ${template === 6 ? "active" : ""}`}
                onClick={() => {
                  applyTemplate(6);
                  setTemplatePickerOpen(false);
                }}
              >
                <span className="mini-grid mini-grid-6" />
                <span>6 Panes</span>
              </button>
            </div>
          </div>
        </div>
      )}

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
