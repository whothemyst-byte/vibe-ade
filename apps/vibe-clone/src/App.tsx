import { useEffect, useState } from "react";
import TerminalPane from "./components/TerminalPane";
import type { ExecutionMode } from "./types";

export default function App() {
  const [mode, setMode] = useState<ExecutionMode>("sandboxed");
  const [workspacePath, setWorkspacePath] = useState("~/Desktop/bridgemind");

  useEffect(() => {
    if (!window.vibe) return;
    void window.vibe.getVault().then((vault) => setMode(vault.executionMode));
    void window.vibe.getWorkspacePath().then((value) => setWorkspacePath(value.replace(/\\/g, "/")));
  }, []);

  return (
    <main className="clone-shell">
      <TerminalPane paneId="main-pane" filePath={workspacePath} mode={mode} />
    </main>
  );
}
